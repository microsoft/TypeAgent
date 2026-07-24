#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadBenchmarkAgent } from "./agent.js";
import { loadVerifiedTasks, verifiedDataset } from "./dataset.js";
import {
    cleanupProcessedImages,
    collectProcessedTaskImages,
    readCleanupResultSnapshot,
} from "./imageCleanup.js";
import {
    readJsonFile,
    readRunManifest,
    readRunManifestIfExists,
    safeRunId,
    writeJsonAtomic,
} from "./io.js";
import { writeReports } from "./report.js";
import { writeThreeArmReport } from "./threeArmReport.js";
import {
    archiveResultArtifacts,
    CACHE_COMPATIBILITY_REVISION,
    seedResultsFromPriorRuns,
} from "./resultCache.js";
import { runBenchmark } from "./runner.js";
import type {
    BenchmarkVariant,
    MatrixEntry,
    MatrixFile,
    McpServerConfig,
    RepositoryLanguage,
    RunManifest,
} from "./types.js";
import { normalizeBenchmarkVariant } from "./types.js";

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const defaultMatrix = path.join(packageRoot, "examples", "matrix.json");
const defaultAgent = path.resolve(
    packageRoot,
    "../../../.copilot/agents/explorer.md",
);
const allowedModels = new Set([
    "azure/gpt-5.6-luna",
    "azure/gpt-5.6-terra",
    "azure/gpt-5.6-sol",
]);

async function main(argv: string[]): Promise<void> {
    const command = argv[0]?.startsWith("-") ? "run" : (argv.shift() ?? "run");
    const args = parseArgs(argv);
    if (args.has("help") || command === "help") {
        process.stdout.write(helpText);
        return;
    }
    if (command === "report") {
        rejectUnknownArgs(args, new Set(["help", "input"]));
        const input = required(args, "input");
        const artifacts = await writeReports(input);
        process.stdout.write(
            `report=${artifacts.jsonPath}\nmarkdown=${artifacts.markdownPath}\n`,
        );
        return;
    }
    if (command === "report-three-arm") {
        rejectUnknownArgs(
            args,
            new Set(["help", "paired-input", "lsp-input", "output-dir"]),
        );
        const outputDir = value(args, "output-dir");
        const artifacts = await writeThreeArmReport({
            pairedInput: required(args, "paired-input"),
            lspInput: required(args, "lsp-input"),
            ...(outputDir ? { outputDir } : {}),
        });
        process.stdout.write(
            `report=${artifacts.jsonPath}\nmarkdown=${artifacts.markdownPath}\n`,
        );
        return;
    }
    if (command === "cleanup-images") {
        rejectUnknownArgs(
            args,
            new Set(["help", "input", "apply", "watch", "interval-seconds"]),
        );
        await cleanupImagesCommand(args);
        return;
    }
    if (command !== "run") {
        throw new Error(`Unknown command: ${command}`);
    }
    rejectUnknownArgs(args, runOptionNames);
    await runCommand(args);
}

async function cleanupImagesCommand(
    args: Map<string, string[]>,
): Promise<void> {
    const input = path.resolve(required(args, "input"));
    const apply = booleanFlag(args, "apply");
    const watch = booleanFlag(args, "watch");
    const intervalSeconds = positiveInteger(
        value(args, "interval-seconds") ?? "300",
        "interval-seconds",
    );
    const settledTaskIds = new Set<string>();
    while (true) {
        const manifest = await readRunManifest(
            path.join(path.dirname(input), "manifest.json"),
        );
        const rows = await readCleanupResultSnapshot(input);
        const processed = collectProcessedTaskImages(manifest, rows);
        const candidates = processed.filter(
            (candidate) => !settledTaskIds.has(candidate.taskId),
        );
        const result = await cleanupProcessedImages(candidates, {
            dryRun: !apply,
        });
        for (const candidate of [...result.removed, ...result.missing]) {
            settledTaskIds.add(candidate.taskId);
        }
        process.stdout.write(
            [
                "cleanup-images",
                `mode=${apply ? "apply" : "dry-run"}`,
                `processed=${processed.length}/${manifest.taskIds.length}`,
                `candidates=${candidates.length}`,
                `removed=${result.removed.length}`,
                `missing=${result.missing.length}`,
                `would-remove=${result.wouldRemove.length}`,
                `in-use=${result.inUse.length}`,
                `provenance-skipped=${result.skippedProvenance.length}`,
                `errors=${result.errors.length}`,
            ].join("\t") + "\n",
        );
        for (const entry of result.errors) {
            process.stderr.write(
                `warning: image cleanup skipped ${entry.candidate.image}: ${entry.error}\n`,
            );
        }
        const complete = processed.length === manifest.taskIds.length;
        if (!watch || complete) {
            if (result.errors.length > 0) {
                process.exitCode = 1;
            }
            return;
        }
        await delay(intervalSeconds * 1000);
    }
}

