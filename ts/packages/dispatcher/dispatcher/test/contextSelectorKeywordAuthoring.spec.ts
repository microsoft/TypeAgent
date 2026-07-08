// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import path from "node:path";
import {
    parseKeywordFileContent,
    keywordFilePathFor,
    KeywordFile,
} from "../src/context/contextSelector/keywordFile.js";
import {
    distillKeywords,
    stripExampleValues,
    CreateChatModel,
} from "../src/context/contextSelector/keywordDistiller.js";
import { produceKeywordFile } from "../src/context/contextSelector/keywordProducer.js";
import {
    KeywordIndex,
    ActionSchemaSource,
} from "../src/context/contextSelector/keywordIndex.js";
import { KeywordSidecar } from "../src/context/contextSelector/keywordSidecar.js";

function actionDef(
    actionName: string,
    comments: string[],
    params: Record<string, { type: any; comments?: string[] }>,
): ActionSchemaTypeDefinition {
    return {
        alias: false,
        name: actionName,
        comments,
        type: {
            type: "object",
            fields: {
                actionName: {
                    type: { type: "string-union", typeEnum: [actionName] },
                },
                parameters: { type: { type: "object", fields: params } },
            },
        },
    } as unknown as ActionSchemaTypeDefinition;
}

// A stub ChatModel matching the shape distillKeywords uses (complete()).
function stubModel(
    respond: (prompt: string) => string,
    opts: { fail?: boolean; throws?: boolean } = {},
): CreateChatModel {
    return () =>
        ({
            complete: async (prompt: string) => {
                if (opts.throws) {
                    throw new Error("boom");
                }
                if (opts.fail) {
                    return { success: false, message: "nope" };
                }
                return { success: true, data: respond(prompt) };
            },
        }) as any;
}

describe("contextSelector/keywordFilePathFor", () => {
    const abs = (p: string) => path.resolve(p);
    const base = (p: string | undefined) =>
        p === undefined ? undefined : path.basename(p);

    it("resolves the sibling keyword file for .ts / .mts / .cts sources", () => {
        for (const ext of ["ts", "mts", "cts"]) {
            const src = abs(`agents/foo/src/fooSchema.${ext}`);
            const result = keywordFilePathFor(src, undefined);
            expect(base(result)).toBe("fooSchema.keywords.json");
            // Sits beside the source, not in a bogus tree.
            expect(result && path.dirname(result)).toBe(path.dirname(src));
        }
    });

    it("prefers the original .ts source over the (dist) schema file", () => {
        const result = keywordFilePathFor(
            abs("agents/foo/src/fooSchema.ts"),
            abs("agents/foo/dist/fooSchema.pas.json"),
        );
        expect(result).toBe(abs("agents/foo/src/fooSchema.keywords.json"));
    });

    it("returns undefined for no path, relative paths, and .pas.json-only", () => {
        expect(keywordFilePathFor(undefined, undefined)).toBeUndefined();
        // Relative (inline/system agents bypass patchPaths).
        expect(
            keywordFilePathFor("src/fooSchema.ts", undefined),
        ).toBeUndefined();
        // dist-only compiled schema — not a committable source location.
        expect(
            keywordFilePathFor(
                undefined,
                abs("agents/foo/dist/fooSchema.pas.json"),
            ),
        ).toBeUndefined();
    });
});

