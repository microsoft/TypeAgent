// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import { stopAgentServer } from "@typeagent/agent-server-client";

export default class ServerStop extends Command {
    static description = "Stop the running TypeAgent server";
    static flags = {
        port: Flags.integer({
            char: "p",
            description: "Port the agent server is listening on",
            default: 8999,
        }),
        force: Flags.boolean({
            char: "f",
            description:
                "Force stop the server by killing the process if graceful shutdown fails",
            default: false,
        }),
    };
    async run(): Promise<void> {
        const { flags } = await this.parse(ServerStop);
        await stopAgentServer(flags.port, flags.force);
        process.exit(0);
    }
}