async function runCommand(args: Map<string, string[]>): Promise<void> {
    const taskIdsFileValue = value(args, "task-ids-file");
    const taskIdsFile = taskIdsFileValue
        ? path.resolve(taskIdsFileValue)
        : undefined;
    const taskIds = taskIdsFile
        ? await loadTaskIdsFile(taskIdsFile)
        : undefined;
    const limit = positiveInteger(
        value(args, "limit") ?? String(taskIds?.length ?? 30),
        "limit",
    );
    if (taskIds && limit !== taskIds.length) {
        throw new Error(
            `--limit must equal the ${taskIds.length} entries in --task-ids-file`,
        );
    }
    const taskOffset = nonNegativeInteger(
        value(args, "task-offset") ?? "0",
        "task-offset",
    );
    const taskSeed = args.has("task-seed")
        ? required(args, "task-seed")
        : undefined;
    const taskSelectors = [
        taskSeed !== undefined,
        args.has("task-offset"),
        taskIds !== undefined,
    ].filter(Boolean).length;
    if (taskSelectors > 1) {
        throw new Error(
            "Use only one of --task-seed, --task-offset, or --task-ids-file",
        );
    }
    const forceRerun = booleanFlag(args, "force-rerun");
    if (limit < 30) {
        process.stderr.write(
            "warning: limits below 30 cannot produce all 1/5/10/30 prefix summaries\n",
        );
    }
    const dataDir = path.resolve(
        value(args, "data-dir") ?? ".data/explore-bench",
    );
    const runId = safeRunId(value(args, "run-id") ?? generateRunId(limit));
    const runDir = path.join(dataDir, "runs", runId);
    const output = path.resolve(
        value(args, "output") ?? path.join(runDir, "results.jsonl"),
    );
    const matrixPath = path.resolve(value(args, "matrix") ?? defaultMatrix);
    const selectedModel = value(args, "model");
    if (selectedModel && args.has("matrix")) {
        throw new Error("Use either --model or --matrix, not both");
    }
    const matrix = selectedModel
        ? [createMatrixEntry(selectedModel)]
        : await loadMatrix(matrixPath);
    const variants = selectedVariants(args);
    const languageFilter = selectedLanguages(args, variants);
    const agent = await loadBenchmarkAgent(
        value(args, "agent-file") ?? defaultAgent,
    );
    if (agent.name !== "explorer") {
        throw new Error(
            `Benchmark agent must be named explorer; observed ${JSON.stringify(agent.name)}`,
        );
    }
    const copilotPath = variants.includes("baseline")
        ? await (
              await import("./copilot.js")
          ).resolveCopilotPath(value(args, "copilot"))
        : "";
    const runtimeEvidence = path.join(runDir, "copilot-runtime.json");
    const providerBaseUrl =
        value(args, "litellm-base-url") ?? "http://localhost:4627/v1";
    const apiKeyEnv = value(args, "api-key-env") ?? "CUSTOM_PROVIDER_API_KEY";
    const envFileValue = value(args, "env-file");
    const envFile = envFileValue ? path.resolve(envFileValue) : undefined;
    const timeoutMs = positiveInteger(
        value(args, "timeout-ms") ?? "300000",
        "timeout-ms",
    );
    const maxConcurrency = positiveInteger(
        value(args, "max-concurrency") ?? "3",
        "max-concurrency",
    );
    const maxAttempts = positiveInteger(
        value(args, "max-attempts") ?? "2",
        "max-attempts",
    );
    const dockerPlatform = value(args, "docker-platform") ?? "linux/amd64";
    const mcp = mcpConfig(args);
    const tasks = await loadVerifiedTasks({
        dataDir,
        limit,
        offset: taskOffset,
        ...(taskSeed === undefined ? {} : { seed: taskSeed }),
        ...(taskIds === undefined ? {} : { taskIds }),
        ...(languageFilter ? { languages: languageFilter } : {}),
        dockerPlatform,
    });
    if (tasks.length === 0) {
        throw new Error(
            "No selected tasks match the requested language filter",
        );
    }

    const manifest: RunManifest = {
        schemaVersion: 1,
        cacheCompatibilityRevision: CACHE_COMPATIBILITY_REVISION,
        runId,
        createdAt: new Date().toISOString(),
        dataset: verifiedDataset,
        split: "test",
        ...(taskIdsFile
            ? { taskIdsFile }
            : taskSeed === undefined
              ? { taskOffset }
              : { taskSeed }),
        ...(languageFilter ? { sourceTaskCount: limit, languageFilter } : {}),
        taskIds: tasks.map((task) => task.id),
        matrix,
        variants,
        output,
        copilotPath,
        runtimeEvidence,
        provider: {
            type: "openai-compatible",
            baseUrl: providerBaseUrl,
            apiKeyEnv,
            wireApi: "responses",
        },
        mcp,
        agent,
        maxConcurrency,
        maxAttempts,
        timeoutMs,
        dockerPlatform,
    };
    await ensureCompatibleManifest(
        path.join(runDir, "manifest.json"),
        manifest,
    );

    if (forceRerun) {
        const archived = await archiveResultArtifacts(output);
        process.stderr.write(
            `cache\tforce-rerun\tarchived=${archived.length}\n`,
        );
    } else {
        const cache = await seedResultsFromPriorRuns({
            runsDir: path.join(dataDir, "runs"),
            targetManifest: manifest,
            tasks,
            output,
        });
        process.stderr.write(
            `cache\treused-keys=${cache.importedKeys}\treused-rows=${cache.importedRows}\tsources=${cache.sources.length}\n`,
        );
        for (const warning of cache.warnings) {
            process.stderr.write(`warning: cache source skipped: ${warning}\n`);
        }
    }

    process.stderr.write(
        `runId=${runId}\ntasks=${tasks.length} models=${matrix.length} variants=${variants.length} rows=${tasks.length * matrix.length * variants.length}\noutput=${output}\n`,
    );
    await runBenchmark(tasks, matrix, {
        runId,
        output,
        copilotPath,
        runtimeEvidence,
        providerBaseUrl,
        apiKeyEnv,
        ...(envFile ? { envFile } : {}),
        mcp,
        agent,
        timeoutMs,
        maxConcurrency,
        maxAttempts,
        dockerPlatform,
        variants,
        forceRerun,
    });
    const artifacts = await writeReports(output);
    process.stdout.write(
        `runId=${runId}\nresults=${output}\nreport=${artifacts.jsonPath}\nmarkdown=${artifacts.markdownPath}\n`,
    );
}

