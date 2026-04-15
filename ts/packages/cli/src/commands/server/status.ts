// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import { isServerRunning } from "@typeagent/agent-server-client";

export default class ServerStatus extends Command {
    static description = "Show whether the TypeAgent server is running";
    static flags = {
        port: Flags.integer({
            char: "p",
            description: "Port to check",
            default: 8999,
        }),
    };
    async run(): Promise<void> {
        const { flags } = await this.parse(ServerStatus);
        const running = await isServerRunning(`ws://localhost:${flags.port}`);
        if (running) {
            this.log(`TypeAgent server is running on port ${flags.port}.`);
        } else {
            this.log(`TypeAgent server is not running on port ${flags.port}.`);
            this.exit(1);
        }
    }
}
