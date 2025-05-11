// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Flags, Command } from "@oclif/core";
import fs from "node:fs";
import {
    readLineData,
    readExplanationTestData,
    ExplanationTestData,
    generateExplanationTestDataFiles,
    printExplanationTestDataStats,
    getEmptyExplanationTestData,
    getCacheFactory,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import chalk from "chalk";
import { getDefaultExplainerName } from "agent-cache";
import { getChatModelMaxConcurrency, getChatModelNames } from "aiclient";
import { getDefaultAppAgentProviders } from "default-agent-provider";

const cacheFactory = getCacheFactory();
const modelNames = await getChatModelNames();
const { provider, schemaNames } = await getAllActionConfigProvider(
    getDefaultAppAgentProviders(getInstanceDir()),
);

export default class ExplanationDataAddCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Add a translation request to the explanation data file",
        }),
    };
    static flags = {
        input: Flags.file({
            char: "i",
            exists: true,
            multiple: true,
            description: "A text input file containing one request per line",
        }),
        output: Flags.file({
            char: "o",
            exists: false,
            description: "Output file",
        }),
        batch: Flags.boolean({
            description:
                "Batch processing, only save to file once the file is done",
            default: false,
        }),
        schema: Flags.string({
            description: "Translator name",
            options: schemaNames,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: cacheFactory.getExplainerNames(),
        }),
        overwrite: Flags.boolean({
            default: false,
            description: "Overwrite output file instead of adding to it",
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
        updateHash: Flags.boolean({
            description: "Update the source hash (ignore source mismatch)",
            default: false,
        }),
    };

    static description =
        "Add a request to the explanation data file.  If the output is not specified, output to the console";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ExplanationDataAddCommand);

        const inputs = flags.input
            ? (
                  await Promise.all(
                      flags.input.map((input) => readLineData(input)),
                  )
              ).flat()
            : [];

        if (args.request) {
            if (fs.existsSync(args.request)) {
                throw new Error("Request is a file name");
            }
            inputs.push(args.request);
        }
        if (inputs.length !== 0) {
            let existingData: ExplanationTestData;
            if (
                !flags.overwrite &&
                flags.output &&
                fs.existsSync(flags.output)
            ) {
                existingData = await readExplanationTestData(flags.output);
                if (
                    flags.schema !== undefined &&
                    flags.schema !== existingData.schemaName
                ) {
                    throw new Error(
                        `Existing data is for schema '${existingData.schemaName}' but input is for schema '${flags.schema}'`,
                    );
                }

                const config = provider.getActionConfig(
                    existingData.schemaName,
                );
                const sourceHash =
                    provider.getActionSchemaFileForConfig(config).sourceHash;
                if (sourceHash !== existingData.sourceHash) {
                    if (!flags.updateHash) {
                        throw new Error(
                            `Existing schema source hash in ${flags.output} doesn't match current source hash for schema '${existingData.schemaName}'`,
                        );
                    }
                    console.log(`Updating source hash in '${flags.output}'`);
                    existingData.sourceHash = sourceHash;
                }

                if (
                    flags.explainer !== undefined &&
                    flags.explainer !== existingData.explainerName
                ) {
                    throw new Error(
                        `Existing data is for translator '${existingData.explainerName}' but input is for translator '${flags.explainer}'`,
                    );
                }

                if (existingData.entries.length !== 0) {
                    console.log(
                        `${existingData.entries.length} existing entries loaded`,
                    );
                }
            } else if (flags.schema) {
                const config = provider.getActionConfig(flags.schemaName);
                const sourceHash =
                    provider.getActionSchemaFileForConfig(config).sourceHash;
                // Create an empty existing data.
                existingData = getEmptyExplanationTestData(
                    flags.schemaName,
                    sourceHash,
                    flags.explainer ?? getDefaultExplainerName(),
                );
            } else {
                throw new Error(
                    `Schema name is not specified.  Please specify a schema name with --schema`,
                );
            }

            const concurrency = getChatModelMaxConcurrency(
                flags.concurrency,
                flags.model,
                4,
            );
            console.log(
                `Processing ${inputs.length} inputs... Concurrency ${concurrency}`,
            );
            const startTime = performance.now();
            const testData = await generateExplanationTestDataFiles(
                [
                    {
                        inputs,
                        existingData,
                        outputFile: flags.output,
                    },
                ],
                provider,
                flags.batch,
                concurrency,
                flags.model,
                false,
            );
            const elapsedTime = (performance.now() - startTime) / 1000;
            printExplanationTestDataStats(testData);
            console.log(`Total Elapsed Time: ${elapsedTime.toFixed(3)}s`);

            if (!flags.output) {
                console.log(`Result:`);
                console.log(JSON.stringify(testData, undefined, 2));
            }
        } else {
            console.log(chalk.yellow("No request specified. Nothing added."));
            if (flags.output && fs.existsSync(flags.output)) {
                printExplanationTestDataStats([
                    {
                        fileName: flags.output,
                        testData: await readExplanationTestData(flags.output),
                        elapsedMs: 0,
                    },
                ]);
            }
        }
    }
}
