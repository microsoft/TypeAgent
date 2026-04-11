// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * TaskFlow Reliability Benchmark
 *
 * Usage:
 *   npx tsx benchmark/run-benchmark.mts [options]
 *
 * Options:
 *   --category <name>     Run only scenarios in this category
 *   --scenario <id>       Run only this specific scenario
 *   --no-llm-judge        Skip LLM-as-judge evaluations
 *   --compare <path>      Compare results against a baseline scorecard.json
 *   --dry-run             Load and validate scenarios without executing
 *   --mode <mode>         Test mode: default, llm, live, record, all
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync, rmSync } from "fs";
import {
    BenchmarkRunner,
    type BenchmarkOptions,
    type DispatcherAdapter,
} from "./harness/benchmarkRunner.mjs";
import type { BenchmarkScenario } from "./harness/types.mjs";

// Load .env from ts/ root
const _thisDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(_thisDir, "..", "..", "..", "..", ".env");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) {
            process.env[key] = val;
        }
    }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(): BenchmarkOptions & { dryRun: boolean } {
    const args = process.argv.slice(2);
    const options: BenchmarkOptions & { dryRun: boolean } = {
        scenarioDir: join(__dirname, "scenarios"),
        outputDir: join(__dirname, "results"),
        benchmarkDir: __dirname,
        dryRun: false,
        mode: "default",
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--category":
                options.category = args[++i];
                break;
            case "--scenario":
                options.scenarioId = args[++i];
                break;
            case "--no-llm-judge":
                options.noLlmJudge = true;
                break;
            case "--compare":
                options.compareBaseline = args[++i];
                break;
            case "--dry-run":
                options.dryRun = true;
                break;
            case "--mode":
                options.mode = args[++i] as BenchmarkOptions["mode"];
                break;
            case "--llm":
                options.mode = "llm";
                break;
            case "--live":
                options.mode = "live";
                break;
            case "--record":
                options.mode = "record";
                break;
            case "--all":
                options.mode = "all";
                break;
        }
    }

    return options;
}

