// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { Actions, FullAction } from "agent-cache";
import { createDispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getSchemaNamesFromDefaultAppAgentProviders,
    getTestDataFiles,
    readTestData,
} from "agent-dispatcher/internal";
import chalk from "chalk";
import fs from "node:fs";
import { getElapsedString } from "common-utils";

type TestResult = {
    request: string;
    actions: (FullAction[] | undefined)[];
};

type TestResultFile = {
    pass: TestResult[];
    fail: TestResult[];
};

function summarizeResult(result: TestResultFile) {
    const failed = result.fail.length;
    const passed = result.pass.length;

    let exact = 0;
    for (const entry of result.pass) {
        const expected = JSON.stringify(entry.actions[0]);
        if (
            entry.actions.every(
                (actions) => JSON.stringify(actions) === expected,
            )
        ) {
            exact++;
        }
    }

    let inconsistent = new Map<string | undefined, number>();
    for (const entry of result.fail) {
        const actionNames = entry.actions.map((actions) =>
            actions
                ?.map((a) => a.translatorName + "." + a.actionName)
                .join(",")
                .padEnd(20),
        );
        const key = Array.from(new Set(actionNames)).sort().join(" | ");

        inconsistent.set(key, (inconsistent.get(key) ?? 0) + 1);
    }

    const total = failed + passed;
    console.log(`Total: ${total}`);
    console.log(
        `Passed: ${passed} (${((passed / total) * 100).toFixed(2)}%) [Exact: ${exact} (${((exact / total) * 100).toFixed(2)}%)]`,
    );
    console.log(`Failed: ${failed} (${((failed / total) * 100).toFixed(2)}%)`);
    const inconsistentSorted = Array.from(inconsistent.entries()).sort(
        (a, b) => b[1] - a[1],
    );
    for (const [key, count] of inconsistentSorted) {
        console.log(`  ${(key ?? "undefined").padEnd(80)}: ${count}`);
    }
}
export default class TestTranslateCommand extends Command {
    static args = {
        files: Args.string({
            files: Args.string({
                description:
                    "List of test data files. Default to all test files in the config.json.",
            }),
        }),
    };
    static flags = {
        translator: Flags.string({
            description: "Schema names",
            options: getSchemaNamesFromDefaultAppAgentProviders(),
            multiple: true,
        }),
        concurrency: Flags.integer({
            char: "c",
            description: "Number of concurrent requests (default to 4)",
        }),
        repeat: Flags.integer({
            char: "r",
            description:
                "Repeat the test for the specified number of times (default to 1)",
        }),
        output: Flags.string({
            char: "o",
            description: "Output test result file",
        }),
        rerun: Flags.string({
            char: "R",
            description: "Rerun failed tests from the test result file",
        }),
        summarize: Flags.string({
            char: "s",
            description: "Summarize test result file",
        }),
    };
    async run(): Promise<void> {
        const { flags, argv } = await this.parse(TestTranslateCommand);

        if (flags.summarize) {
            if (argv.length !== 0) {
                throw new Error(
                    "No files should be specified when summarizing result",
                );
            }

            const result: TestResultFile = JSON.parse(
                fs.readFileSync(flags.summarize, "utf-8"),
            );
            summarizeResult(result);
            return;
        }

        const output: TestResultFile = { pass: [], fail: [] };
        let requests: string[];
        let repeat: number;
        if (flags.rerun) {
            if (argv.length !== 0) {
                throw new Error(
                    "No files should be specified when rerunning failed tests",
                );
            }

            const rerun: TestResultFile = JSON.parse(
                fs.readFileSync(flags.rerun, "utf-8"),
            );

            if (rerun.pass.length === 0 && rerun.fail.length === 0) {
                throw new Error("Result file is empty. No tests to rerun.");
            }

            repeat =
                rerun.pass.length !== 0
                    ? rerun.pass[0].actions.length
                    : rerun.fail[0].actions.length;

            output.pass = rerun.pass;
            requests = rerun.fail.map((entry) => entry.request);
            if (flags.repeat !== undefined && flags.repeat !== repeat) {
                throw new Error("Specified repeat doesn't match result file");
            }
        } else {
            repeat = flags.repeat ?? 1;
            const files =
                argv.length > 0 ? (argv as string[]) : await getTestDataFiles();

            const inputs = await Promise.all(
                files.map(async (file) => {
                    return { file, data: await readTestData(file) };
                }),
            );

            requests = inputs
                .flatMap((input) =>
                    input.data.entries.map((e) => ({
                        request: e.request,
                        actions: Actions.fromJSON(e.action).toFullActions(),
                    })),
                )
                .map((entry) => entry.request);
        }

        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;
        let failedTotal = 0;
        let noActions = 0;
        let processed = 0;

        const totalStr = requests.length.toString();
        function print(msg: string) {
            processed++;
            console.log(
                `[${processed.toString().padStart(totalStr.length)}/${totalStr}] ${chalk.yellow(`[Fail: ${failedTotal.toString().padStart(totalStr.length)} (${((failedTotal / processed) * 100).toFixed(2).padStart(5)}%)]`)} ${msg}`,
            );
        }
        const concurrency = flags.concurrency ?? 4;
        console.log(
            `Starting ${requests.length} tests (concurrency: ${concurrency}, repeat: ${repeat})`,
        );
        const startTime = performance.now();

        async function worker() {
            const dispatcher = await createDispatcher("cli test translate", {
                appAgentProviders: getDefaultAppAgentProviders(),
                schemas,
                actions: null,
                commands: { dispatcher: true },
                translation: { history: false },
                explainer: { enabled: false },
                cache: { enabled: false },
            });
            while (requests.length > 0) {
                const request = requests.shift()!;

                const results: (FullAction[] | undefined)[] = [];
                for (let i = 0; i < repeat; i++) {
                    const commandResult =
                        await dispatcher.processCommand(request);
                    results.push(commandResult?.actions);
                }

                const expected = results[0];
                let failed = false;
                for (let i = 1; i < results.length; i++) {
                    const actual = results[i];
                    if (expected === undefined) {
                        if (actual === undefined) {
                            continue;
                        }

                        failedTotal++;
                        failed = true;
                        break;
                    }
                    if (actual === undefined) {
                        failedTotal++;
                        failed = true;
                        break;
                    }
                    if (actual.length !== expected.length) {
                        failedTotal++;
                        failed = true;
                        print(
                            chalk.red(
                                `Failed (number of actions, actual: ${actual?.length}, expected: ${expected.length})`,
                            ),
                        );
                        break;
                    }
                    for (let i = 0; i < actual.length; i++) {
                        if (
                            actual[i].translatorName !==
                                expected[i].translatorName ||
                            actual[i].actionName !== expected[i].actionName
                        ) {
                            print(
                                chalk.red(
                                    `Failed (${actual[i].translatorName}.${actual[i].actionName}) !== (${expected[i].translatorName}.${expected[i].actionName})`,
                                ),
                            );
                            failedTotal++;
                            failed = true;
                            break;
                        }
                    }
                    if (failed) {
                        break;
                    }
                }

                if (flags.output) {
                    (failed ? output.fail : output.pass).push({
                        request,
                        actions: results,
                    });
                    fs.writeFileSync(
                        flags.output,
                        JSON.stringify(output, null, 2),
                    );
                }
                if (!failed) {
                    if (expected === undefined) {
                        noActions++;
                        print(chalk.green("Passed (no actions)"));
                    } else {
                        print(chalk.green("Passed"));
                    }
                }
            }
            await dispatcher.close();
        }

        const w: Promise<void>[] = [];
        for (let i = 0; i < concurrency; i++) {
            w.push(worker());
        }
        await Promise.all(w);

        const endTime = performance.now();
        const succeededTotal = processed - noActions - failedTotal;

        function printPart(name: string, count: number) {
            if (count > 0) {
                console.log(
                    `${name.padEnd(15)}: ${count.toString().padStart(3)} (${((count / processed) * 100).toFixed(2)}%)`,
                );
            }
        }
        console.log(
            `Stability (repeat: ${repeat})\nTotal          : ${processed}`,
        );
        printPart("Passed", succeededTotal);
        printPart("Failed", failedTotal);
        printPart("No Actions", noActions);

        console.log(
            `Time: ${getElapsedString(endTime - startTime)}, Average: ${getElapsedString((endTime - startTime) / processed)}`,
        );
    }
}
