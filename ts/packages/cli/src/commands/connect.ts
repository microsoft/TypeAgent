// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { Dispatcher } from "agent-dispatcher";
import {
    getConsolePrompt,
    processCommands,
    withConsoleClientIO,
} from "agent-dispatcher/helpers/console";
import { connectDispatcher } from "agent-server-client";
import { getStatusSummary } from "agent-dispatcher/helpers/status";

export default class Interactive extends Command {
    static description = "Interactive mode";
    static flags = {
        exit: Flags.boolean({
            description: "Exit after processing input file",
            default: true,
            allowNo: true,
        }),
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
    };
    static args = {
        input: Args.file({
            description:
                "A text input file containing one interactive command per line",
            exists: true,
        }),
    };
    async run(): Promise<void> {
        const { args, flags } = await this.parse(Interactive);

        await withConsoleClientIO(async (clientIO) => {
            const dispatcher = await connectDispatcher(
                clientIO,
                `ws://localhost:${flags.port}`,
            );

            try {
                if (args.input) {
                    await dispatcher.processCommand(`@run ${args.input}`);
                    if (flags.exit) {
                        return;
                    }
                }

                await processCommands(
                    async (dispatcher: Dispatcher) =>
                        getConsolePrompt(
                            getStatusSummary(await dispatcher.getStatus(), {
                                showPrimaryName: false,
                            }),
                        ),
                    (command: string, dispatcher: Dispatcher) =>
                        dispatcher.processCommand(command),
                    dispatcher,
                );
            } finally {
                if (dispatcher) {
                    await dispatcher.close();
                }
            }
        });

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }
}
