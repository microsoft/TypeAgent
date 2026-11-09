// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { Command, Option } from "commander";
import { prepareDataset } from "./datasets.js";
import { saveJson } from "../memoryBench/storage.js";
import { runBenchmark, type RunOptions } from "./runner.js";
import { armSchema, type DatasetName } from "./types.js";
import { runNativeAnswers, type NativeAnswerOptions } from "./nativeAnswers.js";
import {
    runIncremental,
    type IncrementalOptions,
} from "./incrementalRunner.js";
import {
    analyzeIncremental,
    replayNativeCoverage,
} from "./incrementalAnalysis.js";
import { requireOutside } from "./incrementalSnapshots.js";

const command = new Command().description(
    "Independent source-span retrieval benchmark; not article parity",
);
command
    .command("prepare")
    .addOption(
        new Option("--dataset <name>")
            .choices(["qasper", "legalbenchrag", "qmsum"])
            .makeOptionMandatory(),
    )
    .requiredOption(
        "--input <path>",
        "Official Qasper JSON, QMSum JSONL, or LegalBench data directory",
    )
    .requiredOption(
        "--source <url>",
        "Pinned upstream source/revision, recorded with raw input digest",
    )
    .requiredOption("--split <name>")
    .requiredOption("--output <path>")
    .requiredOption(
        "--terms-reviewed",
        "Confirm dataset processing terms have been reviewed",
    )
    .action(
        async (options: {
            dataset: DatasetName;
            input: string;
            source: string;
            split: string;
            output: string;
            termsReviewed: boolean;
        }) => {
            if (!options.termsReviewed)
                throw new Error("Dataset terms must be reviewed");
            const input = path.resolve(options.input);
            const output = path.resolve(options.output);
            const relative = path.relative(input, output);
            if (
                !relative ||
                (options.dataset === "legalbenchrag" &&
                    relative !== ".." &&
                    !relative.startsWith(`..${path.sep}`) &&
                    !path.isAbsolute(relative))
            )
                throw new Error(
                    "Prepared output must not overwrite or modify the raw input corpus",
                );
            const dataset = await prepareDataset(
                options.dataset,
                input,
                options.split,
                options.source,
            );
            await saveJson(output, dataset);
            process.stdout.write(
                JSON.stringify(
                    {
                        dataset: dataset.dataset,
                        documents: dataset.documents.length,
                        questions: dataset.questions.length,
                        excluded: dataset.exclusions.length,
                        provenance: dataset.provenance,
                    },
                    null,
                    2,
                ) + "\n",
            );
        },
    );
command
    .command("run")
    .requiredOption("--input <path>", "Prepared dataset manifest")
    .requiredOption("--output <path>", "Fresh run-owned directory outside Git")
    .option("--repo <path>")
    .option(
        "--arms <names>",
        "Comma-separated bm25,ordinary,indexed,vector,hybrid",
        "bm25",
    )
    .option("--budget <tokens>", "Delivered cl100k token budget", integer, 2000)
    .option("--size <tokens>", "Comparator maximum chunk tokens", integer, 512)
    .option("--overlap <tokens>", "Comparator overlap tokens", integer, 0)
    .option(
        "--questions <count>",
        "Hash-ordered smoke questions; 0 means all",
        integer,
        10,
    )
    .option(
        "--candidate-limit <count>",
        "Comparator candidate depth",
        integer,
        200,
    )
    .option(
        "--embedding-token-limit <tokens>",
        "Explicit vector input guard; required for vector arms",
        integer,
        0,
    )
    .addOption(
        new Option("--strategy <name>")
            .choices(["fixed", "sentence", "paragraph", "structure", "whole"])
            .default("fixed"),
    )
    .option(
        "--headers",
        "Prepend approved document/section identity to comparator chunks",
        false,
    )
    .action(
        async (
            values: Omit<RunOptions, "arms" | "repo"> & {
                arms: string;
                repo?: string;
            },
        ) => {
            const controller = new AbortController();
            const stop = () =>
                controller.abort(new Error("Benchmark interrupted"));
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            try {
                const result = await runBenchmark({
                    ...values,
                    input: path.resolve(values.input),
                    output: path.resolve(values.output),
                    arms: values.arms
                        .split(",")
                        .map((arm) => armSchema.parse(arm)),
                    repo: path.resolve(
                        values.repo ??
                            execFileSync(
                                "git",
                                ["rev-parse", "--show-toplevel"],
                                { encoding: "utf8" },
                            ).trim(),
                    ),
                    signal: controller.signal,
                    progress: (message) => process.stderr.write(message + "\n"),
                });
                process.stdout.write(
                    JSON.stringify(result.summary, null, 2) + "\n",
                );
                if (result.rows.some((row) => row.state === "failed"))
                    process.exitCode = 1;
            } finally {
                process.removeListener("SIGINT", stop);
                process.removeListener("SIGTERM", stop);
            }
        },
    );

