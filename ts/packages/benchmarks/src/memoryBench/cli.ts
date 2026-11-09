// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { Command, Option } from "commander";
import { prepareProtocol } from "./protocol.js";
import { run } from "./runner.js";
import { beamSplits } from "./data.js";
import type { RunOptions } from "./runner.js";

const command = new Command().description("TypeScript BEAM memory benchmarks");
command
    .command("prepare-protocol")
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
    .requiredOption("--output <path>")
    .requiredOption("--progress <path>")
    .requiredOption("--protocol <path>")
    .option("--repo <path>")
    .option("--cache <path>")
    .option("--input <path>")
    .option("--unit <id>")
    .addOption(new Option("--dataset <name>").choices(["beam"]).default("beam"))
    .addOption(
        new Option("--split <name>").choices([...beamSplits]).default("100k"),
    )
    .addOption(
        new Option("--stage <name>")
            .choices(["smoke", "qualification", "full", "suite"])
            .default("smoke"),
    )
    .addOption(
        new Option("--provider <name>")
            .choices(["bm25", "content", "events"])
            .default("content"),
    )
    .addOption(
        new Option("--mode <name>").choices(["rag", "agent"]).default("rag"),
    )
    .action(
        async (
            options: Omit<RunOptions, "repo" | "cache"> & {
                repo?: string;
                cache?: string;
            },
        ) => {
            const output = path.resolve(options.output);
            const controller = new AbortController();
            const stop = () =>
                controller.abort(new Error("Benchmark interrupted by signal"));
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            try {
                await run({
                    ...options,
                    output,
                    progress: path.resolve(options.progress),
                    protocol: path.resolve(options.protocol),
                    cache: path.resolve(
                        options.cache ?? path.join(output, "datasets"),
                    ),
                    repo: path.resolve(
                        options.repo ??
                            execFileSync(
                                "git",
                                ["rev-parse", "--show-toplevel"],
                                { encoding: "utf8" },
                            ).trim(),
                    ),
                    signal: controller.signal,
                });
            } finally {
                process.removeListener("SIGINT", stop);
                process.removeListener("SIGTERM", stop);
            }
        },
    );
command.parseAsync().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
