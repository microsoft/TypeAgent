// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import { connectAgentServer } from "@typeagent/agent-server-client";
import type { SessionInfo } from "@typeagent/agent-server-client";

function formatTable(sessions: SessionInfo[]): string {
    if (sessions.length === 0) {
        return "No sessions found.";
    }

    const idWidth = Math.max(
        "SESSION ID".length,
        ...sessions.map((s) => s.sessionId.length),
    );
    const nameWidth = Math.max(
        "NAME".length,
        ...sessions.map((s) => (s.name ?? "").length),
    );
    const clientsWidth = Math.max(
        "CLIENTS".length,
        ...sessions.map((s) => String(s.clientCount).length),
    );
    const createdWidth = Math.max(
        "CREATED AT".length,
        ...sessions.map((s) => s.createdAt.length),
    );

    const header = [
        "SESSION ID".padEnd(idWidth),
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

    const rows = sessions.map((s) =>
        [
            s.sessionId.padEnd(idWidth),
            (s.name ?? "").padEnd(nameWidth),
            String(s.clientCount).padEnd(clientsWidth),
            s.createdAt,
        ].join("  "),
    );

    return [header, separator, ...rows].join("\n");
}

export default class SessionsList extends Command {
    static description =
        "List sessions on the agent server. Usage: sessions list [--name <filter>]";
    static flags = {
        port: Flags.integer({
            description: "Port for type agent server",
            default: 8999,
        }),
        name: Flags.string({
            description: "Filter sessions by name substring (case-insensitive)",
            required: false,
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(SessionsList);
        const url = `ws://localhost:${flags.port}`;
        const connection = await connectAgentServer(url);
        try {
            const sessions = await connection.listSessions(flags.name);
            this.log(formatTable(sessions));
        } finally {
            await connection.close();
        }
    }
}
