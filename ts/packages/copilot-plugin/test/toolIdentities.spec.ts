// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { isTypeAgentAgentServerTool } from "../src/shared/tool-identities.js";

describe("TypeAgent MCP tool identity", () => {
    it("distinguishes agent-server tools from workspace tools", () => {
        expect(
            isTypeAgentAgentServerTool(
                "typeagent-processCommand",
                "typeagent",
            ),
        ).toBe(true);
        expect(
            isTypeAgentAgentServerTool(
                "read",
                "typeagent-workspace",
            ),
        ).toBe(false);
        expect(isTypeAgentAgentServerTool("typeagent-workspace-read")).toBe(
            false,
        );
    });
});
