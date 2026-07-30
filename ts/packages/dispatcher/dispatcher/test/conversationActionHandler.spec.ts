// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for executeConversationAction. Each conversation action delegates to
 * the equivalent `@conversation` command via processCommandNoLock (matching the
 * history agent), so these assert the command string it runs and the entity it
 * returns.
 */

import { describe, it, expect, jest } from "@jest/globals";

// Capture the delegated command string by stubbing the command processor.
const mockProcessCommandNoLock = jest.fn();
jest.unstable_mockModule("../src/command/command.js", () => ({
    processCommandNoLock: mockProcessCommandNoLock,
}));

const { executeConversationAction } = await import(
    "../src/context/system/action/conversationActionHandler.js"
);

const agentContext = { id: "agent-context" } as any;
function makeContext() {
    mockProcessCommandNoLock.mockClear();
    return { sessionContext: { agentContext } } as any;
}

async function run(action: any) {
    return executeConversationAction(
        { schemaName: "system.conversation", ...action },
        makeContext(),
    );
}

function expectCommand(command: string) {
    expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
        command,
        agentContext,
    );
}

describe("executeConversationAction delegates to @conversation commands", () => {
    it("newConversation with a name runs a quoted new command", async () => {
        const r = await run({
            actionName: "newConversation",
            parameters: { name: "research" },
        });
        expectCommand('@conversation new "research"');
        expect(r.resultEntity).toEqual({
            name: "research",
            type: ["conversation"],
        });
    });

    it("newConversation without a name runs a bare new command", async () => {
        const r = await run({ actionName: "newConversation", parameters: {} });
        expectCommand("@conversation new");
        expect(r.resultEntity).toEqual({
            name: "new conversation",
            type: ["conversation"],
        });
    });

    it("quotes conversation names that contain spaces", async () => {
        await run({
            actionName: "newConversation",
            parameters: { name: "my work project" },
        });
        expectCommand('@conversation new "my work project"');
    });

    it("uses single-quoted tokens when names contain double quotes", async () => {
        await run({
            actionName: "newConversation",
            parameters: { name: 'fix "bug"' },
        });
        expectCommand(`@conversation new 'fix "bug"'`);
    });

    it("escapes when names contain both quote types", async () => {
        await run({
            actionName: "newConversation",
            parameters: { name: `Sam's "playlist"` },
        });
        expectCommand(`@conversation new "Sam's \\"playlist\\""`);
    });

    it("listConversation runs list", async () => {
        await run({ actionName: "listConversation" });
        expectCommand("@conversation list");
    });

    it("showConversationInfo runs info", async () => {
        await run({ actionName: "showConversationInfo" });
        expectCommand("@conversation info");
    });

    it("switchConversation runs a quoted switch", async () => {
        await run({
            actionName: "switchConversation",
            parameters: { name: "my work project" },
        });
        expectCommand('@conversation switch "my work project"');
    });

    it("nextConversation runs next", async () => {
        await run({ actionName: "nextConversation" });
        expectCommand("@conversation next");
    });

    it("prevConversation runs prev", async () => {
        await run({ actionName: "prevConversation" });
        expectCommand("@conversation prev");
    });

    it("renameConversation (current) runs rename with one quoted arg", async () => {
        const r = await run({
            actionName: "renameConversation",
            parameters: { newName: "my project" },
        });
        expectCommand('@conversation rename "my project"');
        expect(r.resultEntity).toEqual({
            name: "my project",
            type: ["conversation"],
        });
    });

    it("renameConversation (targeted) runs rename with two quoted args", async () => {
        const r = await run({
            actionName: "renameConversation",
            parameters: { name: "test7", newName: "test5" },
        });
        expectCommand('@conversation rename "test7" "test5"');
        expect(r.resultEntity).toEqual({
            name: "test5",
            type: ["conversation"],
        });
    });

    it("deleteConversation runs a quoted delete", async () => {
        await run({
            actionName: "deleteConversation",
            parameters: { name: "old-project" },
        });
        expectCommand('@conversation delete "old-project"');
    });
});