async function loadMatrix(matrixPath: string): Promise<MatrixEntry[]> {
    const parsed = await readJsonFile<MatrixFile | MatrixEntry[]>(matrixPath);
    const runs = Array.isArray(parsed) ? parsed : parsed.runs;
    if (!Array.isArray(runs) || runs.length === 0) {
        throw new Error(
            `Matrix ${matrixPath} must contain a non-empty runs array`,
        );
    }
    for (const entry of runs) {
        if (!entry.model?.trim()) {
            throw new Error(
                `Every matrix entry in ${matrixPath} needs a model`,
            );
        }
        assertAllowedModel(entry.model);
    }
    const names = runs.map((entry) => entry.name ?? entry.model);
    if (new Set(names).size !== names.length) {
        throw new Error(`Matrix names must be unique in ${matrixPath}`);
    }
    return runs;
}

async function loadTaskIdsFile(taskIdsPath: string): Promise<string[]> {
    const parsed = await readJsonFile<unknown>(taskIdsPath);
    if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some((taskId) => typeof taskId !== "string" || !taskId.trim())
    ) {
        throw new Error(
            `${taskIdsPath} must contain a non-empty JSON array of task IDs`,
        );
    }
    const taskIds = parsed as string[];
    if (new Set(taskIds).size !== taskIds.length) {
        throw new Error(`${taskIdsPath} task IDs must be unique`);
    }
    return taskIds;
}

