// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import {
    getAgentServerPort,
    isServerRunning,
} from "@typeagent/agent-server-client";

export default class ServerStatus extends Command {
    static description = "Show whether the TypeAgent server is running";
    static flags = {
        port: Flags.integer({
            char: "p",
            description:
                "Override the agent-server port. Defaults to AGENT_SERVER_PORT, then 8999.",
        }),
    };
    async run(): Promise<void> {
        const { flags } = await this.parse(ServerStatus);
        const port = getAgentServerPort(flags.port);
        const running = await isServerRunning(`ws://localhost:${port}`);
        if (running) {
            this.log(`TypeAgent server is running on port ${port}.`);
        } else {
            this.log(`TypeAgent server is not running on port ${port}.`);
            this.exit(1);
        }
    }
}