describe("contextSelector/keywordFile parse", () => {
    it("normalizes a well-formed file and filters non-string tokens", () => {
        const file = parseKeywordFileContent(
            {
                schemaVersion: 1,
                schema: "list",
                generatedBy: "llm",
                generatedAt: "2026-01-01T00:00:00.000Z",
                actions: {
                    addItems: ["grocery", "shopping", 5, null],
                    getList: ["reading"],
                },
            },
            "list",
        );
        expect(file).toBeDefined();
        expect(file!.actions.addItems).toEqual(["grocery", "shopping"]);
        expect(file!.actions.getList).toEqual(["reading"]);
        expect(file!.generatedBy).toBe("llm");
    });

    it("degrades to undefined on malformed input", () => {
        expect(parseKeywordFileContent(undefined, "list")).toBeUndefined();
        expect(parseKeywordFileContent(null, "list")).toBeUndefined();
        expect(parseKeywordFileContent("not json", "list")).toBeUndefined();
        expect(parseKeywordFileContent(42, "list")).toBeUndefined();
        expect(parseKeywordFileContent([], "list")).toBeUndefined();
        expect(parseKeywordFileContent({}, "list")).toBeUndefined();
        expect(
            parseKeywordFileContent({ actions: null }, "list"),
        ).toBeUndefined();
    });

    it("canonicalizes non-canonical tokens on load (case, plurals, stopwords)", () => {
        const file = parseKeywordFileContent(
            {
                actions: {
                    addRow: ["Cells", "spreadsheets", "the", "add", "FORMULA"],
                },
            },
            "excel",
        );
        // "Cells"->"cell", "spreadsheets"->"spreadsheet", "FORMULA"->"formula";
        // stopword "the" and generic verb "add" dropped — so the committed file
        // stores exactly what the scorer can match.
        expect(file!.actions.addRow).toEqual([
            "cell",
            "spreadsheet",
            "formula",
        ]);
    });

    it("preserves sourceHash when present", () => {
        const file = parseKeywordFileContent(
            { sourceHash: "abc123", actions: { a: ["x"] } },
            "list",
        );
        expect(file!.sourceHash).toBe("abc123");
        const noHash = parseKeywordFileContent(
            { actions: { a: ["x"] } },
            "list",
        );
        expect(noHash!.sourceHash).toBeUndefined();
    });

    it("defaults provenance/schema when missing", () => {
        const file = parseKeywordFileContent({ actions: { a: ["x"] } }, "list");
        expect(file!.schema).toBe("list");
        expect(file!.generatedBy).toBe("lexical");
    });
});

describe("contextSelector/keywordDistiller", () => {
    const input = {
        schemaDescription: "spreadsheet operations",
        actionName: "addRow",
        actionComments: ["add a row to the sheet"],
        paramNames: ["values"],
        paramComments: ["cell values"],
    };

    it("parses keywords and canonicalizes through the shared tokenizer", async () => {
        // Model returns fenced JSON with a generic verb, a plural, and a stopword.
        const create = stubModel(
            () =>
                '```json\n{ "keywords": ["spreadsheet", "Cells", "add", "the", "formula"] }\n```',
        );
        const kw = await distillKeywords(input, { createModel: create });
        expect(kw).toBeDefined();
        // canonicalized: lowercased, "Cells"->"cell", generic verb "add" and
        // stopword "the" dropped.
        expect(kw).toContain("spreadsheet");
        expect(kw).toContain("cell");
        expect(kw).toContain("formula");
        expect(kw).not.toContain("add");
        expect(kw).not.toContain("the");
    });

    it("returns undefined on model failure, throw, or unparseable output", async () => {
        expect(
            await distillKeywords(input, {
                createModel: stubModel(() => "", { fail: true }),
            }),
        ).toBeUndefined();
        expect(
            await distillKeywords(input, {
                createModel: stubModel(() => "", { throws: true }),
            }),
        ).toBeUndefined();
        expect(
            await distillKeywords(input, {
                createModel: stubModel(() => "not json at all"),
            }),
        ).toBeUndefined();
    });

    it("respects topN after canonicalization", async () => {
        const create = stubModel(
            () => '{ "keywords": ["alpha","beta","gamma","delta","epsilon"] }',
        );
        const kw = await distillKeywords(input, {
            createModel: create,
            topN: 3,
        });
        expect(kw).toHaveLength(3);
        expect(kw).toEqual(["alpha", "beta", "gamma"]);
    });

    it("strips illustrative example values before prompting the model", async () => {
        // Example values in a param doc must NOT reach the model, or it anchors
        // on them (list.addItems -> garden/movie/gift). The concept + action name
        // must survive.
        let prompt = "";
        const create = stubModel((p) => {
            prompt = p;
            return '{ "keywords": ["list"] }';
        });
        await distillKeywords(
            {
                schemaDescription: "list agent",
                actionName: "addItems",
                actionComments: ["add one or more items to a list"],
                paramNames: ["listName"],
                paramComments: [
                    "name of the list such as 'zucchini', 'kayak', 'trombone', 'obsidian task'",
                ],
            },
            { createModel: create },
        );
        for (const junk of ["zucchini", "kayak", "trombone", "obsidian"]) {
            expect(prompt).not.toContain(junk);
        }
        expect(prompt).toContain("addItems");
        expect(prompt.toLowerCase()).toContain("list");
    });

    it("stripExampleValues drops quoted + 'such as' enumerations, keeps concepts", () => {
        expect(
            stripExampleValues(
                "name of the list such as 'grocery', 'gift', 'movie'",
            ),
        ).not.toMatch(/grocery|gift|movie/);
        expect(
            stripExampleValues('a color, e.g. "red", "green", "blue"'),
        ).not.toMatch(/red|green|blue/);
        // No examples -> unchanged concept text.
        expect(stripExampleValues("the spreadsheet cell value")).toBe(
            "the spreadsheet cell value",
        );
    });
});