function createMatrixEntry(model: string): MatrixEntry {
    assertAllowedModel(model);
    return { name: model, model };
}

function assertAllowedModel(model: string): void {
    if (!allowedModels.has(model)) {
        throw new Error(
            `Unsupported benchmark model ${JSON.stringify(model)}; allowed models are ${[...allowedModels].join(", ")}`,
        );
    }
}

function selectedVariants(args: Map<string, string[]>): BenchmarkVariant[] {
    const requested = args.get("variant");
    if (!requested) {
        return ["baseline", "typeagent"];
    }
    const variants = requested.map(normalizeBenchmarkVariant);
    if (new Set(variants).size !== variants.length) {
        throw new Error("--variant values must be unique");
    }
    return variants;
}

function selectedLanguages(
    args: Map<string, string[]>,
    variants: BenchmarkVariant[],
): RepositoryLanguage[] | undefined {
    const requested = args.get("language");
    const values =
        requested ??
        (variants.includes("typeagent-lsp")
            ? (["python", "typescript"] as const)
            : undefined);
    if (!values) {
        return undefined;
    }
    const languages = values.map((language) => {
        if (language !== "python" && language !== "typescript") {
            throw new Error(
                `Unsupported benchmark language ${JSON.stringify(language)}; expected python or typescript`,
            );
        }
        return language;
    });
    if (new Set(languages).size !== languages.length) {
        throw new Error("--language values must be unique");
    }
    return languages;
}

function mcpConfig(args: Map<string, string[]>): McpServerConfig {
    const commandValue = value(args, "mcp-command");
    if (!commandValue) {
        return { command: "", args: [], envVars: [] };
    }
    const command =
        commandValue === "node"
            ? process.execPath
            : commandValue.includes(path.sep)
              ? path.resolve(commandValue)
              : commandValue;
    const cwdValue = value(args, "mcp-cwd");
    return {
        command,
        args: args.get("mcp-arg") ?? [],
        ...(cwdValue ? { cwd: path.resolve(cwdValue) } : {}),
        envVars: args.get("mcp-env") ?? [],
    };
}

async function ensureCompatibleManifest(
    manifestPath: string,
    requested: RunManifest,
): Promise<void> {
    const existing = await readRunManifestIfExists(manifestPath);
    if (!existing) {
        await writeJsonAtomic(manifestPath, requested);
        return;
    }
    if (
        JSON.stringify(manifestIdentity(existing)) !==
        JSON.stringify(manifestIdentity(requested))
    ) {
        throw new Error(
            `Run ${requested.runId} already exists with different tasks, models, provider, harness, or execution settings`,
        );
    }
}

function manifestIdentity(manifest: RunManifest): unknown {
    const {
        createdAt: _createdAt,
        cacheCompatibilityRevision,
        ...identity
    } = manifest;
    return {
        ...identity,
        cacheCompatibilityRevision:
            cacheCompatibilityRevision ?? CACHE_COMPATIBILITY_REVISION,
    };
}

function parseArgs(argv: string[]): Map<string, string[]> {
    const args = new Map<string, string[]>();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            throw new Error(`Unexpected argument: ${token}`);
        }
        const equals = token.indexOf("=");
        const key = token.slice(2, equals >= 0 ? equals : undefined);
        let argument = equals >= 0 ? token.slice(equals + 1) : "true";
        if (
            equals < 0 &&
            argv[index + 1] &&
            !argv[index + 1].startsWith("--")
        ) {
            argument = argv[index + 1];
            index += 1;
        }
        args.set(key, [...(args.get(key) ?? []), argument]);
    }
    return args;
}

