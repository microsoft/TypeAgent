// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { instantiate } from "../src/osNotificationsActionHandler.js";

describe("osNotifications command action links", () => {
    it("links both commands to their shared action implementations", async () => {
        const table = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptorTable
            | CommandDescriptor;
        expect(
            "commands" in table &&
                (table.commands.sync as CommandDescriptor).action,
        ).toBe("syncOsNotifications");
        expect(
            "commands" in table &&
                (table.commands.test as CommandDescriptor).action,
        ).toBe("testOsNotification");
    });
});
