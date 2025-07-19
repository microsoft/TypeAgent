// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { createDispatcher } from "agent-dispatcher";
import {
    getCacheFactory,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getClientId, getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import chalk from "chalk";
import { getChatModelNames } from "aiclient";
import { readFileSync, existsSync } from "fs";

const modelNames = await getChatModelNames();
const instanceDir = getInstanceDir();
const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
const { schemaNames } = await getAllActionConfigProvider(
    defaultAppAgentProviders,
);
export default class RequestCommand extends Command {
    static args = {
        request: Args.string({
            description:
                "Request to translate and get an explanation of the translation",
            required: true,
        }),
        attachment: Args.string({
            description: "A path to a file to attach with the request",
            required: false,
        }),
    };

    static flags = {
        schema: Flags.string({
            description: "Schema name",
            options: schemaNames,
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
            required: false,
        }),
        model: Flags.string({
            description: "Translation model to use",
            options: modelNames,
        }),
    };

    static description = "Translate a request into action and explain it";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(RequestCommand);
        const dispatcher = await createDispatcher("cli run request", {
            appAgentProviders: defaultAppAgentProviders,
            agents: {
                schemas: flags.schema,
                actions: flags.schema,
                commands: ["dispatcher"],
            },
            translation: { model: flags.model },
            explainer: flags.explainer
                ? { enabled: true, name: flags.explainer }
                : { enabled: false },
            indexingServiceRegistry:
                await getIndexingServiceRegistry(instanceDir),
            cache: { enabled: false },
            persistDir: instanceDir,
            dblogging: true,
            clientId: getClientId(),
        });
        await dispatcher.processCommand(
            `@dispatcher request ${args.request}`,
            undefined,
            this.loadAttachment(args.attachment),
        );
        await dispatcher.close();

        // Some background network (like monogo) might keep the process live, exit explicitly.
        process.exit(0);
    }

    loadAttachment(fileName: string | undefined): string[] | undefined {
        if (fileName === undefined) {
            return undefined;
        }

        if (!existsSync(fileName)) {
            console.error(
                chalk.red(`ERROR: The file '${fileName}' does not exist.`),
            );

            throw Error(`ERROR: The file '${fileName}' does not exist.`);
        }

        let retVal: string[] = new Array<string>();
        retVal.push(Buffer.from(readFileSync(fileName)).toString("base64"));

        return retVal;
    }
}
