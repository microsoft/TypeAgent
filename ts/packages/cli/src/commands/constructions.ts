// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    readExplanationTestData,
    getCacheFactory,
    convertTestDataToExplanationData,
    getAllActionConfigProvider,
    createSchemaInfoProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import { printImportConstructionResult } from "agent-cache";
import fs from "node:fs";
import chalk from "chalk";
import { getDefaultAppAgentProviders } from "default-agent-provider";

const schemaInfoProvider = createSchemaInfoProvider(
    (
        await getAllActionConfigProvider(
            getDefaultAppAgentProviders(getInstanceDir()),
        )
    ).provider,
);

export default class ConstructionsCommand extends Command {
    static description = "Constructions";

    static args = {
        input: Args.file({
            exists: true,
            description: "A text input file containing one request per line",
            required: true,
        }),
        output: Args.file({ exists: false, description: "Output file" }),
    };

    static flags = {
        overwrite: Flags.boolean({
            description: "Overwrite output file instead of adding to it",
            default: false,
        }),
    };
    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConstructionsCommand);

        const testDataFile = await readExplanationTestData(args.input);

        const agentCache = getCacheFactory().create(
            testDataFile.explainerName,
            schemaInfoProvider,
        );
        if (!flags.overwrite && args.output && fs.existsSync(args.output)) {
            await agentCache.constructionStore.load(args.output);
        } else {
            await agentCache.constructionStore.newCache(args.output);
        }

        const result = await agentCache.import([
            convertTestDataToExplanationData(testDataFile),
        ]);

        printImportConstructionResult(result);

        if (args.output) {
            agentCache.constructionStore.save();
            console.log(
                chalk.greenBright(
                    `Constructions written to file '${args.output}'`,
                ),
            );
        }
    }
}
