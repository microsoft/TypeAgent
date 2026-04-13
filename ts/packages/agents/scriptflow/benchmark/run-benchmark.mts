// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ScriptFlow Reliability Benchmark
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
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync, rmSync } from "fs";
import {
    seedViaImport,
    type SeedResult,
} from "./harness/seedInstanceStorage.mjs";

// Load .env from ts/ root manually (avoid dotenv dependency)
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
import {
    BenchmarkRunner,
    type BenchmarkOptions,
    type DispatcherAdapter,
} from "./harness/benchmarkRunner.mjs";
import type { BenchmarkScenario } from "./harness/types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(): BenchmarkOptions & { dryRun: boolean } {
    const args = process.argv.slice(2);
    const options: BenchmarkOptions & { dryRun: boolean } = {
        scenarioDir: join(__dirname, "scenarios"),
        outputDir: join(__dirname, "results"),
        benchmarkDir: __dirname,
        dryRun: false,
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
        }
    }

    return options;
}

async function createLiveDispatcher(
    persistDir: string,
): Promise<DispatcherAdapter> {
    // Resolve dispatcher and provider via relative paths to avoid cyclic
    // workspace dependencies (scriptflow -> defaultAgentProvider -> scriptflow)
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

    const dispatcher = await createDispatcher("scriptflow-benchmark", {
        appAgentProviders: providers,
        agents: { actions: true, commands: true },
        execution: { history: false },
        collectCommandResult: true,
        persistDir,
        storageProvider: getFsStorageProvider(),
    });

    let lastDisplayText = "";

    return {
        async processCommand(command: string): Promise<unknown> {
            // Snapshot the current display log length so we can capture only
            // entries produced by THIS command after it completes.
            let seqBefore = 0;
            try {
                const before = await dispatcher.getDisplayHistory();
                if (before.length > 0) {
                    seqBefore = (before[before.length - 1] as any).seq ?? 0;
                }
            } catch {
                /* ignore */
            }

            const result = await dispatcher.processCommand(command);

            // Poll for display output. Script execution results arrive
            // asynchronously through the agent RPC layer — processCommand
            // resolves but display entries may still be in flight.
            // Poll until the display log stabilizes (no new entries for 1s)
            // or we hit a 15s timeout.
            const pollStart = Date.now();
            let prevCount = 0;
            let stableAt = 0;
            lastDisplayText = "";

            while (Date.now() - pollStart < 15000) {
                await new Promise((r) => setTimeout(r, 300));
                try {
                    const entries =
                        await dispatcher.getDisplayHistory(seqBefore);
                    if (entries.length > prevCount) {
                        prevCount = entries.length;
                        stableAt = Date.now();
                    } else if (
                        entries.length > 0 &&
                        Date.now() - stableAt > 1000
                    ) {
                        // Stable for 1 second — capture and break
                        break;
                    }

                    if (entries.length === 0 && Date.now() - pollStart > 2000) {
                        break; // No entries at all after 2s — give up
                    }
                } catch {
                    break;
                }
            }

            // Final capture of all display entries
            try {
                const entries = await dispatcher.getDisplayHistory(seqBefore);
                const textParts: string[] = [];
                for (const entry of entries) {
                    if (
                        entry.type === "set-display" ||
                        entry.type === "append-display"
                    ) {
                        const msg = (entry as any).message?.message;
                        if (typeof msg === "string") {
                            textParts.push(msg);
                        } else if (Array.isArray(msg)) {
                            for (const item of msg) {
                                if (typeof item === "string") {
                                    textParts.push(item);
                                } else if (
                                    item &&
                                    typeof item === "object" &&
                                    item.content
                                ) {
                                    textParts.push(String(item.content));
                                }
                            }
                        }
                    }
                }
                lastDisplayText = textParts.join("\n");
            } catch {
                lastDisplayText = "";
            }
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

    console.log("ScriptFlow Reliability Benchmark");
    console.log("================================");

    if (options.category) {
        console.log(`Category filter: ${options.category}`);
    }
    if (options.scenarioId) {
        console.log(`Scenario filter: ${options.scenarioId}`);
    }
    if (options.noLlmJudge) {
        console.log("LLM judge: disabled");
    }

    // Validate scenario files exist
    const scenarioFiles = [
        "grammar-match.json",
        "execution.json",
        "llm-translation.json",
        "fallback-chain.json",
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

    // Check if benchmark environment is set up
    const benchmarkEnvDir = join(
        process.env.TEMP ?? "",
        "scriptflow-benchmark",
    );
    if (!existsSync(benchmarkEnvDir)) {
        console.log(`\nBenchmark environment not found at ${benchmarkEnvDir}`);
        console.log(
            "Run: powershell -File benchmark/fixtures/Setup-BenchmarkEnv.ps1",
        );
        console.log(
            "Or use --dry-run to validate scenarios without execution.",
        );
        process.exit(1);
    }

    const persistDir = join(
        process.env.TEMP ?? "/tmp",
        "scriptflow-benchmark-session",
    );

    // Clean previous session state so we start fresh
    if (existsSync(persistDir)) {
        rmSync(persistDir, { recursive: true, force: true });
    }

    // Phase 1: Import scripts via a temporary dispatcher.
    // This runs the real import pipeline (LLM-based ScriptAnalyzer) and
    // writes flows to instance storage. We then close this dispatcher.
    const scriptsDir = join(
        __dirname,
        "..",
        "test",
        "import-scenarios",
        "scripts",
    );

    let flowNameMap: Record<string, string> = {};
    if (existsSync(scriptsDir)) {
        try {
            const seedResult = await seedViaImport(scriptsDir, persistDir, () =>
                createLiveDispatcher(persistDir),
            );
            flowNameMap = seedResult.flowNameMap;
            if (seedResult.failed > 0) {
                console.log(`  Import errors: ${seedResult.errors.join("; ")}`);
            }
        } catch (err) {
            console.error(`Failed to seed flows: ${err}`);
        }
    }

    // Phase 2: Create a fresh dispatcher that loads the imported flows
    // from instance storage at startup. This ensures grammar rules are
    // registered via getDynamicGrammar() during agent initialization.
    console.log("\nCreating dispatcher for benchmark run...");
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
        const runner = new BenchmarkRunner(dispatcher, options, flowNameMap);
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
