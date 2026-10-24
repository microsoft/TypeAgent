// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { prepareProtocol } from "./protocol.js";
import { run } from "./runner.js";
import { beamSplits } from "./data.js";
import { main as runLongMemEval } from "./longmemeval/live.mjs";
import type { RunOptions } from "./runner.js";
import type { LongMemEvalVariant } from "./longmemeval/pins.js";

interface CliOptions {
    dataset: "beam" | "longmemeval";
    output: string;
    progress?: string;
    protocol?: string;
    repo?: string;
    cache?: string;
    input?: string;
    unit?: string;
    split?: RunOptions["split"];
    stage?: RunOptions["stage"];
    provider?: RunOptions["provider"];
    mode?: RunOptions["mode"];
    product?: string;
    variant?: LongMemEvalVariant;
    judgeSource?: string;
    questionIds?: string;
    maxQuestions?: string;
    workMinutes?: string;
    startupMinutes?: string;
    authorizedLiveBenchmark?: boolean;
    resume?: string;
    continueAfterImportFailure?: boolean;
}

function required(value: string | undefined, option: string): string {
    if (!value) throw new Error(`${option} is required`);
    return path.resolve(value);
}

function rejectOptions(options: CliOptions, names: (keyof CliOptions)[]) {
    for (const name of names)
        if (options[name] !== undefined)
            throw new Error(
                `${name} is not supported for --dataset ${options.dataset}`,
            );
}

export function validateDatasetOptions(options: CliOptions) {
    if (options.dataset === "beam") {
        rejectOptions(options, [
            "product",
            "judgeSource",
            "questionIds",
            "maxQuestions",
            "workMinutes",
            "startupMinutes",
            "authorizedLiveBenchmark",
            "resume",
            "continueAfterImportFailure",
            "variant",
        ]);
        required(options.protocol, "--protocol");
        required(options.progress, "--progress");
    } else {
        rejectOptions(options, ["split", "stage", "unit", "cache"]);
        if (options.provider && options.provider !== "content")
            throw new Error(
                "LongMemEval supports only product-native content memory",
            );
        if (options.mode && options.mode !== "agent")
            throw new Error(
                "LongMemEval requires native answering (--mode agent), not external RAG",
            );
        if (options.authorizedLiveBenchmark !== true)
            throw new Error(
                "--authorized-live-benchmark is required for LongMemEval",
            );
        required(options.input, "--input");
        required(
            options.judgeSource ?? options.protocol,
            "--judge-source or --protocol",
        );
        if (options.judgeSource && options.protocol)
            throw new Error(
                "Use either --judge-source or --protocol, not both",
            );
    }
}

const repoRoot = (value?: string) =>
    path.resolve(
        value ??
            execFileSync("git", ["rev-parse", "--show-toplevel"], {
                encoding: "utf8",
            }).trim(),
    );

async function runBeam(options: CliOptions) {
    const output = path.resolve(options.output);
    const controller = new AbortController();
    const stop = () =>
        controller.abort(new Error("Benchmark interrupted by signal"));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
        await run({
            dataset: "beam",
            output,
            progress: required(options.progress, "--progress"),
            protocol: required(options.protocol, "--protocol"),
            repo: repoRoot(options.repo),
            cache: path.resolve(options.cache ?? path.join(output, "datasets")),
            ...(options.input ? { input: path.resolve(options.input) } : {}),
            ...(options.unit ? { unit: options.unit } : {}),
            split: options.split ?? "100k",
            stage: options.stage ?? "smoke",
            provider: options.provider ?? "content",
            mode: options.mode ?? "rag",
            signal: controller.signal,
        });
    } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
    }
}

async function runLongMemEvalOptions(options: CliOptions) {
    const args = [
        "--authorized-live-benchmark",
        "--product",
        path.resolve(
            options.product ?? path.join(repoRoot(options.repo), "ts"),
        ),
        "--dataset",
        required(options.input, "--input"),
        "--variant",
        options.variant ?? "s-cleaned",
        "--judge-source",
        required(options.judgeSource ?? options.protocol, "--judge-source"),
        "--output",
        path.resolve(options.output),
        "--max-questions",
        options.maxQuestions ?? "500",
        "--work-minutes",
        options.workMinutes ?? "30",
        "--startup-minutes",
        options.startupMinutes ?? "2",
    ];
    const optionalArguments: [string, string | undefined][] = [
        ["--question-ids", options.questionIds],
        ["--resume", options.resume ? path.resolve(options.resume) : undefined],
        [
            "--progress",
            options.progress ? path.resolve(options.progress) : undefined,
        ],
    ];
    for (const [flag, value] of optionalArguments)
        if (value) args.push(flag, value);
    if (options.continueAfterImportFailure)
        args.push("--continue-after-import-failure");
    await runLongMemEval(args);
}

