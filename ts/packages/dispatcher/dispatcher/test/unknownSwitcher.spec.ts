// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { parseToolsJsonSchema } from "@typeagent/action-schema";
import {
    AssistantSelection,
    getAssistantSelectionSchemas,
    selectFromPartitions,
} from "../src/translation/unknownSwitcher.js";
import {
    convertToActionConfig,
    type ActionConfig,
} from "../src/translation/actionConfig.js";
import type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../src/translation/actionConfigProvider.js";

function selectionProvider(
    definitions: Record<string, string[]>,
): ActionConfigProvider {
    const configs: Record<string, ActionConfig> = Object.fromEntries(
        Object.keys(definitions).map((name) => [
            name,
            convertToActionConfig(name, {
                emojiChar: "",
                description: name,
                schema: {
                    description: name,
                    schemaType: "AgentActions",
                    schemaFile: { format: "pas", content: "" },
                },
            })[name],
        ]),
    );
    return {
        tryGetActionConfig: (name) => configs[name],
        getActionConfig(name) {
            const config = configs[name];
            if (!config) throw new Error(`Unknown test schema: ${name}`);
            return config;
        },
        getActionConfigs: () => Object.values(configs),
        getActionSchemaFileForConfig(config): ActionSchemaFile {
            const names = definitions[config.schemaName];
            return {
                schemaName: config.schemaName,
                sourceHash: JSON.stringify(names),
                parsedActionSchema: parseToolsJsonSchema(
                    names.map((name) => ({
                        name,
                        description: name,
                        inputSchema: { type: "object", properties: {} },
                    })),
                    "AgentActions",
                ),
            };
        },
    };
}

describe("assistant selection schemas", () => {
    it("validates multiple MCP schemas with the same entry type and distinct names", () => {
        const definitions = {
            "mcp-one": ["first"],
            mcp_one: ["second"],
        };
        const schemas = getAssistantSelectionSchemas(
            Object.keys(definitions),
            selectionProvider(definitions),
        );
        expect(
            new Set(schemas.map((entry) => entry.schema.typeName)).size,
        ).toBe(2);
        const text = [
            ...schemas.map((entry) => entry.schema.schema),
            `export type Selection = ${schemas.map((entry) => entry.schema.typeName).join(" | ")};`,
        ].join("\n");
        const validator = createTypeScriptJsonValidator<AssistantSelection>(
            text,
            "Selection",
        );
        expect(
            validator.validate({ assistant: "mcp-one", action: "first" }),
        ).toEqual(success({ assistant: "mcp-one", action: "first" }));
        expect(
            validator.validate({ assistant: "mcp_one", action: "second" }),
        ).toEqual(success({ assistant: "mcp_one", action: "second" }));
        expect(
            validator.validate({ assistant: "mcp-one", action: "second" })
                .success,
        ).toBe(false);
    });

    it("uses the current actions after a dynamic catalog change", () => {
        const definitions = { macros: ["listApprovedMacros"] };
        const provider = selectionProvider(definitions);
        expect(
            getAssistantSelectionSchemas(["macros"], provider)[0].schema.schema,
        ).not.toContain("run_macro_v2");
        definitions.macros.push("run_macro_v2");
        expect(
            getAssistantSelectionSchemas(["macros"], provider)[0].schema.schema,
        ).toContain("run_macro_v2");
        definitions.macros = ["listApprovedMacros"];
        expect(
            getAssistantSelectionSchemas(["macros"], provider)[0].schema.schema,
        ).not.toContain("run_macro_v2");
    });

    it("does not reuse another provider's schema for the same name", () => {
        const first = selectionProvider({ shared: ["first"] });
        const second = selectionProvider({ shared: ["second"] });
        getAssistantSelectionSchemas(["shared"], first);
        const schemas = getAssistantSelectionSchemas(["shared"], second);
        expect(schemas[0].schema.schema).toContain('"second"');
        expect(schemas[0].schema.schema).not.toContain('"first"');
    });
});

function makeTranslator(
    result: Result<AssistantSelection>,
    delayMs = 0,
): { translate: (request: string) => Promise<Result<AssistantSelection>> } {
    return {
        translate: (_request: string) =>
            new Promise((resolve) =>
                setTimeout(() => resolve(result), delayMs),
            ),
    };
}

const unknownResult = success<AssistantSelection>({
    assistant: "unknown",
    action: "unknown",
});

const calendarResult = success<AssistantSelection>({
    assistant: "calendar",
    action: "addEvent",
});

const playerResult = success<AssistantSelection>({
    assistant: "player",
    action: "play",
});

describe("selectFromPartitions", () => {
    test("single partition returning a match", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(partitions, "add an event");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("calendar");
        }
    });

    test("single partition returning unknown yields unknown fallback", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
        ];
        const result = await selectFromPartitions(partitions, "do something");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
            expect(result.data.action).toBe("unknown");
        }
    });

    test("all partitions returning unknown yields unknown fallback", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(unknownResult) },
            { names: ["email"], translator: makeTranslator(unknownResult) },
        ];
        const result = await selectFromPartitions(
            partitions,
            "do something unrecognized",
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
        }
    });

    test("first non-unknown result is returned in partition order", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(playerResult) },
            { names: ["email"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(partitions, "play music");
        expect(result.success).toBe(true);
        if (result.success) {
            // "player" partition (index 1) is first non-unknown in order
            expect(result.data.assistant).toBe("player");
        }
    });

    test("earlier partition match wins even when later partition resolves first", async () => {
        const partitions = [
            // slow but should win (index 0, first in order)
            {
                names: ["calendar"],
                translator: makeTranslator(calendarResult, 30),
            },
            // fast but should lose (index 1, later in order)
            {
                names: ["player"],
                translator: makeTranslator(playerResult, 0),
            },
        ];
        const result = await selectFromPartitions(
            partitions,
            "add an event or play",
        );
        expect(result.success).toBe(true);
        if (result.success) {
            // calendar partition (index 0) wins even though player resolved first
            expect(result.data.assistant).toBe("calendar");
        }
    });

    test("all partitions run in parallel", async () => {
        const started: string[] = [];
        const pending: Array<() => void> = [];
        const makeDeferredTranslator = (
            name: string,
            result: Result<AssistantSelection>,
        ) => ({
            translate: (_request: string) => {
                started.push(name);
                return new Promise<Result<AssistantSelection>>((resolve) => {
                    pending.push(() => resolve(result));
                });
            },
        });

        const partitions = [
            {
                names: ["a"],
                translator: makeDeferredTranslator("a", unknownResult),
            },
            {
                names: ["b"],
                translator: makeDeferredTranslator("b", unknownResult),
            },
            {
                names: ["c"],
                translator: makeDeferredTranslator("c", unknownResult),
            },
        ];

        const selection = selectFromPartitions(partitions, "test");

        // Every translator must be invoked before any result is allowed to
        // resolve. A sequential implementation would only have started "a".
        expect(started).toEqual(["a", "b", "c"]);
        for (const resolve of pending) {
            resolve();
        }
        await selection;
    });

    test("error from a partition is propagated in order", async () => {
        const failResult = error("LLM call failed");
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(failResult) },
            { names: ["email"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(
            partitions,
            "something failing",
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.message).toBe("LLM call failed");
        }
    });

    test("empty partitions list returns unknown", async () => {
        const result = await selectFromPartitions([], "any request");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
        }
    });
});
