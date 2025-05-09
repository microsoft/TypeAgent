// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import {
    generateExplanationTestDataFiles,
    readExplanationTestData,
    printExplanationTestDataStats,
    ExplanationTestDataEntry,
    FailedExplanationTestDataEntry,
    getCacheFactory,
    GenerateDataInput,
    getEmptyExplanationTestData,
    convertTestDataToExplanationData,
    getAllActionConfigProvider,
    createSchemaInfoProvider,
    getAppAgentName,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    ExecutableAction,
    fromJsonActions,
    getDefaultExplainerName,
    HistoryContext,
    printImportConstructionResult,
    PromptEntity,
    RequestAction,
} from "agent-cache";
import { createLimiter, getElapsedString } from "common-utils";
import { getChatModelMaxConcurrency, getChatModelNames } from "aiclient";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "default-agent-provider";

const { provider } = await getAllActionConfigProvider(
    getDefaultAppAgentProviders(getInstanceDir()),
);
const schemaInfoProvider = createSchemaInfoProvider(provider);

function toEntities(actions: ExecutableAction[]): PromptEntity[] {
    const entities: PromptEntity[] = [];
    for (const { action } of actions) {
        if (action.parameters === undefined) {
            continue;
        }
        for (const [key, value] of Object.entries(action.parameters)) {
            if (typeof value === "string") {
                entities.push({
                    name: value,
                    type: [key],
                    sourceAppAgentName: getAppAgentName(action.schemaName),
                });
            }
        }
    }
    return entities;
}

const modelNames = await getChatModelNames();
export default class ExplanationDataRegenerateCommand extends Command {
    static strict = false;
    static args = {
        files: Args.string({
            description:
                "List of explanation data files. Default to all test files in the config.json.",
        }),
    };
    static flags = {
        batch: Flags.boolean({
            description:
                "Batch processing, only save to file once the file is done",
            default: false,
        }),
        builtin: Flags.string({
            char: "b",
            description:
                "Regenerate the built-in data for the explainer specified",
            exclusive: ["output", "explainer"],
            options: getCacheFactory().getExplainerNames(),
        }),
        output: Flags.string({
            char: "o",
            description: "Output test data file if different from input",
        }),
        explainer: Flags.string({
            description: "Filter explainer",
            options: getCacheFactory().getExplainerNames(),
            multiple: true,
        }),
        override: Flags.string({
            description: "Override explainer",
            options: getCacheFactory().getExplainerNames(),
        }),
        concurrency: Flags.integer({
            char: "c",
            description:
                "Number of concurrent requests (default to max for the model or 4)",
        }),
        model: Flags.string({
            description: "Model to use",
            options: modelNames,
        }),
        explanation: Flags.boolean({
            description: "Regenerate explanation only",
            default: false,
        }),
        succeeded: Flags.boolean({
            description: "Regenerate only test data succeeded (default to all)",
            default: false,
        }),
        failed: Flags.boolean({
            description: "Regenerate only test data failed (default to all)",
            default: false,
            exclusive: ["succeeded"],
        }),
        resume: Flags.boolean({
            description: "Resume incremental regeneration",
            default: false,
        }),
        request: Flags.string({
            description:
                "Regenerate data with request matching pattern. Use * as wildcard",
            multiple: true,
        }),
        actionName: Flags.string({
            description:
                "Regenerate data with action name matching pattern. Use * as wildcard",
            multiple: true,
        }),
        correction: Flags.string({
            description:
                "Regenerate explanation with correction matching pattern. Use * as wildcard",
            multiple: true,
        }),
        error: Flags.string({
            description:
                "Regenerate explanation with error matching pattern. Use * as wildcard",
            multiple: true,
        }),
        validate: Flags.boolean({
            description:
                "Regenerate test data that is invalid with current validator",
            default: false,
        }),
        constructions: Flags.boolean({
            description: "Regenerate only constructions (built-in only)",
            dependsOn: ["builtin"],
            exclusive: [
                "explanation",
                "correction",
                "error",
                "validate",
                "succeeded",
                "failed",
                "resume",
            ],
        }),
        none: Flags.boolean({
            description: "Don't regenerate anything, but sort and report stats",
            default: false,
            exclusive: [
                "explanation",
                "correction",
                "error",
                "validate",
                "succeeded",
                "failed",
                "resume",
            ],
        }),
        entities: Flags.boolean({
            description: "Synthesize entities",
            dependsOn: ["explanation"],
            default: false,
        }),
        updateHash: Flags.boolean({
            description: "Update source hash (ignore source mismatch)",
            default: false,
        }),
    };
    static description = "Regenerate the data in the explanation data file";
    static example = [
        `$ <%= config.bin %> <%= command.id %> -f data.json`,
        `$ <%= config.bin %> <%= command.id %> -f test/data/explanations/**/**/*.json --explainer ${getDefaultExplainerName()} --correction *`,
        `$ <%= config.bin %> <%= command.id %> -b ${getDefaultExplainerName()}`,
    ];