export function createMemoryBenchCommand() {
    const command = new Command()
        .name("memory-bench")
        .description("BEAM and LongMemEval conversation-memory benchmarks");
    command
        .command("prepare-protocol")
        .description(
            "Prepare BEAM's pinned AMB protocol; LongMemEval uses its pinned judge source directly",
        )
        .requiredOption("--amb-root <path>")
        .requiredOption("--output <path>")
        .action(async (options: { ambRoot: string; output: string }) => {
            await prepareProtocol(
                path.resolve(options.ambRoot),
                path.resolve(options.output),
            );
            console.error(
                `Prepared pinned AMB protocol: ${path.resolve(options.output)}`,
            );
        });
    command
        .command("run")
        .description(
            "Run/resume BEAM or an explicitly authorized, supervised LongMemEval arm",
        )
        .requiredOption(
            "--output <path>",
            "existing artifact parent (LongMemEval creates an owned child)",
        )
        .addOption(
            new Option("--dataset <name>")
                .choices(["beam", "longmemeval"])
                .default("beam"),
        )
        .option(
            "--progress <path>",
            "durable progress registry; LongMemEval also writes per-run progress.json",
        )
        .option(
            "--protocol <path>",
            "BEAM prepared protocol JSON or pinned LongMemEval judge source",
        )
        .option("--repo <path>", "repository root")
        .option("--cache <path>", "BEAM dataset cache")
        .option(
            "--input <path>",
            "local BEAM export or pinned LongMemEval JSON",
        )
        .option("--unit <id>", "BEAM conversation ID")
        .addOption(
            new Option("--split <name>", "BEAM split").choices([...beamSplits]),
        )
        .addOption(
            new Option("--stage <name>", "BEAM sampling stage").choices([
                "smoke",
                "qualification",
                "full",
                "suite",
            ]),
        )
        .addOption(
            new Option(
                "--provider <name>",
                "BEAM provider; LongMemEval supports content only",
            ).choices(["bm25", "content", "events"]),
        )
        .addOption(
            new Option(
                "--mode <name>",
                "agent = native memory answer, not an autonomous loop",
            ).choices(["rag", "agent"]),
        )
        .option(
            "--product <path>",
            "LongMemEval built ts root (defaults to <repo>\\ts)",
        )
        .addOption(
            new Option(
                "--variant <name>",
                "LongMemEval variant (default: s-cleaned); oracle is evidence-only, not S accuracy",
            ).choices(["s-cleaned", "oracle"]),
        )
        .option(
            "--judge-source <path>",
            "LongMemEval pinned official evaluate_qa.py",
        )
        .option(
            "--question-ids <ids>",
            "LongMemEval diagnostic IDs, comma-separated; dataset order retained",
        )
        .option(
            "--max-questions <number>",
            "LongMemEval fixed invocation target, 1-500 (default: 500)",
        )
        .option(
            "--work-minutes <minutes>",
            "LongMemEval work 1-30 or unlimited; default 30, plus 5-minute cleanup",
        )
        .option(
            "--startup-minutes <minutes>",
            "LongMemEval startup limit 1-10 (default: 2)",
        )
        .option(
            "--authorized-live-benchmark",
            "authorize LongMemEval inference with configured models",
        )
        .option(
            "--resume <path>",
            "LongMemEval owned package-run directory; historical engines are rejected",
        )
        .option(
            "--continue-after-import-failure",
            "skip verified failed imports without answering partial histories",
        )
        .action(async (options: CliOptions) => {
            validateDatasetOptions(options);
            if (options.dataset === "beam") await runBeam(options);
            else await runLongMemEvalOptions(options);
        });
    return command;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    createMemoryBenchCommand()
        .parseAsync()
        .catch((error: unknown) => {
            console.error(error instanceof Error ? error.stack : String(error));
            process.exitCode = 1;
        });
