// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { fromJsonActions, toFullActions, FullAction } from "agent-cache";
import { createDispatcher } from "agent-dispatcher";
import {
    readExplanationTestData,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import chalk from "chalk";
import fs from "node:fs";
import { getElapsedString } from "common-utils";
import { getChatModelNames, openai as ai } from "aiclient";

type TestResult = {
    request: string;
    actions: (FullAction[] | undefined)[];
};

type FailedTestResult = {
    request: string;
    actions?: (FullAction[] | undefined)[];
};

type TestResultFile = {
    pass: TestResult[];
    fail: FailedTestResult[];
    skipped?: string[];
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
        if (entry.actions === undefined) {
            continue;
        }
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

const modelNames = await getChatModelNames();
const defaultAppAgentProviders = getDefaultAppAgentProviders(getInstanceDir());
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);
const defaultConstructionProvider = getDefaultConstructionProvider();
const defaultRepeat = 5;

function addTokenUsage(
    total: ai.CompletionUsageStats,
    usage: ai.CompletionUsageStats,
) {
    total.prompt_tokens += usage.prompt_tokens;
    total.completion_tokens += usage.completion_tokens;
    total.total_tokens += usage.total_tokens;
}

function getTokenUsageStr(usage: ai.CompletionUsageStats, count: number = 1) {
    return `${Math.round(usage.prompt_tokens / count)}+${Math.round(usage.completion_tokens / count)}=${Math.round(usage.total_tokens / count)}`;
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
        schema: Flags.string({
            description: "Schema names",
            options: schemaNames,
            multiple: true,
        }),
        multiple: Flags.boolean({
            description: "Include multiple action schema",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
        jsonSchema: Flags.boolean({
            description: "Output JSON schema",
            default: false, // follow DispatcherOptions default
        }),
        jsonSchemaFunction: Flags.boolean({
            description: "Output JSON schema function",
            default: false, // follow DispatcherOptions default
            exclusive: ["jsonSchema"],
        }),
        jsonSchemaValidate: Flags.boolean({
            description: "Validate the output when JSON schema is enabled",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        schemaOptimization: Flags.boolean({
            description: "Enable schema optimization",
        }),
        switchFixedInitial: Flags.string({
            description:
                "Use fixed schema group to determine the first schema to use",
            options: schemaNames,
        }),
        switchEmbedding: Flags.boolean({
            description: "Use embedding to determine the first schema to use",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        switchInline: Flags.boolean({
            description: "Use inline switch schema to select schema group",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        switchSearch: Flags.boolean({
            description:
                "Enable second chance full switch schema to find schema group",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        stream: Flags.boolean({
            description: "Enable streaming",
            default: true, // follow DispatcherOptions default
            allowNo: true,
        }),
        cache: Flags.boolean({
            description: "Enable caching",
            default: false,
        }),
        concurrency: Flags.integer({
            char: "c",
            description: "Number of concurrent requests (default to 4)",
        }),
        repeat: Flags.integer({
            char: "r",
            description: `Repeat the test for the specified number of times (default to ${defaultRepeat})`,
        }),
        output: Flags.string({
            char: "o",
            description: "Output test result file",
            required: true,
        }),
        succeeded: Flags.boolean({
            description:
                "Copy failed test data and rerun only successful tests from the test result file",
        }),
        failed: Flags.boolean({
            description:
                "Copy pass test data and rerun only failed tests from the test result file",
        }),
        skipped: Flags.boolean({
            description:
                "Copy skipped test data and rerun only skipped tests from the test result file",
        }),
        input: Flags.string({
            char: "i",
            description: "Input test result file to get requests from",
        }),
        summarize: Flags.string({
            description: "Summarize test result file",
        }),
        sample: Flags.integer({
            description: "number of sample to run",
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
        let requests: string[] = [];
        let repeat: number;
        if (flags.input) {
            if (argv.length !== 0) {
                throw new Error(
                    "No files should be specified when using --input flags",
                );
            }

            const input: TestResultFile = JSON.parse(
                fs.readFileSync(flags.input, "utf-8"),
            );

            if (input.pass.length === 0 && input.fail.length === 0) {
                throw new Error("Result file is empty. No tests to rerun.");
            }

            const includeAll =
                !flags.succeeded && !flags.failed && !flags.skipped;

            if (includeAll) {
                repeat = flags.repeat ?? defaultRepeat;
            } else {
                // determine repeat
                if (input.pass.length !== 0) {
                    repeat = input.pass[0].actions.length;
                } else {
                    const e = input.fail.find((e) => e.actions !== undefined);
                    if (e === undefined) {
                        repeat = flags.repeat ?? defaultRepeat;
                    } else {
                        repeat = e?.actions!.length;
                    }
                }
                if (flags.repeat !== undefined && flags.repeat !== repeat) {
                    throw new Error(
                        "Specified repeat doesn't match result file",
                    );
                }
            }

            if (includeAll || flags.succeeded) {
                requests = requests.concat(
                    input.pass.map((entry) => entry.request),
                );
            } else {
                output.pass = input.pass;
            }
            if (includeAll || flags.failed) {
                requests = requests.concat(
                    input.fail.map((entry) => entry.request),
                );
            } else {
                output.fail = input.fail;
            }

            if (input.skipped !== undefined) {
                if (includeAll || flags.skipped) {
                    requests = requests.concat(input.skipped);
                } else {
                    output.skipped = input.skipped;
                }
            }
        } else {
            repeat = flags.repeat ?? defaultRepeat;
            const files =
                argv.length > 0
                    ? (argv as string[])
                    : await defaultConstructionProvider.getImportTranslationFiles();

            const inputs = await Promise.all(
                files.map(async (file) => {
                    return { file, data: await readExplanationTestData(file) };
                }),
            );

            requests = inputs
                .flatMap((input) =>
                    input.data.entries.map((e) => ({
                        request: e.request,
                        actions: toFullActions(fromJsonActions(e.action)),
                    })),
                )
                .map((entry) => entry.request);
        }

        if (repeat <= 0) {
            throw new Error("Repeat must be greater than 0");
        }

        let countStr = requests.length.toString();
        if (flags.sample !== undefined) {
            output.skipped = [];
            while (flags.sample < requests.length) {
                output.skipped.push(
                    ...requests.splice(
                        Math.floor(Math.random() * requests.length),
                        1,
                    ),
                );
            }
            countStr = `${requests.length}/${countStr}`;
        }

        let failedTotal = 0;
        let noActions = 0;
        let processed = 0;

        const totalStr = requests.length.toString();
        function print(msg: string) {
            processed++;
            console.log(
                `${chalk.white(`[${processed.toString().padStart(totalStr.length)}/${totalStr}]`)} ${chalk.yellow(`[Fail: ${failedTotal.toString().padStart(totalStr.length)} (${((failedTotal / processed) * 100).toFixed(2).padStart(5)}%)]`)} ${msg}`,
            );
        }
        const concurrency = flags.concurrency ?? 4;
        console.log(
            `Starting ${countStr} tests (concurrency: ${concurrency}, repeat: ${repeat})`,
        );
        const startTime = performance.now();

        let totalExecTime = 0;
        let maxExecTime = 0;
        const totalTokenUsage: ai.CompletionUsageStats = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        async function worker() {
            const dispatcher = await createDispatcher("cli test translate", {
                appAgentProviders: defaultAppAgentProviders,
                agents: {
                    schemas: flags.schema,
                    actions: false,
                    commands: ["dispatcher"],
                },
                translation: {
                    stream: flags.stream,
                    history: { enabled: false },
                    model: flags.model,
                    multiple: { enabled: flags.multiple },
                    schema: {
                        generation: {
                            jsonSchema: flags.jsonSchema,
                            jsonSchemaFunction: flags.jsonSchemaFunction,
                            jsonSchemaValidate: flags.jsonSchemaValidate,
                        },
                        optimize: {
                            enabled: flags.schemaOptimization,
                        },
                    },
                    switch: {
                        fixed: flags.switchFixedInitial,
                        embedding: flags.switchEmbedding,
                        inline: flags.switchInline,
                        search: flags.switchSearch,
                    },
                },
                explainer: { enabled: false },
                cache: { enabled: flags.cache },
                collectCommandResult: true,
                constructionProvider: defaultConstructionProvider,
            });
            if (flags.cache) {
                await dispatcher.processCommand("@const import -t");
            }
            while (requests.length > 0) {
                const request = requests.shift()!;

                const results: (FullAction[] | undefined)[] = [];

                let currentTotalExecTime = 0;
                let currentMaxExecTime = 0;
                const currentTokenUsage: ai.CompletionUsageStats = {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                };
                let maxTokenUsage: ai.CompletionUsageStats = {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                };

                for (let i = 0; i < repeat; i++) {
                    const time = performance.now();
                    const commandResult =
                        await dispatcher.processCommand(request);
                    const execTime = performance.now() - time;
                    currentMaxExecTime = Math.max(currentMaxExecTime, execTime);
                    currentTotalExecTime += execTime;

                    const tokenUsage = commandResult?.tokenUsage;
                    if (tokenUsage) {
                        addTokenUsage(currentTokenUsage, tokenUsage);
                        addTokenUsage(totalTokenUsage, tokenUsage);

                        if (
                            tokenUsage.total_tokens > maxTokenUsage.total_tokens
                        ) {
                            maxTokenUsage = tokenUsage;
                        }
                    }
                    results.push(commandResult?.actions);
                }

                maxExecTime = Math.max(maxExecTime, currentMaxExecTime);
                totalExecTime += currentTotalExecTime;

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
                        print(
                            chalk.red(
                                `Failed to consistently generate actions`,
                            ),
                        );
                        break;
                    }
                    if (actual === undefined) {
                        failedTotal++;
                        failed = true;
                        print(
                            chalk.red(
                                `Failed to consistently generate actions`,
                            ),
                        );
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
                    let msg = "Passed";
                    if (expected === undefined) {
                        noActions++;
                        msg = "Passed (no actions)";
                    }
                    const timeStr =
                        repeat === 1
                            ? getElapsedString(currentTotalExecTime)
                            : `${getElapsedString(currentTotalExecTime)} (${getElapsedString(currentTotalExecTime / repeat)}/call) Max: ${getElapsedString(currentMaxExecTime)}`;
                    const avgTokenStr = getTokenUsageStr(
                        currentTokenUsage,
                        repeat,
                    );
                    const maxTokenStr = getTokenUsageStr(maxTokenUsage);

                    const tokenStr =
                        repeat === 1
                            ? `(Token: ${avgTokenStr})`
                            : avgTokenStr === maxTokenStr
                              ? `(Token Avg: ${avgTokenStr})`
                              : `(Token Avg: ${avgTokenStr} Max: ${maxTokenStr})`;
                    print(
                        `${chalk.green(msg)} ${chalk.grey(timeStr)} ${tokenStr}`,
                    );
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

        const totalData =
            output.pass.length +
            output.fail.length +
            (output.skipped?.length ?? 0);
        const totalDataStr = totalData.toString();
        const numberLength = totalDataStr.length;
        function printPart(name: string, count: number, total: number) {
            if (count > 0) {
                console.log(
                    `${name.padEnd(15)}: ${count.toString().padStart(numberLength)} (${((count / total) * 100).toFixed(2)}%)`,
                );
            }
        }
        console.log("=".repeat(60));
        console.log(`Stability (repeat: ${repeat})`);
        console.log("=".repeat(60));
        console.log("Current Run:");
        console.log(
            `Total          : ${processed.toString().padStart(numberLength)}`,
        );
        printPart("Passed", succeededTotal, processed);
        printPart("Failed", failedTotal, processed);
        printPart("No Actions", noActions, processed);

        console.log("=".repeat(60));
        console.log("All Data:");
        console.log(`Total          : ${totalDataStr.padStart(numberLength)}`);
        printPart("Passed", output.pass.length, totalData);
        printPart("Failed", output.fail.length, totalData);
        printPart("Skipped", output.skipped?.length ?? 0, totalData);
        console.log("=".repeat(60));
        console.log(`Concurrency: ${concurrency}`);
        const elapsed = endTime - startTime;
        const elapsedPerRequest = elapsed / processed;
        const elapsedPerCall = elapsedPerRequest / repeat;
        console.log(
            `Elapsed Time: ${getElapsedString(elapsed)}, Avg: ${getElapsedString(elapsedPerRequest)} (${getElapsedString(elapsedPerCall)}/call)`,
        );

        const executionTimePerRequest = totalExecTime / processed;
        const executionTimePerCall = executionTimePerRequest / repeat;
        console.log(
            `Execution Time: ${getElapsedString(totalExecTime)}, Avg: ${getElapsedString(executionTimePerRequest)} (${getElapsedString(executionTimePerCall)}/call) Max: ${getElapsedString(maxExecTime)}`,
        );
        console.log(
            `Token Usage: ${getTokenUsageStr(totalTokenUsage)}, Avg per call: ${getTokenUsageStr(totalTokenUsage, processed * repeat)}`,
        );
    }
}
