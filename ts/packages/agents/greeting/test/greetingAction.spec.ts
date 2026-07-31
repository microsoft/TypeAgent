// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const { instantiate } = await import(
    pathToFileURL(path.join(packageRoot, "dist", "greetingCommandHandler.js"))
        .href
);

function mockAction() {
    return {
        schemaName: "greeting",
        actionName: "personalizedGreetingAction",
        parameters: {
            mock: true,
            originalRequest: "hello",
            possibleGreetings: [],
        },
    } as any;
}

describe("greeting action parity", () => {
    it("exposes an executable personalizedGreetingAction", async () => {
        const agent = instantiate();

        assert.equal(typeof agent.executeAction, "function");
        const result = await agent.executeAction!(mockAction(), {} as any);
        assert.equal(
            (result as any).displayContent,
            "Hello.  How can I help you today?",
        );
    });

    it("links the bare command default to personalizedGreetingAction", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        assert.ok("commands" in descriptors);
        assert.notEqual(typeof descriptors.defaultSubCommand, "string");
        assert.equal(
            (descriptors.defaultSubCommand as CommandDescriptor).action,
            "personalizedGreetingAction",
        );
    });

    it("returns the same mock display through the command", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        assert.ok("commands" in descriptors);
        assert.notEqual(typeof descriptors.defaultSubCommand, "string");
        const command = descriptors.defaultSubCommand as any;

        const result = await command.run({} as any, {
            args: {},
            flags: { mock: true },
        });

        assert.equal(
            result.displayContent,
            "Hello.  How can I help you today?",
        );
        assert.deepEqual(result.tokenUsage, {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        });
    });
});
