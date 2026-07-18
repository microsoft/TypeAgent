// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeActionSchemaFileHash } from "agent-cache";
import { generateKeywordFileForSchemaSource } from "../src/context/contextSelector/keywordGen.js";
import {
    loadKeywordFile,
    KEYWORD_FILE_SUFFIX,
} from "../src/context/contextSelector/keywordFile.js";
import { CreateChatModel } from "../src/context/contextSelector/keywordDistiller.js";

// Minimal but real TypeAgent action schema the parser accepts. Two actions so we
// can assert both end up in the file.
const GROCERY_SCHEMA = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddItemsAction = {
    // Add one or more items to the grocery list.
    actionName: "addItems";
    parameters: {
        // The grocery items to add.
        items: string[];
    };
};

export type RemoveItemsAction = {
    // Remove items from the grocery list.
    actionName: "removeItems";
    parameters: {
        items: string[];
    };
};

export type GroceryActions = AddItemsAction | RemoveItemsAction;
`;

// A stub ChatModel matching the shape distillKeywords uses (complete()).
function stubModel(respond: (prompt: string) => string): CreateChatModel {
    return () =>
        ({
            complete: async (prompt: string | { content?: unknown }[]) => {
                const text =
                    typeof prompt === "string"
                        ? prompt
                        : prompt
                              .map((s) =>
                                  typeof s?.content === "string"
                                      ? s.content
                                      : JSON.stringify(s),
                              )
                              .join("\n");
                return { success: true, data: respond(text) };
            },
        }) as any;
}

describe("contextSelector/generateKeywordFileForSchemaSource", () => {
    let dir: string;
    let sourcePath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "kwgen-"));
        sourcePath = path.join(dir, "grocerySchema.ts");
        fs.writeFileSync(sourcePath, GROCERY_SCHEMA);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("lexical-only: writes a sibling file, canonical actions, matching sourceHash", async () => {
        const result = await generateKeywordFileForSchemaSource({
            schemaName: "grocery",
            schemaSourcePath: sourcePath,
            entryTypeName: "GroceryActions",
            schemaDescription: "grocery shopping list",
        });

        // The committed file sits beside the schema source.
        const expectedPath = path.join(
            dir,
            `grocerySchema${KEYWORD_FILE_SUFFIX}`,
        );
        expect(result.keywordFilePath).toBe(expectedPath);
        expect(fs.existsSync(expectedPath)).toBe(true);
        expect(result.generatedBy).toBe("lexical");
        expect(result.actionCount).toBe(2);
        expect(result.distilled).toBe(0);
        expect(result.lexical).toBe(2);

        const file = loadKeywordFile(expectedPath, "grocery");
        expect(file).toBeDefined();
        expect(file!.schema).toBe("grocery");
        expect(file!.generatedBy).toBe("lexical");
        // Keyed by the real action names.
        expect(Object.keys(file!.actions).sort()).toEqual([
            "addItems",
            "removeItems",
        ]);
        // The lexical floor mines the schema text for the domain noun.
        expect(file!.actions.addItems).toContain("grocery");
        // sourceHash reproduces exactly what the dispatcher stamps at load:
        // computeActionSchemaFileHash of the schema-TYPE name string + source.
        expect(file!.sourceHash).toBe(
            computeActionSchemaFileHash("GroceryActions", GROCERY_SCHEMA),
        );
    });

    it("LLM-preferred: distilled keywords flow through, provenance is llm", async () => {
        const create = stubModel(
            () => '{ "keywords": ["grocery", "produce", "pantry"] }',
        );
        const result = await generateKeywordFileForSchemaSource({
            schemaName: "grocery",
            schemaSourcePath: sourcePath,
            entryTypeName: "GroceryActions",
            schemaDescription: "grocery list",
            createModel: create,
        });

        expect(result.generatedBy).toBe("llm");
        expect(result.distilled).toBe(2);
        expect(result.lexical).toBe(0);

        const file = loadKeywordFile(result.keywordFilePath, "grocery");
        expect(file!.actions.addItems).toEqual([
            "grocery",
            "produce",
            "pantry",
        ]);
        expect(file!.actions.removeItems).toEqual([
            "grocery",
            "produce",
            "pantry",
        ]);
    });

    it("throws on a non-absolute / non-.ts source path (no committable location)", async () => {
        await expect(
            generateKeywordFileForSchemaSource({
                schemaName: "grocery",
                schemaSourcePath: "grocerySchema.ts", // relative
                entryTypeName: "GroceryActions",
            }),
        ).rejects.toThrow(/Cannot place a keyword file/);
    });

    it("throws when the schema source cannot be parsed", async () => {
        const badPath = path.join(dir, "badSchema.ts");
        fs.writeFileSync(badPath, "this is not a valid schema {{{");
        await expect(
            generateKeywordFileForSchemaSource({
                schemaName: "bad",
                schemaSourcePath: badPath,
                entryTypeName: "BadActions",
            }),
        ).rejects.toThrow();
        // No file is left behind on failure.
        expect(
            fs.existsSync(path.join(dir, `badSchema${KEYWORD_FILE_SUFFIX}`)),
        ).toBe(false);
    });
});
