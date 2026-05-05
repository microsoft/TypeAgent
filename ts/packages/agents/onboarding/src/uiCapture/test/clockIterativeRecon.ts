// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const envPath = path.resolve(
    path.dirname(__filename),
    "../../../../../..",
    ".env",
);
try {
    (process as any).loadEnvFile(envPath);
} catch (e) {
    process.stderr.write(`[itr] could not load env from ${envPath}: ${e}\n`);
}

process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_v = "180000";
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_4_O = "180000";
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_5 = "300000";
process.env.AZURE_OPENAI_MAX_TIMEOUT = "180000";

import { HelperClient } from "../helperClient.js";
import { iterativeReconnoiter } from "../iterativeReconnaissance.js";

const CLOCK_AUMID = "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App";

function log(msg: string): void {
    process.stdout.write(`[itr] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
    const workspaceDir = path.join(
        homedir(),
        ".typeagent",
        "onboarding",
        "windowsClock",
    );

    const client = await HelperClient.start({ debug: false });
    try {
        for (const w of (await client.appList()).filter((x) =>
            x.title.includes("Clock"),
        )) {
            await client.appKill({ pid: w.pid });
        }
        await sleep(1500);

        log("launching Clock...");
        const launch = await client.appLaunch({ aumid: CLOCK_AUMID });
        await client.eventsIdle({ debounceMs: 800, maxWaitMs: 5000 });

        log("starting iterative reconnaissance (max 20 turns)...");
        const recon = await iterativeReconnoiter({
            client,
            rootSelector: launch.mainWindow,
            appHint: "Windows Clock (Microsoft Alarms & Clock)",
            maxIterations: 20,
            settleMs: 1000,
        });

        log(
            `done: ${recon.iterationsUsed} iter, ${recon.expectedActions.length} discoveries`,
        );
        log("");
        log(`screen path: ${recon.screenLog.join(" → ")}`);
        log("");
        log("discoveries:");
        for (const a of recon.expectedActions) {
            const params = a.parameters
                .map((p) => `${p.name}:${p.type}=${JSON.stringify(p.example)}`)
                .join(", ");
            const flags = `${a.priority}${a.destructive ? "/destructive" : ""}`;
            log(`  • ${a.intentName}(${params}) [${a.tabOrSection}, ${flags}]`);
            log(`      ${a.description}`);
        }

        const outFile = path.join(workspaceDir, "iterativeReconnaissance.json");
        writeFileSync(outFile, JSON.stringify(recon, null, 2));
        log(`saved → ${outFile}`);

        await client.appKill({ pid: launch.pid });
        log("DONE");
    } finally {
        await client.dispose();
    }
}

main().catch((e) => {
    process.stderr.write(`FAILED: ${e}\n`);
    if (e instanceof Error && e.stack) {
        process.stderr.write(e.stack + "\n");
    }
    process.exit(1);
});
