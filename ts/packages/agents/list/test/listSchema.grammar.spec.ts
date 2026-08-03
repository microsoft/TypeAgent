// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar contract for listSchema.agr (Robert / PR feedback):
 * - Named lists match deterministically.
 * - Bare / ambiguous references do not match — translation owns them.
 * - The list agent does not police listName (create "my" is allowed).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGrammarRules, matchGrammar } from "@typeagent/action-grammar";

function resolveAgrPath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, "../src/listSchema.agr"),
        join(here, "../../src/listSchema.agr"),
    ];
    for (const c of candidates) {
        if (existsSync(c)) {
            return c;
        }
    }
    throw new Error(`listSchema.agr not found from ${here}`);
}

function loadListGrammar() {
    const source = readFileSync(resolveAgrPath(), "utf8")
        .replace(/^import .*$/m, "")
        .replace(/<Start>\s*:\s*ListAction\s*=/, "<Start> =");
    return loadGrammarRules("listSchema.agr", source);
}

function actions(request: string) {
    return matchGrammar(loadListGrammar(), request).map(
        (m) => (m as { match: unknown }).match ?? m,
    ) as Array<{
        actionName: string;
        parameters: { listName?: string; items?: string[] };
    }>;
}

describe("listSchema.agr named-list grammar", () => {
    describe("bare / ambiguous references fall through (no grammar match)", () => {
        it.each([
            "add ham to the list",
            "add cheese to both",
            "put cheese on the list",
            "add ham to my list",
            "add ham to that list",
            "remove ham from the list",
            "take ham off the list",
            "what's on the list",
            "what's on my list",
            "clear the list",
            "empty the list",
            "delete everything from the list",
            // Determinerless form unmatched on purpose — avoids reopening
            // "to $(listName) list" → listName="the".
            "add milk to grocery list",
        ])("%s", (request) => {
            expect(actions(request)).toEqual([]);
        });
    });

    describe("named lists match", () => {
        it("add / put named lists", () => {
            expect(actions("add milk to the grocery list")[0]).toMatchObject({
                actionName: "addItems",
                parameters: { items: ["milk"], listName: "grocery" },
            });
            expect(actions("add milk to my shopping list")[0]).toMatchObject({
                actionName: "addItems",
                parameters: { items: ["milk"], listName: "shopping" },
            });
            expect(
                actions("can you add eggs to the grocery list")[0],
            ).toMatchObject({
                actionName: "addItems",
                parameters: { items: ["eggs"], listName: "grocery" },
            });
            const two = actions(
                "can you add milk and eggs to the grocery list",
            );
            expect(
                two.some(
                    (a) =>
                        a.actionName === "addItems" &&
                        a.parameters.listName === "grocery" &&
                        a.parameters.items?.includes("milk") &&
                        a.parameters.items?.includes("eggs"),
                ),
            ).toBe(true);
            expect(actions("put cheese on the grocery list")[0]).toMatchObject({
                actionName: "addItems",
                parameters: { items: ["cheese"], listName: "grocery" },
            });
        });

        it("remove / get / clear named lists", () => {
            expect(
                actions("remove ham from the grocery list")[0],
            ).toMatchObject({
                actionName: "removeItems",
                parameters: { items: ["ham"], listName: "grocery" },
            });
            expect(actions("what's on the grocery list")[0]).toMatchObject({
                actionName: "getList",
                parameters: { listName: "grocery" },
            });
            expect(
                actions("delete everything from the grocery list")[0],
            ).toMatchObject({
                actionName: "clearList",
                parameters: { listName: "grocery" },
            });
            expect(
                actions("delete all items from my shopping list")[0],
            ).toMatchObject({
                actionName: "clearList",
                parameters: { listName: "shopping" },
            });
        });

        it("delete <item> is removeItems, not clearList", () => {
            const m = actions("delete milk from the grocery list");
            expect(m[0]).toMatchObject({
                actionName: "removeItems",
                parameters: { items: ["milk"], listName: "grocery" },
            });
            expect(m.every((a) => a.actionName !== "clearList")).toBe(true);
        });

        it("create allows listName my", () => {
            expect(actions("create my list")[0]).toMatchObject({
                actionName: "createList",
                parameters: { listName: "my" },
            });
        });
    });
});
