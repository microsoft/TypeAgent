// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { RequestAction, Actions } from "agent-cache";
import {
    getCacheFactory,
    getDefaultAppAgentProviders,
    getSchemaNamesFromDefaultAppAgentProviders,
} from "agent-dispatcher/internal";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import { ClientIO, createDispatcher } from "agent-dispatcher";

// Default test case, that include multiple phrase action name (out of order) and implicit parameters (context)
const testRequest = new RequestAction(
    "do some player blah",
    Actions.fromJSON({
        fullActionName: "player.do",
        parameters: {
            value: "blah",
            context: "now",
        },
    }),
);
export default class ExplainCommand extends Command {
    static args = {
        request: Args.string({
            description: "Request and action to get an explanation for",
        }),
    };

    static flags = {
        translator: Flags.string({
            description: "Translator names",
            options: getSchemaNamesFromDefaultAppAgentProviders(),
            multiple: true,
        }),
        explainer: Flags.string({
            description:
                "Explainer name (defaults to the explainer associated with the translator)",
            options: getCacheFactory().getExplainerNames(),
        }),
        repeat: Flags.integer({
            description: "Number of times to repeat the explanation",
            default: 1,
        }),
        concurrency: Flags.integer({
            description: "Number of concurrent requests",
            default: 5,
        }),
        filter: Flags.string({
            description: "Filter for the explanation",
            options: ["refvalue", "reflist"],
            multiple: true,
            required: false,
        }),
    };

    static description = "Explain a request and action";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach => play({"ItemType":"song","Artist":"bach"})'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ExplainCommand);
        const schemas = flags.translator
            ? Object.fromEntries(flags.translator.map((name) => [name, true]))
            : undefined;

        const command = ["@dispatcher explain"];
        if (flags.filter?.includes("refValue")) {
            command.push("--filterValueInRequest");
        }
        if (flags.filter?.includes("refList")) {
            command.push("--filterReference");
        }
        if (flags.repeat > 1) {
            command.push(`--repeat ${flags.repeat}`);
            command.push(`--concurrency ${flags.concurrency}`);
        }

        if (args.request) {
            command.push(args.request);
        } else {
            console.log(chalk.yellow("Request not specified, using default."));
            command.push(testRequest.toString());
        }

        await withConsoleClientIO(async (clientIO: ClientIO) => {
            const dispatcher = await createDispatcher("cli run explain", {
                appAgentProviders: getDefaultAppAgentProviders(),
                schemas,
                actions: null, // We don't need any actions
                commands: { dispatcher: true },
                explainer: {
                    name: flags.explainer,
                },
                cache: { enabled: false },
                clientIO,
                persist: true,
                dblogging: true,
            });
            try {
                await dispatcher.processCommand(command.join(" "));
            } finally {
                await dispatcher.close();
            }
        });
    }
}
