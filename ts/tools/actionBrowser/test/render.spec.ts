// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderHtml } from "../src/render.js";
import type { Catalog } from "../src/types.js";

describe("renderHtml", () => {
    it("emits syntactically valid embedded JavaScript for qualified links", () => {
        const catalog: Catalog = {
            generatedAt: "2026-07-31T00:00:00.000Z",
            agents: [
                {
                    name: "demo",
                    category: "Other",
                    emoji: "",
                    description: "",
                    schemas: [
                        {
                            schemaName: "demo.admin",
                            description: "",
                            defaultEnabled: true,
                            transient: false,
                            actions: [
                                {
                                    actionName: "runTask",
                                    description: "",
                                    parameters: [],
                                    phrasings: [],
                                },
                            ],
                        },
                    ],
                },
            ],
            commands: [
                {
                    host: "demo",
                    path: "run",
                    description: "",
                    group: false,
                    executable: true,
                    args: [],
                    flags: [],
                    action: {
                        schema: "demo.admin",
                        actionName: "runTask",
                        resolvedSchema: "demo.admin",
                    },
                },
            ],
            commandActionLinkIssues: [],
            missingCommandActions: [],
            runtimeOnlySchemas: [],
            counts: {
                agents: 1,
                actions: 1,
                commands: 1,
                commandEndpoints: 1,
                linkedCommandEndpoints: 1,
                missingCommandActions: 0,
                invalidCommandActionLinks: 0,
            },
        };

        const html = renderHtml(catalog);
        const scripts = [
            ...html.matchAll(
                /<script\b[^>]*>([\s\S]*?)<\/script(?:\s+[^>]*)?>/gi,
            ),
        ];
        const executableScript = scripts.at(-1)?.[1];

        expect(executableScript).toBeDefined();
        expect(() => new Function(executableScript!)).not.toThrow();
        expect(executableScript).toContain("n.schema+'\\n'+n.name");
    });
});
