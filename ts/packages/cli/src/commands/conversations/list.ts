// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";
import type { ConversationInfo } from "@typeagent/agent-server-client";

function formatTable(conversations: ConversationInfo[]): string {
    if (conversations.length === 0) {
        return "No conversations found.";
    }

    const idWidth = Math.max(
        "CONVERSATION ID".length,
        ...conversations.map((s) => s.conversationId.length),
    );
    const nameWidth = Math.max(
        "NAME".length,
        ...conversations.map((s) => (s.name ?? "").length),
    );
    const clientsWidth = Math.max(
        "CLIENTS".length,
        ...conversations.map((s) => String(s.clientCount).length),
    );
    const createdWidth = Math.max(
        "CREATED AT".length,
        ...conversations.map((s) => s.createdAt.length),
    );

    const header = [
        "CONVERSATION ID".padEnd(idWidth),
        "NAME".padEnd(nameWidth),
        "CLIENTS".padEnd(clientsWidth),
        "CREATED AT",
    ].join("  ");

    const separator = [
        "-".repeat(idWidth),
        "-".repeat(nameWidth),
        "-".repeat(clientsWidth),
        "-".repeat(createdWidth),
    ].join("  ");

    const rows = conversations.map((s) =>
        [
            s.conversationId.padEnd(idWidth),
            (s.name ?? "").padEnd(nameWidth),
            String(s.clientCount).padEnd(clientsWidth),
            s.createdAt,
        ].join("  "),
    );

    return [header, separator, ...rows].join("\n");
}

export default class ConversationsList extends Command {
    static description =
        "List conversations on the agent server. Usage: conversations list [--name <filter>]";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
        name: Flags.string({
            description:
                "Filter conversations by name substring (case-insensitive)",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsList);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            const conversations = await connection.listConversations(
                flags.name,
            );
            this.log(formatTable(conversations));
        } finally {
            await connection.close();
        }
    }
}
