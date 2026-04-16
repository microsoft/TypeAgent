// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    ensureAgentServer,
    AgentServerConnection,
} from "@typeagent/agent-server-client";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import { readFileSync, existsSync } from "fs";

const CLI_SESSION_NAME = "CLI";

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
        port: Flags.integer({
            char: "p",
            description: "Port for type agent server",
            default: 8999,
        }),
        show: Flags.boolean({
            description:
                "Start the agent server in a visible window if it is not already running. Default is to start it hidden.",
            default: false,
        }),
        session: Flags.string({
            char: "s",
            description:
                "Session ID to use. Defaults to the 'CLI' session if not specified.",
            required: false,
        }),
    };

    static description = "Translate a request into action and explain it";
    static example = [
        `$ <%= config.bin %> <%= command.id %> 'play me some bach'`,
    ];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(RequestCommand);
        const url = `ws://localhost:${flags.port}`;

        await ensureAgentServer(flags.port, !flags.show, 600);
        let connection: AgentServerConnection | undefined;
        try {
            connection = await connectAgentServer(url);

            // Use --session directly if provided, otherwise find-or-create the "CLI" session
            let sessionId: string;
            if (flags.session !== undefined) {
                sessionId = flags.session;
            } else {
                const existing =
                    await connection.listSessions(CLI_SESSION_NAME);
                const match = existing.find(
                    (s) =>
                        s.name.toLowerCase() === CLI_SESSION_NAME.toLowerCase(),
                );
                sessionId =
                    match !== undefined
                        ? match.sessionId
                        : (await connection.createSession(CLI_SESSION_NAME))
                              .sessionId;
            }

            await withConsoleClientIO(async (clientIO) => {
                const session = await connection!.joinSession(clientIO, {
                    sessionId,
                });
                await session.dispatcher.processCommand(
                    `@dispatcher request ${args.request}`,
                    undefined,
                    this.loadAttachment(args.attachment),
                );
            });
        } finally {
            await connection?.close();
        }

        // Some background network (like mongo) might keep the process live, exit explicitly.
        process.exit(0);
    }

    loadAttachment(fileName: string | undefined): string[] | undefined {
        if (fileName === undefined) {
            return undefined;
        }

        if (!existsSync(fileName)) {
            throw Error(`The file '${fileName}' does not exist.`);
        }

        let retVal: string[] = new Array<string>();
        retVal.push(Buffer.from(readFileSync(fileName)).toString("base64"));

        return retVal;
    }
}
