// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { executeBrowserAutomationAction } from "../src/agent/automationActionHandler.mjs";

describe("browser automation actions", () => {
    it("maps lifecycle actions to canonical commands", async () => {
        const calls: unknown[][] = [];
        const execute = async (...args: unknown[]) => {
            calls.push(args);
            return undefined;
        };
        const handlers = { description: "test", commands: {} } as any;
        const context = { id: "context" } as any;
        const cases = [
            ["launchHiddenAutomationBrowser", ["auto", "launch", "hidden"]],
            [
                "launchStandaloneAutomationBrowser",
                ["auto", "launch", "standalone"],
            ],
            ["closeAutomationBrowser", ["auto", "close"]],
        ] as const;

        for (const [actionName] of cases) {
            await executeBrowserAutomationAction(
                { schemaName: "browser.automation", actionName } as any,
                context,
                handlers,
                execute as any,
            );
        }

        expect(calls).toEqual(
            cases.map(([, commands]) => [
                handlers,
                commands,
                undefined,
                context,
            ]),
        );
    });
});