function extractMessageText(message: any): string {
    if (!message) return "";
    const msg = message.message ?? message;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) {
        return msg
            .map((item: any) => {
                if (typeof item === "string") return item;
                if (item?.content) return String(item.content);
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    if (typeof msg === "object" && msg.content) return String(msg.content);
    return "";
}

async function createLiveDispatcher(
    persistDir: string,
): Promise<DispatcherAdapter> {
    const tsRoot = join(__dirname, "..", "..", "..", "..");
    const dispatcherPath = join(
        tsRoot,
        "packages",
        "dispatcher",
        "dispatcher",
        "dist",
        "index.js",
    );
    const providerPath = join(
        tsRoot,
        "packages",
        "defaultAgentProvider",
        "dist",
        "defaultAgentProviders.js",
    );

    const { createDispatcher } = await import(
        /* webpackIgnore: true */ "file://" + dispatcherPath.replace(/\\/g, "/")
    );
    const { getDefaultAppAgentProviders } = await import(
        /* webpackIgnore: true */ "file://" + providerPath.replace(/\\/g, "/")
    );

    const providers = getDefaultAppAgentProviders(undefined);

    const nodeProvidersPath = join(
        tsRoot,
        "packages",
        "dispatcher",
        "nodeProviders",
        "dist",
        "index.js",
    );
    const { getFsStorageProvider } = await import(
        /* webpackIgnore: true */ "file://" +
            nodeProvidersPath.replace(/\\/g, "/")
    );

    let lastDisplayText = "";

    // Custom clientIO that captures display output for evaluation.
    // The default nullClientIO discards all display calls.
    const clientIO = {
        clear: () => {},
        exit: () => process.exit(0),
        setUserRequest: () => {},
        setDisplayInfo: () => {},
        setDisplay(message: any) {
            const text = extractMessageText(message);
            if (text) lastDisplayText = text;
        },
        appendDisplay(message: any) {
            const text = extractMessageText(message);
            if (text) lastDisplayText += (lastDisplayText ? "\n" : "") + text;
        },
        appendDiagnosticData: () => {},
        setDynamicDisplay: () => {},
        askYesNo: async (_rid: any, _msg: string, defaultValue = false) =>
            defaultValue,
        proposeAction: async () => undefined,
        notify: () => {},
        takeAction: () => {},
    };

    const dispatcher = await createDispatcher("taskflow-benchmark", {
        appAgentProviders: providers,
        agents: { actions: true, commands: true },
        execution: { history: false },
        collectCommandResult: true,
        persistDir,
        storageProvider: getFsStorageProvider(),
        clientIO,
    });

    return {
        async processCommand(command: string): Promise<unknown> {
            lastDisplayText = "";
            const result = await dispatcher.processCommand(command);
            return result ?? null;
        },
        getDisplayText(): string {
            return lastDisplayText;
        },
        async close(): Promise<void> {
            await dispatcher.close();
        },
    };
}

function createStubDispatcher(): DispatcherAdapter {
    return {
        async processCommand(command: string): Promise<unknown> {
            console.log(`  [DRY RUN] Would process: "${command}"`);
            return { dryRun: true, command };
        },
        getDisplayText(): string {
            return "";
        },
        async close(): Promise<void> {},
    };
}

async function main() {
    const options = parseArgs();

    console.log("TaskFlow Reliability Benchmark");
    console.log("==============================");
    console.log(`Mode: ${options.mode}`);

    if (options.category) {
        console.log(`Category filter: ${options.category}`);
    }
    if (options.scenarioId) {
        console.log(`Scenario filter: ${options.scenarioId}`);
    }

    // Validate scenario files
    const scenarioFiles = [
        "seeding.json",
        "grammar-match.json",
        "llm-translation.json",
        "execution.json",
        "flow-crud.json",
        "recording.json",
        "flow-generation.json",
        "script-patterns.json",
        "dynamic-registration.json",
        "error-handling.json",
        "end-to-end.json",
    ];

    let totalScenarios = 0;
    for (const file of scenarioFiles) {
        const filePath = join(options.scenarioDir, file);
        if (existsSync(filePath)) {
            const scenarios: BenchmarkScenario[] = JSON.parse(
                readFileSync(filePath, "utf-8"),
            );
            console.log(`  ${file}: ${scenarios.length} scenario(s)`);
            totalScenarios += scenarios.length;
        }
    }
    console.log(`  Total: ${totalScenarios} scenario(s)`);

    if (options.dryRun) {
        console.log("\nDry run mode - scenarios validated, not executed.");
        const dispatcher = createStubDispatcher();
        const runner = new BenchmarkRunner(dispatcher, options);
        await runner.run();
        return;
    }

    const persistDir = join(
        process.env.TEMP ?? "/tmp",
        "taskflow-benchmark-session",
    );

    // Clean previous session
    if (existsSync(persistDir)) {
        rmSync(persistDir, { recursive: true, force: true });
    }

    // Create dispatcher — sample flows auto-seed via updateAgentContext
    console.log("\nCreating dispatcher (samples will auto-seed)...");
    let dispatcher: DispatcherAdapter;
    try {
        dispatcher = await createLiveDispatcher(persistDir);
    } catch (err) {
        console.error(`Failed to create dispatcher: ${err}`);
        console.log(
            "\nFalling back to dry-run mode. To run live tests, ensure TypeAgent is built.",
        );
        dispatcher = createStubDispatcher();
    }

    try {
        const runner = new BenchmarkRunner(dispatcher, options);
        const scorecard = await runner.run();

        const passRate =
            scorecard.summary.total > 0
                ? (
                      (scorecard.summary.passed / scorecard.summary.total) *
                      100
                  ).toFixed(1)
                : "0.0";
        process.exit(parseFloat(passRate) >= 85 ? 0 : 1);
    } finally {
        await dispatcher.close();
    }
}

main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(2);
});