function rejectUnknownArgs(
    args: Map<string, string[]>,
    allowed: ReadonlySet<string>,
): void {
    for (const key of args.keys()) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown option: --${key}`);
        }
    }
}

function value(args: Map<string, string[]>, key: string): string | undefined {
    const values = args.get(key);
    return values?.[values.length - 1];
}

function required(args: Map<string, string[]>, key: string): string {
    const result = value(args, key);
    if (!result || result === "true") {
        throw new Error(`Missing --${key}`);
    }
    return result;
}

function positiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--${name} must be a positive integer`);
    }
    return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return parsed;
}

function booleanFlag(args: Map<string, string[]>, name: string): boolean {
    const values = args.get(name);
    if (!values) {
        return false;
    }
    if (values.some((entry) => entry !== "true")) {
        throw new Error(`--${name} does not take a value`);
    }
    return true;
}

function generateRunId(limit: number): string {
    return `swebench-verified-${limit}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

const helpText = `typeagent-explore-bench

Run deterministic or seeded SWE-bench Verified localization tasks through the
real GitHub Copilot CLI/SDK, comparing Copilot SDK (with explore agent),
TypeAgent, and the optional TypeAgent with LSP arm.

Usage:
  node dist/src/cli.js run [options]
  node dist/src/cli.js report --input <results.jsonl>
  node dist/src/cli.js report-three-arm --paired-input <results.jsonl> --lsp-input <results.jsonl>
  node dist/src/cli.js cleanup-images --input <results.jsonl> [options]

Run options:
  --matrix <file>               Default: examples/matrix.json
  --model <model>               Run one allowed model instead of --matrix
  --variant <name>              baseline, typeagent, or typeagent-lsp; repeatable; default first two
  --language <name>             python or typescript; repeatable; defaults to both for typeagent-lsp
  --agent-file <file>           Default: root .copilot/agents/explorer.md
  --copilot <file>              Native Copilot executable; otherwise auto-resolved
  --litellm-base-url <url>      Default: http://localhost:4627/v1
  --api-key-env <name>          Default: CUSTOM_PROVIDER_API_KEY
  --env-file <file>             Explicit env file; overrides inherited/launchctl values
  --data-dir <dir>              Default: .data/explore-bench
  --run-id <id>                 Existing ids resume successful task/model/variant rows
  --limit <n>                   Default: 30; SWE-bench Verified supports at most 500
  --task-offset <n>             Skip this many tasks in the deterministic selection; default: 0
  --task-seed <seed>            Select a deterministic random sample; incompatible with --task-offset
  --task-ids-file <file>        Exact retained cohort as a JSON string array; exclusive with offset/seed
  --force-rerun                 Ignore result caches and archive prior run reports/results
  --max-concurrency <n>         Sessions per model; default: 3 (up to 9 total)
  --max-attempts <n>            Default: 2; only failed rows retry
  --timeout-ms <n>              Default: 300000 per Copilot session
  --docker-platform <name>      Default: linux/amd64

Image cleanup options:
  --input <results.jsonl>       Active or completed benchmark result file
  --apply                       Remove eligible exact task images; default dry-run
  --watch                       Repeat until every task has terminal results
  --interval-seconds <n>        Watch interval; default: 300
`;

const runOptionNames = new Set([
    "help",
    "mcp-command",
    "mcp-arg",
    "mcp-cwd",
    "mcp-env",
    "matrix",
    "model",
    "variant",
    "language",
    "agent-file",
    "copilot",
    "litellm-base-url",
    "api-key-env",
    "env-file",
    "data-dir",
    "run-id",
    "output",
    "limit",
    "task-offset",
    "task-seed",
    "task-ids-file",
    "force-rerun",
    "max-concurrency",
    "max-attempts",
    "timeout-ms",
    "docker-platform",
]);

await main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 1;
});