describe("contextSelector/keywordProducer", () => {
    const actions = new Map<string, ActionSchemaTypeDefinition>([
        [
            "addItems",
            actionDef("addItems", ["Add items to the list"], {
                item: { type: { type: "string" }, comments: ["grocery item"] },
            }),
        ],
    ]);

    it("lexical-only produces a deterministic file (no model)", async () => {
        const { file, distilled, lexical } = await produceKeywordFile({
            schemaName: "list",
            schemaDescription: "grocery shopping list",
            actions,
        });
        expect(distilled).toBe(0);
        expect(lexical).toBe(1);
        expect(file.generatedBy).toBe("lexical");
        expect(file.actions.addItems).toContain("grocery");
        expect(file.actions.addItems).toContain("item");
    });

    it("prefers distillation and marks provenance llm", async () => {
        const create = stubModel(
            () => '{ "keywords": ["grocery", "produce", "pantry"] }',
        );
        const { file, distilled } = await produceKeywordFile(
            { schemaName: "list", schemaDescription: "lists", actions },
            { createModel: create },
        );
        expect(distilled).toBe(1);
        expect(file.generatedBy).toBe("llm");
        expect(file.actions.addItems).toEqual(["grocery", "produce", "pantry"]);
    });

    it("falls back to lexical when distillation fails for an action", async () => {
        const create = stubModel(() => "", { fail: true });
        const { file, distilled, lexical } = await produceKeywordFile(
            { schemaName: "list", schemaDescription: "grocery list", actions },
            { createModel: create },
        );
        expect(distilled).toBe(0);
        expect(lexical).toBe(1);
        expect(file.generatedBy).toBe("lexical");
        expect(file.actions.addItems).toContain("grocery");
    });

    it("marks a mixed file 'lexical' so a refresh re-distills the fallbacks", async () => {
        const twoActions = new Map<string, ActionSchemaTypeDefinition>([
            [
                "addItems",
                actionDef("addItems", ["add grocery items"], {
                    item: { type: { type: "string" } },
                }),
            ],
            [
                "getList",
                actionDef("getList", ["get the list"], {
                    id: { type: { type: "string" } },
                }),
            ],
        ]);
        // Model distills addItems but fails (empty) on getList.
        const create = stubModel((prompt) =>
            prompt.includes("action name: addItems")
                ? '{ "keywords": ["grocery", "produce"] }'
                : "",
        );
        const { file, distilled, lexical } = await produceKeywordFile(
            {
                schemaName: "list",
                schemaDescription: "lists",
                actions: twoActions,
            },
            { createModel: create },
        );
        expect(distilled).toBe(1);
        expect(lexical).toBe(1);
        expect(file.generatedBy).toBe("lexical"); // mixed -> lexical
        expect(file.actions.addItems).toEqual(["grocery", "produce"]);
    });
});

