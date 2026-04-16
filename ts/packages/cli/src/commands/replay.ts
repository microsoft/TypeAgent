// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    ensureAgentServer,
} from "@typeagent/agent-server-client";
import {
    ChatHistoryInput,
    isChatHistoryInput,
} from "agent-dispatcher/internal";
import { withConsoleClientIO } from "agent-dispatcher/helpers/console";
import * as crypto from "crypto";
import fs from "node:fs";
import type {
    TranslateTestFile,
    TranslateTestStep,
} from "default-agent-provider/test";

async function readHistoryFile(filePath: string): Promise<ChatHistoryInput> {
    if (!fs.existsSync(filePath)) {
        throw new Error(`History file not found: ${filePath}`);
    }

    const history = await fs.promises.readFile(filePath, "utf8");
    let data: unknown;
    try {
        data = JSON.parse(history);
    } catch (e) {
        throw new Error(
            `Failed to parse history file: ${filePath}. Error: ${e}`,
        );
    }
    if (isChatHistoryInput(data)) {
        return data;
    }
    throw new Error(`Invalid history file format: ${filePath}.`);
}

export default class ReplayCommand extends Command {
    static args = {
        history: Args.string({
            description: "History file to replay.",
            required: true,
        }),
    };

    static flags = {
        translate: Flags.boolean({
            description: "Translate only, do not execute actions",
            default: false,
        }),
        generateTest: Flags.string({
            description: "Record action to generate test file",
        }),
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
    };

    static description = "Replay a chat history file";
    static example = [`$ <%= config.bin %> <%= command.id %> history.json`];

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ReplayCommand);

        const history = await readHistoryFile(args.history);
        const url = `ws://localhost:${flags.port}`;

        await ensureAgentServer(flags.port, !flags.show, 600);
        const connection = await connectAgentServer(url);

        // Create an ephemeral session for replay isolation
        const ephemeralName = `cli-replay-${crypto.randomUUID()}`;
        const created = await connection.createSession(ephemeralName);

        try {
            await withConsoleClientIO(async (clientIO) => {
                const session = await connection.joinSession(clientIO, {
                    sessionId: created.sessionId,
                });

                const entries = Array.isArray(history) ? history : [history];
                const steps: TranslateTestStep[] = [];
                for (const entry of entries) {
                    const result = await session.dispatcher.processCommand(
                        entry.user,
                    );
                    steps.push({
                        request: entry.user,
                        expected: result?.actions,
                        history: entry.assistant,
                    });

                    if (flags.translate) {
                        await session.dispatcher.processCommand(
                            `@history insert ${JSON.stringify(entry)}`,
                        );
                    }
                }
                if (flags.generateTest !== undefined) {
                    const fileName = flags.generateTest;
                    const data: TranslateTestFile = [steps];

                    await fs.promises.writeFile(
                        fileName,
                        JSON.stringify(data, undefined, 2),
                    );
                    console.log(
                        `Generated test file '${fileName}' with a test with ${steps.length} steps`,
                    );
                }
            });
        } finally {
            // Delete the ephemeral session on exit for isolation
            try {
                await connection.deleteSession(created.sessionId);
            } catch {
                // Best effort cleanup
            }
            await connection.close();
        }

        process.exit(0);
    }
}
