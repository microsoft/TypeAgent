// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { executeBrowserConfigAction } from "../src/agent/configActionHandler.mjs";

describe("browser config actions", () => {
    it("maps every action to its canonical command path and parameters", async () => {
        const calls: unknown[][] = [];
        const execute = async (...args: unknown[]) => {
            calls.push(args);
            return undefined;
        };
        const handlers = { description: "test", commands: {} } as any;
        const context = { id: "context" } as any;
        const cases = [
            [
                "useExternalBrowserControl",
                undefined,
                ["external", "on"],
                undefined,
            ],
            [
                "useClientBrowserControl",
                undefined,
                ["external", "off"],
                undefined,
            ],
            ["listUrlResolvers", undefined, ["resolver", "list"], undefined],
            [
                "toggleKeywordResolver",
                undefined,
                ["resolver", "keyword"],
                undefined,
            ],
            [
                "toggleHistoryResolver",
                undefined,
                ["resolver", "history"],
                undefined,
            ],
            ["showLookupSettings", undefined, ["lookup", "status"], undefined],
            [
                "setLookupMode",
                { mode: "mcp" },
                ["lookup", "mode"],
                { args: { mode: "mcp" }, flags: undefined },
            ],
            ["listSearchProviders", undefined, ["search", "list"], undefined],
            [
                "setSearchProvider",
                { provider: "Bing" },
                ["search", "set"],
                { args: { provider: "Bing" }, flags: undefined },
            ],
            [
                "showSearchProvider",
                { provider: "Bing" },
                ["search", "show"],
                { args: { provider: "Bing" }, flags: undefined },
            ],
            [
                "showSearchProvider",
                { provider: "" },
                ["search", "show"],
                { args: { provider: undefined }, flags: undefined },
            ],
            [
                "addSearchProvider",
                { provider: "Example", url: "https://example.com/?q=%s" },
                ["search", "add"],
                {
                    args: {
                        provider: "Example",
                        url: "https://example.com/?q=%s",
                    },
                    flags: undefined,
                },
            ],
            [
                "removeSearchProvider",
                { provider: "Example" },
                ["search", "remove"],
                { args: { provider: "Example" }, flags: undefined },
            ],
            [
                "importSearchProviders",
                { browser: "Edge" },
                ["search", "import"],
                { args: { browser: "Edge" }, flags: undefined },
            ],
        ] as const;

        for (const [actionName, parameters] of cases) {
            await executeBrowserConfigAction(
                {
                    schemaName: "browser.config",
                    actionName,
                    ...(parameters === undefined ? {} : { parameters }),
                } as any,
                context,
                handlers,
                execute as any,
            );
        }

        expect(calls).toEqual(
            cases.map(([, , commands, params]) => [
                handlers,
                commands,
                params,
                context,
            ]),
        );
    });
});