describe("contextSelector/keywordIndex read-path precedence", () => {
    const def = actionDef("addItems", ["Add items"], {
        items: { type: { type: "string" }, comments: ["grocery items"] },
    });
    const keywordFile: KeywordFile = {
        schemaVersion: 1,
        schema: "list",
        generatedBy: "llm",
        generatedAt: "",
        actions: { addItems: ["distilled", "synonym", "pantry"] },
    };
    const source: ActionSchemaSource = {
        getKeywordFile: (s) => (s === "list" ? keywordFile : undefined),
        getSchemaDescription: () => "grocery shopping list",
        getActionDefinition: (_s, a) => (a === "addItems" ? def : undefined),
    };

    it("prefers the committed keyword file over live lexical extraction", () => {
        const index = new KeywordIndex(source, () =>
            KeywordSidecar.load(undefined),
        );
        const v = index.derived("list", "addItems");
        // From the file, NOT the schema-derived lexical vector.
        expect(v.has("distilled")).toBe(true);
        expect(v.has("synonym")).toBe(true);
        expect(v.has("grocery")).toBe(false); // would be present if lexical
    });

    it("falls back to lexical when the file lacks the action", () => {
        const index = new KeywordIndex(source, () =>
            KeywordSidecar.load(undefined),
        );
        // "removeItems" isn't in the keyword file; but no definition either → empty.
        expect(index.derived("list", "removeItems").size).toBe(0);
    });

    it("falls back to lexical when there is no keyword file for the schema", () => {
        const index = new KeywordIndex(source, () =>
            KeywordSidecar.load(undefined),
        );
        // "other" schema has no keyword file, so it falls back to the live
        // lexical floor (the stub's getActionDefinition returns the def) — the
        // vector is the schema-derived one, NOT the file's.
        const v = index.derived("other", "addItems");
        expect(v.has("grocery")).toBe(true); // lexical
        expect(v.has("distilled")).toBe(false); // not the file vector
    });

    it("sidecar deltas still layer on top of the file vector", () => {
        const sidecar = KeywordSidecar.load(undefined);
        const index = new KeywordIndex(source, () => sidecar);
        sidecar.addKeywords("list.addItems", ["coupon"]);
        sidecar.removeKeywords("list.addItems", ["synonym"]);
        const eff = index.effective("list", "addItems");
        expect(eff.has("distilled")).toBe(true); // from file
        expect(eff.has("coupon")).toBe(true); // sidecar add
        expect(eff.has("synonym")).toBe(false); // sidecar remove
    });

    it("invalidate re-reads the keyword file", () => {
        let calls = 0;
        const countingSource: ActionSchemaSource = {
            getKeywordFile: (s) => {
                calls++;
                return s === "list" ? keywordFile : undefined;
            },
            getSchemaDescription: () => "list",
            getActionDefinition: (_s, a) =>
                a === "addItems" ? def : undefined,
        };
        const index = new KeywordIndex(countingSource, () =>
            KeywordSidecar.load(undefined),
        );
        index.derived("list", "addItems");
        index.derived("list", "addItems"); // memoized, no re-read
        expect(calls).toBe(1);
        index.invalidate("list");
        index.derived("list", "addItems");
        expect(calls).toBe(2);
    });

    it("invalidate(agent) also clears cached sub-schema keyword files", () => {
        const files: Record<string, KeywordFile> = {
            player: { ...keywordFile, schema: "player" },
            "player.spotify": { ...keywordFile, schema: "player.spotify" },
        };
        const reads: string[] = [];
        const src: ActionSchemaSource = {
            getKeywordFile: (s) => {
                reads.push(s);
                return files[s];
            },
            getSchemaDescription: () => "music",
            getActionDefinition: (_s, a) =>
                a === "addItems" ? def : undefined,
        };
        const index = new KeywordIndex(src, () =>
            KeywordSidecar.load(undefined),
        );
        index.derived("player", "addItems");
        index.derived("player.spotify", "addItems");
        expect(reads).toEqual(["player", "player.spotify"]);
        // Agent reload passes the agent name "player", the prefix of its
        // sub-schema names; both keyword-file memos must drop so both re-read.
        index.invalidate("player");
        index.derived("player", "addItems");
        index.derived("player.spotify", "addItems");
        expect(reads).toEqual([
            "player",
            "player.spotify",
            "player",
            "player.spotify",
        ]);
    });
});
