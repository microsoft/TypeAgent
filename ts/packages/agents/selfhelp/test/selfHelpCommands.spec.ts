// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { instantiate } from "../src/selfHelpActionHandler.js";

describe("selfhelp command action links", () => {
    it("links ask and its bare default to answerTypeAgentQuestion", async () => {
        const table = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptorTable
            | CommandDescriptor;
        expect(
            "commands" in table &&
                (table.commands.ask as CommandDescriptor).action,
        ).toBe("answerTypeAgentQuestion");
        expect(
            "commands" in table &&
                typeof table.defaultSubCommand !== "string" &&
                table.defaultSubCommand?.action,
        ).toBe("answerTypeAgentQuestion");
    });
});
