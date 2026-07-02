// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import {
    extractKeywords,
    buildExtractionInput,
} from "../src/context/contextSelector/keywordExtractor.js";
import {
    KeywordSidecar,
    COLLISION_KEYWORDS_FILE,
} from "../src/context/contextSelector/keywordSidecar.js";
import {
    KeywordIndex,
    ActionSchemaSource,
} from "../src/context/contextSelector/keywordIndex.js";

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
                parameters: {
                    type: { type: "object", fields: params },
                },
            },
        },
    } as unknown as ActionSchemaTypeDefinition;
}

describe("contextSelector/keywordExtractor", () => {
    it("extracts topical keywords and drops generic verbs / stopwords", () => {
        const kw = extractKeywords({
            schemaDescription: "Grocery shopping and todo lists",
            actionName: "addItems",
            actionComments: ["Add items to the list"],
            paramNames: ["itemName"],
            paramComments: ["the grocery item to add"],
        });
        expect(kw.has("grocery")).toBe(true);
        expect(kw.has("shopping")).toBe(true);
        expect(kw.has("todo")).toBe(true);
        expect(kw.has("item")).toBe(true); // "items"/"item" both stem to "item"
        expect(kw.has("items")).toBe(false);
        // generic verbs / stopwords are dropped; "list" is a kept domain noun.
        expect(kw.has("add")).toBe(false);
        expect(kw.has("the")).toBe(false);
        expect(kw.has("list")).toBe(true);
    });

    it("caps at topN, keeping the most frequent (deterministic tiebreak)", () => {
        const kw = extractKeywords(
            {
                schemaDescription: "alpha alpha beta gamma delta",
                actionName: "doThing",
            },
            2,
        );
        // alpha (freq 2) always kept; the second slot is the alphabetically
        // first among the freq-1 tokens (beta).
        expect([...kw].sort()).toEqual(["alpha", "beta"]);
    });

    it("buildExtractionInput walks parameter names, comments, arrays and refs", () => {
        const def = actionDef("addRow", ["Add a row to the spreadsheet"], {
            rowData: { type: { type: "string" }, comments: ["the row values"] },
            tags: {
                type: { type: "array", elementType: { type: "string" } },
                comments: ["category labels"],
            },
        });
        const input = buildExtractionInput(
            "addRow",
            def,
            "Spreadsheet editing",
        );
        const kw = extractKeywords(input);
        expect(kw.has("row")).toBe(true);
        expect(kw.has("spreadsheet")).toBe(true);
        expect(kw.has("value")).toBe(true); // "values" -> "value"
        expect(kw.has("category")).toBe(true);
        expect(kw.has("label")).toBe(true); // "labels" -> "label"
    });
});

describe("contextSelector/keywordSidecar", () => {
    it("adds, removes, and canonicalizes multi-word keywords", () => {
        const s = KeywordSidecar.load(undefined);
        s.addKeywords("excel.addRow", ["Spreadsheet", "pivot table"]);
        const d = s.deltaFor("excel", "addRow")!;
        expect(new Set(d.add)).toEqual(
            new Set(["spreadsheet", "pivot", "table"]),
        );

        s.removeKeywords("excel.addRow", ["spreadsheet"]);
        const d2 = s.deltaFor("excel", "addRow")!;
        expect(d2.add).not.toContain("spreadsheet");
        expect(d2.remove).toContain("spreadsheet");
    });

    it("keys sub-schema ids by the last dot", () => {
        const s = KeywordSidecar.load(undefined);
        s.addKeywords("excel.chart.addSeries", ["series"]);
        // "series" stems to "serie" through the shared canonicalizer.
        expect(s.deltaFor("excel.chart", "addSeries")?.add).toContain("serie");
    });

    it("clears an entry", () => {
        const s = KeywordSidecar.load(undefined);
        s.addKeywords("a.b", ["coupon"]);
        expect(s.clearEntry("a.b")).toBe(true);
        expect(s.isEmpty).toBe(true);
    });

    it("ignores sub-minimum-length keywords (canonicalized away)", () => {
        const s = KeywordSidecar.load(undefined);
        s.addKeywords("a.b", ["x"]);
        expect(s.isEmpty).toBe(true);
    });

    it("persists to disk and reloads; degrades to empty on malformed JSON", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-sidecar-"));
        try {
            const s = KeywordSidecar.load(dir);
            s.addKeywords("excel.addRow", ["spreadsheet"]);
            const reloaded = KeywordSidecar.load(dir);
            expect(reloaded.deltaFor("excel", "addRow")?.add).toContain(
                "spreadsheet",
            );

            fs.writeFileSync(
                path.join(dir, COLLISION_KEYWORDS_FILE),
                "{ not json",
                "utf8",
            );
            expect(KeywordSidecar.load(dir).isEmpty).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("contextSelector/keywordIndex", () => {
    const def = actionDef("addItems", ["Add items"], {
        items: { type: { type: "string" }, comments: ["grocery items"] },
    });
    const source: ActionSchemaSource = {
        getSchemaDescription: () => "grocery shopping list",
        getActionDefinition: (_s, a) => (a === "addItems" ? def : undefined),
    };

    it("derives keywords and memoizes them", () => {
        const sidecar = KeywordSidecar.load(undefined);
        const index = new KeywordIndex(source, () => sidecar);
        const a = index.derived("list", "addItems");
        const b = index.derived("list", "addItems");
        expect(a).toBe(b); // memoized identity
        expect(a.has("grocery")).toBe(true);
        expect(a.has("shopping")).toBe(true);
    });

    it("returns an empty vector for an unknown action", () => {
        const index = new KeywordIndex(source, () =>
            KeywordSidecar.load(undefined),
        );
        expect(index.derived("list", "missing").size).toBe(0);
    });

    it("merges sidecar add/remove into the effective vector", () => {
        const sidecar = KeywordSidecar.load(undefined);
        const index = new KeywordIndex(source, () => sidecar);
        sidecar.addKeywords("list.addItems", ["coupon"]);
        sidecar.removeKeywords("list.addItems", ["shopping"]);
        const eff = index.effective("list", "addItems");
        expect(eff.has("coupon")).toBe(true);
        expect(eff.has("shopping")).toBe(false);
        expect(eff.has("grocery")).toBe(true);
    });

    it("invalidate drops the derived memo", () => {
        const index = new KeywordIndex(source, () =>
            KeywordSidecar.load(undefined),
        );
        const a = index.derived("list", "addItems");
        index.invalidate("list");
        expect(index.derived("list", "addItems")).not.toBe(a);
    });
});
