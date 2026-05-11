// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import { stopAgentServer } from "@typeagent/agent-server-client";

export default class ServerStop extends Command {
    static description = "Stop the running TypeAgent server";
    static flags = {
        port: Flags.integer({
            char: "p",
            description:
                "Port the agent server is listening on (overrides AGENT_SERVER_PORT)",
            required: false,
        }),
    };
    async run(): Promise<void> {
        const { flags } = await this.parse(ServerStop);
        // stopAgentServer reads AGENT_SERVER_PORT (default 8999); the
        // --port flag overrides it for this process.
        if (flags.port !== undefined) {
            process.env.AGENT_SERVER_PORT = String(flags.port);
        }
        await stopAgentServer();
        process.exit(0);
    }
}