command
    .command("answer")
    .description(
        "Native answer stack on a frozen QMSum corpus; no added evidence cap",
    )
    .requiredOption(
        "--retrieval-run <path>",
        "Completed native span-retrieval run",
    )
    .requiredOption(
        "--references <path>",
        "Pinned original QMSum validation JSONL",
    )
    .requiredOption("--output <path>", "Fresh answer-run directory outside Git")
    .option("--repo <path>")
    .action(
        async (
            values: Omit<NativeAnswerOptions, "repo"> & { repo?: string },
        ) => {
            const controller = new AbortController();
            const stop = () =>
                controller.abort(
                    new Error("Native answer baseline interrupted"),
                );
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            try {
                const result = await runNativeAnswers({
                    ...values,
                    retrievalRun: path.resolve(values.retrievalRun),
                    references: path.resolve(values.references),
                    output: path.resolve(values.output),
                    repo: path.resolve(
                        values.repo ??
                            execFileSync(
                                "git",
                                ["rev-parse", "--show-toplevel"],
                                {
                                    encoding: "utf8",
                                },
                            ).trim(),
                    ),
                    signal: controller.signal,
                    progress: (message) => process.stderr.write(message + "\n"),
                });
                process.stdout.write(
                    JSON.stringify(result.summary, null, 2) + "\n",
                );
                if (result.summary.failed) process.exitCode = 1;
            } finally {
                process.removeListener("SIGINT", stop);
                process.removeListener("SIGTERM", stop);
            }
        },
    );

command
    .command("paired")
    .description(
        "Preregister or resume the inspected native N0–N3 BM25 pilot; no ingestion",
    )
    .addOption(
        new Option("--dataset <name>")
            .choices(["qmsum", "beam"])
            .makeOptionMandatory(),
    )
    .requiredOption(
        "--snapshot <path>",
        "Frozen QMSum retrieval run or BEAM content-agent qualification archive",
    )
    .requiredOption(
        "--references <path>",
        "Pinned QMSum JSONL or BEAM JSON cache (evaluator only)",
    )
    .requiredOption(
        "--output <path>",
        "New experiment root outside Git and source archives",
    )
    .option(
        "--protocol <path>",
        "Pinned official AMB protocol, required for BEAM",
    )
    .option(
        "--baseline-answers <path>",
        "Existing QMSum native answer manifest pin when ingestion lacks reader-model identity",
    )
    .option("--repo <path>")
    .option(
        "--prepare-only",
        "Validate cloned store and freeze preregistration without answer/judge calls",
    )
    .option(
        "--new-query-lineage",
        "Fresh current-model N0/all arms; old chat config is provenance only; exact index/embedding compatibility still required",
    )
    .addOption(
        new Option("--n4-gate <name>").choices(["empty", "term-coverage"]),
    )
    .addOption(
        new Option("--n4-intervention <name>").choices(["N1", "N2", "N3"]),
    )
    .action(
        async (
            values: Omit<IncrementalOptions, "repo" | "n4"> & {
                repo?: string;
                n4Gate?: "empty" | "term-coverage";
                n4Intervention?: "N1" | "N2" | "N3";
            },
        ) => {
            if (Boolean(values.n4Gate) !== Boolean(values.n4Intervention))
                throw new Error(
                    "N4 needs both --n4-gate and --n4-intervention",
                );
            const controller = new AbortController();
            const stop = () =>
                controller.abort(new Error("Incremental pilot interrupted"));
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            try {
                const result = await runIncremental({
                    ...values,
                    snapshot: path.resolve(values.snapshot),
                    references: path.resolve(values.references),
                    output: path.resolve(values.output),
                    ...(values.protocol
                        ? { protocol: path.resolve(values.protocol) }
                        : {}),
                    ...(values.baselineAnswers
                        ? {
                              baselineAnswers: path.resolve(
                                  values.baselineAnswers,
                              ),
                          }
                        : {}),
                    repo: path.resolve(
                        values.repo ??
                            execFileSync(
                                "git",
                                ["rev-parse", "--show-toplevel"],
                                { encoding: "utf8" },
                            ).trim(),
                    ),
                    ...(values.n4Gate
                        ? {
                              n4: {
                                  gate: values.n4Gate,
                                  intervention: values.n4Intervention!,
                              },
                          }
                        : {}),
                    signal: controller.signal,
                    progress: (message) => process.stderr.write(message + "\n"),
                });
                process.stdout.write(JSON.stringify(result, null, 2) + "\n");
                if (result.state === "partial") process.exitCode = 1;
            } finally {
                process.removeListener("SIGINT", stop);
                process.removeListener("SIGTERM", stop);
            }
        },
    );

command
    .command("paired-analyze")
    .requiredOption("--output <path>", "Existing experimental root")
    .action(async (values: { output: string }) => {
        process.stdout.write(
            JSON.stringify(
                await analyzeIncremental(path.resolve(values.output)),
                null,
                2,
            ) + "\n",
        );
    });

command
    .command("coverage-replay")
    .requiredOption(
        "--baseline <path>",
        "Saved native-answer baseline scorecard directory",
    )
    .requiredOption("--output <path>", "Offline report file outside baseline")
    .action(async (values: { baseline: string; output: string }) => {
        const baseline = path.resolve(values.baseline);
        const output = path.resolve(values.output);
        requireOutside(baseline, output);
        await saveJson(output, await replayNativeCoverage(baseline));
    });

function integer(value: string) {
    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error(`Expected a nonnegative integer: ${value}`);
    return Number(value);
}

command.parseAsync().catch((error: unknown) => {
    process.stderr.write(
        (error instanceof Error ? error.stack : String(error)) + "\n",
    );
    process.exitCode = 1;
});
