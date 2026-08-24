// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import {
    connectAgentServer,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";
import type { ConversationMatch } from "@typeagent/agent-server-client";

function formatTable(matches: ConversationMatch[]): string {
    if (matches.length === 0) {
        return "No matching conversations found.";
    }

    const rows = matches.map((m) => ({
        score: m.score.toFixed(2),
        id: m.conversation.conversationId,
        name: m.conversation.name ?? "",
    }));

    const scoreWidth = Math.max(
        "SCORE".length,
        ...rows.map((r) => r.score.length),
    );
    const idWidth = Math.max(
        "CONVERSATION ID".length,
        ...rows.map((r) => r.id.length),
    );
    const nameWidth = Math.max(
        "NAME".length,
        ...rows.map((r) => r.name.length),
    );

    const header = [
        "SCORE".padEnd(scoreWidth),
        "CONVERSATION ID".padEnd(idWidth),
        "NAME",
    ].join("  ");
    const separator = [
        "-".repeat(scoreWidth),
        "-".repeat(idWidth),
        "-".repeat(nameWidth),
    ].join("  ");
    const body = rows.map((r) =>
        [r.score.padEnd(scoreWidth), r.id.padEnd(idWidth), r.name].join("  "),
    );
    return [header, separator, ...body].join("\n");
}

export default class ConversationsFind extends Command {
    static description =
        "Fuzzy-find conversations by name (lexical + embedding). Usage: conversations find <query> [--max N]";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: AGENT_SERVER_DEFAULT_PORT,
        }),
        max: Flags.integer({
            description: "Maximum number of matches to return",
            default: 10,
        }),
    };
    static args = {
        query: Args.string({
            description: "Name (or approximate name) to search for",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsFind);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            const matches = await connection.findConversations(
                args.query,
                flags.max,
            );
            this.log(formatTable(matches));
        } finally {
            await connection.close();
        }
    }
}