    async run(): Promise<void> {
        const { flags, argv } = await this.parse(
            ExplanationDataRegenerateCommand,
        );
        if (argv.length > 0 && flags.builtin) {
            throw new Error(
                "Cannot specify both file and builtin at the same time",
            );
        }

        const startTime = performance.now();

        const builtinConstructionConfig = flags.builtin
            ? getDefaultConstructionProvider().getBuiltinConstructionConfig(
                  flags.builtin,
              )
            : undefined;

        let files;
        if (flags.builtin) {
            files = builtinConstructionConfig?.data;
            if (files === undefined) {
                throw new Error(
                    `No builtin explanation data found for translator '${flags.builtin}'`,
                );
            }
        } else {
            files =
                argv.length > 0
                    ? (argv as string[])
                    : await getDefaultConstructionProvider().getImportTranslationFiles();
        }
        const inputs = await Promise.all(
            files.map(async (file) => {
                return { file, data: await readExplanationTestData(file) };
            }),
        );

        const explainerFilter = flags.explainer;
        let pending = explainerFilter
            ? inputs.filter((e) =>
                  explainerFilter.includes(e.data.explainerName),
              )
            : inputs;

        if (pending.length === 0) {
            throw new Error(`No input files found`);
        }

        const explainerOverride = flags.builtin ?? flags.override;
        const partialExplanationRegen =
            flags.correction ||
            flags.error ||
            flags.validate ||
            flags.succeeded ||
            flags.failed ||
            flags.resume ||
            flags.constructions ||
            flags.none;

        const partialRegen =
            partialExplanationRegen ||
            flags.explanation ||
            flags.request ||
            flags.actionName ||
            flags.entities;

        if (flags.output) {
            // Combine the data to the output now
            const failed: FailedExplanationTestDataEntry[] = [];

            const targetSchemaName = pending[0].data.schemaName;
            const config = provider.getActionConfig(targetSchemaName);
            const sourceHash =
                provider.getActionSchemaFileForConfig(config).sourceHash;

            const combinedData = getEmptyExplanationTestData(
                targetSchemaName,
                sourceHash,
                explainerOverride ?? pending[0].data.explainerName,
            );
            combinedData.failed = failed;

            for (const { data } of pending) {
                if (combinedData.schemaName !== data.schemaName) {
                    throw new Error(
                        "Unable to process multiple translator from input files into a single output file",
                    );
                }
                if (data.explainerName !== combinedData.explainerName) {
                    if (explainerOverride !== undefined) {
                        if (partialExplanationRegen) {
                            throw new Error(
                                "Cannot to partially regenerate using --correction, --error, --validate, --succeeded, --failed, --resume, --constructions or --none with explainer override.",
                            );
                        }
                    } else {
                        throw new Error(
                            "Cannot mix multiple input explainer into a single output file without explainer override.",
                        );
                    }
                    // Everything becomes failed to be regenerated.
                    failed.push(
                        ...data.entries.map((e) => {
                            return {
                                ...e,
                                message: "Not processed",
                                explanation: undefined,
                                corrections: undefined,
                            };
                        }),
                    );
                } else {
                    combinedData.entries.push(...data.entries);
                }
                if (data.failed) {
                    failed.push(...data.failed);
                }
            }
            pending = [{ file: flags.output, data: combinedData }];
            if (fs.existsSync(flags.output)) {
                console.log(
                    chalk.yellow(`${flags.output} will be overwritten`),
                );
            }
        } else {
            for (const { file, data } of pending) {
                const config = provider.getActionConfig(data.schemaName);
                const sourceHash =
                    provider.getActionSchemaFileForConfig(config).sourceHash;

                if (sourceHash !== data.sourceHash) {
                    if (partialRegen && !flags.updateHash) {
                        throw new Error(
                            `Existing schema source hash in ${file} doesn't match current source hash for schema '${data.schemaName}'`,
                        );
                    }
                    if (flags.updateHash) {
                        console.log(`Updating source hash in '${file}'`);
                    }
                    data.sourceHash = sourceHash;
                }
                if (explainerOverride !== undefined)
                    if (data.explainerName !== explainerOverride) {
                        if (partialExplanationRegen) {
                            throw new Error(
                                "Cannot to partially regenerate using --correction, --error, --validate, --succeeded, --failed, --resume, --constructions or --none with explainer override",
                            );
                        }
                        data.failed = data.failed ?? [];
                        data.failed.push(
                            ...data.entries.map((e) => {
                                return {
                                    ...e,
                                    message: "Not processed",
                                    explanation: undefined,
                                    corrections: undefined,
                                };
                            }),
                        );
                        data.entries = [];
                        data.explainerName = explainerOverride;
                    }
            }
        }

        const concurrency = getChatModelMaxConcurrency(
            flags.concurrency,
            flags.model,
            4,
        );
        console.log(
            chalk.cyanBright(
                `Processing ${pending.length} files. (Concurrency: ${concurrency})`,
            ),
        );

        const limiter = createLimiter(concurrency);

        const errorRegex = flags.error?.map(
            (e) => new RegExp(e.replaceAll("*", ".*")),
        );

        const correctionRegex = flags.correction?.map(
            (e) => new RegExp(e.replaceAll("*", ".*")),
        );

        const actionNameRegex = flags.actionName?.map(
            (e) => new RegExp(e.replaceAll("*", ".*")),
        );

        const requestRegex = flags.request?.map(
            (e) => new RegExp(e.replaceAll("*", ".*")),
        );
        const dataInput: GenerateDataInput[] = [];
        for (const { file, data } of pending) {
            const inputs: (string | RequestAction)[] = [];
            if (!flags.none && !flags.constructions) {
                const filter = (
                    e:
                        | ExplanationTestDataEntry
                        | FailedExplanationTestDataEntry,
                ) => {
                    if (flags.resume) {
                        if ((e as any).message !== "Not processed") {
                            return undefined;
                        }
                    }

                    if (requestRegex) {
                        const request = e.request;
                        if (!requestRegex.some((f) => f.test(request))) {
                            return undefined;
                        }
                    }

                    if (actionNameRegex) {
                        const action = e.action;
                        if (action === undefined) {
                            return undefined;
                        }
                        if (Array.isArray(action)) {
                            if (
                                !action.some((a) =>
                                    actionNameRegex.some((f) =>
                                        f.test(a.fullActionName),
                                    ),
                                )
                            ) {
                                return undefined;
                            }
                        } else {
                            if (
                                !actionNameRegex.some((f) =>
                                    f.test(action.fullActionName),
                                )
                            ) {
                                return undefined;
                            }
                        }
                    }

                    if (errorRegex) {
                        const message = (e as any).message;
                        if (!errorRegex.some((r) => r.test(message))) {
                            return undefined;
                        }
                    }

                    // explanation filters
                    if (correctionRegex) {
                        if (e.corrections === undefined) {
                            return undefined;
                        }

                        const hasCorrection = (c: string | string[]) => {
                            if (Array.isArray(c)) return c.some(hasCorrection);

                            return correctionRegex.some((r) => r.test(c));
                        };

                        if (
                            !e.corrections.some((c) =>
                                hasCorrection(c.correction),
                            )
                        ) {
                            // Do not have matching correction
                            return undefined;
                        }
                    }

                    let history: HistoryContext | undefined;
                    if (flags.entities) {
                        if (e.action === undefined) {
                            return undefined;
                        }
                        const entities = toEntities(fromJsonActions(e.action));
                        if (entities.length === 0) {
                            return undefined;
                        }
                        history = { promptSections: [], entities };
                    }

                    const requestAction = e.action
                        ? new RequestAction(
                              e.request,
                              fromJsonActions(e.action),
                              history,
                          )
                        : undefined;

                    if (flags.validate) {
                        if (requestAction === undefined) {
                            return undefined;
                        }

                        const explainer = getCacheFactory().getExplainer(
                            [data.schemaName],
                            data.explainerName,
                        );

                        try {
                            if (
                                e.explanation !== undefined &&
                                explainer.validate?.(
                                    requestAction,
                                    e.explanation,
                                ) === undefined
                            ) {
                                // Validate correctly
                                return undefined;
                            }
                        } catch (e) {
                            // regenerate if there are other exceptions
                        }
                    }

                    return flags.explanation ? requestAction : e.request;
                };

                if (flags.succeeded || !flags.failed) {
                    for (const e of data.entries) {
                        const input = filter(e);
                        if (input !== undefined) {
                            inputs.push(input);
                        }
                    }
                }

                if ((flags.failed || !flags.succeeded) && data.failed) {
                    for (const e of data.failed) {
                        const input = filter(e);
                        if (input !== undefined) {
                            inputs.push(input);
                        }
                    }
                }
            }

            dataInput.push({
                inputs,
                existingData: data,
                outputFile: flags.output ?? file,
            });
        }
        const results = await generateExplanationTestDataFiles(
            dataInput,
            provider,
            !flags.batch,
            limiter,
            flags.model,
        );

        if (builtinConstructionConfig !== undefined) {
            const agentCache = getCacheFactory().create(
                flags.builtin!,
                schemaInfoProvider,
            );
            await agentCache.constructionStore.newCache(
                flags.none ? undefined : builtinConstructionConfig.file,
            );
            const result = await agentCache.import(
                results.map((e) =>
                    convertTestDataToExplanationData(e.testData),
                ),
            );

            printImportConstructionResult(result);
            if (flags.none) {
                console.log(
                    chalk.yellow(
                        "Constructions not written to disk because of --none flag.",
                    ),
                );
            } else {
                await agentCache.constructionStore.save();
                console.log(
                    chalk.green(
                        `Constructions regenerated in ${builtinConstructionConfig.file}`,
                    ),
                );
            }
        }

        console.log("=".repeat(80));
        const elapsedMs = performance.now() - startTime;
        printExplanationTestDataStats(results, "Total ");
        console.log(`Total Elapsed Time: ${getElapsedString(elapsedMs)}`);
    }
}
