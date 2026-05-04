// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
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
    process.stderr.write(`[resyn] could not load env from ${envPath}: ${e}\n`);
}

// GPT-5 reasoning calls easily take 90+ seconds for large prompts (the
// synthesizer's neutral-classification + clustering passes each push 80KB+).
// Override the default 60s aiclient timeout. Note: aiclient's getEnvSetting
// short-circuits on its empty-string default and never falls back to the
// non-suffixed var when an endpoint suffix is set, so we must set the
// suffixed variant explicitly.
process.env.AZURE_OPENAI_MAX_TIMEOUT_GPT_5 = "300000";
process.env.AZURE_OPENAI_MAX_TIMEOUT = "300000";
process.env.OPENAI_MAX_TIMEOUT = "300000";

import { synthesize } from "../synthesizer.js";

const WORKSPACE = path.join(
    homedir(),
    ".typeagent",
    "onboarding",
    "windowsClock",
);

function log(msg: string): void {
    process.stdout.write(`[resyn] ${msg}\n`);
}

function findMostRecentDir(parent: string): string {
    const entries = readdirSync(parent)
        .map((name) => ({
            name,
            full: path.join(parent, name),
            stat: statSync(path.join(parent, name)),
        }))
        .filter((e) => e.stat.isDirectory())
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (entries.length === 0) {
        throw new Error(`No directories under ${parent}`);
    }
    return entries[0]!.full;
}

async function main(): Promise<void> {
    log(
        `env timeouts: AZURE=${process.env.AZURE_OPENAI_MAX_TIMEOUT} OPENAI=${process.env.OPENAI_MAX_TIMEOUT}`,
    );
    const runDir = findMostRecentDir(path.join(WORKSPACE, "runs"));
    log(`re-synthesizing run: ${runDir}`);

    // Wipe the workspace-level discoveredActions.json so the merge starts fresh.
    const wsActions = path.join(WORKSPACE, "discoveredActions.json");
    if (existsSync(wsActions)) {
        unlinkSync(wsActions);
        log(`(removed existing ${wsActions} for clean merge)`);
    }

    const startedAt = Date.now();
    const result = await synthesize({
        runDir,
        integrationName: "windowsClock",
        workspaceDir: WORKSPACE,
    });
    const ms = Date.now() - startedAt;

    log(
        `synthesis: ${result.actions.length} action(s) (after merge-recs), ${result.clusters.clusters.length} cluster(s) initially, ${result.chunkCount} chunk(s) — ${ms}ms`,
    );

    if (result.validation) {
        const v = result.validation;
        log(`validation:`);
        for (const r of v.reviews) {
            const icon =
                r.verdict === "ok"
                    ? "✓"
                    : r.verdict === "fragment"
                      ? "⨯"
                      : r.verdict === "duplicate"
                        ? "⇉"
                        : r.verdict === "broken"
                          ? "✗"
                          : "?";
            log(`  ${icon} ${r.actionName} [${r.verdict}] — ${r.note}`);
        }
        if (v.mergeRecommendations && v.mergeRecommendations.length > 0) {
            log(`  merge recommendations applied:`);
            for (const m of v.mergeRecommendations) {
                log(
                    `    ${m.actionNames.join(" + ")} → ${m.proposedName}(${m.proposedParam.name}: ${m.proposedParam.type}${m.proposedParam.enumValues ? ` ${m.proposedParam.enumValues.join("|")}` : ""})`,
                );
            }
        }
        if (v.overallNotes) {
            log(`  notes: ${v.overallNotes}`);
        }
    }

    log("");
    log("Final action set:");
    if (result.mergedActionsPath && existsSync(result.mergedActionsPath)) {
        const merged = JSON.parse(
            readFileSync(result.mergedActionsPath, "utf8"),
        );
        for (const a of merged.actions) {
            const flags = a.destructive ? " DESTRUCTIVE" : "";
            const params = a.parameters
                .map((p: { name: string; type: string }) => `${p.name}:${p.type}`)
                .join(", ");
            log(
                `  • ${a.actionName}(${params})${flags} — ${a.playback.length} step(s)`,
            );
        }
        log("");
        log(`File: ${result.mergedActionsPath}`);
    }
    log("DONE");
}

main().catch((e) => {
    process.stderr.write(`FAILED: ${e}\n`);
    if (e instanceof Error && e.stack) {
        process.stderr.write(e.stack + "\n");
    }
    process.exit(1);
});
