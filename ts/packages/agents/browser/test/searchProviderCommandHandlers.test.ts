// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ShowCommandHandler } from "../src/agent/searchProvider/searchProviderCommandHandlers.mjs";

describe("search provider show command", () => {
    it("shows the active provider when no provider is specified", async () => {
        const displays: unknown[] = [];
        const bing = {
            name: "Bing",
            searchUrl: "https://www.bing.com/search?q=%s",
        };
        const context = {
            sessionContext: {
                agentContext: {
                    searchProviders: [
                        bing,
                        {
                            name: "Google",
                            searchUrl: "https://www.google.com/search?q=%s",
                        },
                    ],
                    activeSearchProvider: bing,
                },
            },
            actionIO: {
                appendDisplay: (display: unknown) => displays.push(display),
            },
        } as any;

        await new ShowCommandHandler().run(context, {
            args: { provider: undefined },
            flags: undefined,
        });

        expect(displays).toContain(JSON.stringify(bing, null, 2));
        expect(JSON.stringify(displays)).not.toContain("not found");
    });
});
