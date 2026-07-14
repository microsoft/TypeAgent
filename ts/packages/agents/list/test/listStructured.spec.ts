// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for buildListResult in listActionHandler — it renders a named
 * list as a StructuredContent document (heading + list block, or an
 * empty-state text block) with a rawData payload.
 */

import { buildListResult } from "../src/listActionHandler.js";

function blocks(result: ReturnType<typeof buildListResult>) {
    return (result.displayContent as any).blocks;
}

describe("buildListResult", () => {
    test("non-empty list renders heading + list block", () => {
        const result = buildListResult("shopping", ["milk", "eggs", "bread"]);
        expect(blocks(result)[0]).toMatchObject({
            kind: "heading",
            text: "List 'shopping' — 3 items",
        });
        const list = blocks(result).find((b: any) => b.kind === "list");
        expect(list.items.map((i: any) => i.text)).toEqual([
            "milk",
            "eggs",
            "bread",
        ]);
    });

    test("singular 'item' for a one-element list", () => {
        const result = buildListResult("todo", ["call mom"]);
        expect(blocks(result)[0].text).toBe("List 'todo' — 1 item");
    });

    test("empty list renders an empty-state text block, no list block", () => {
        const result = buildListResult("empty", []);
        expect(blocks(result).some((b: any) => b.kind === "list")).toBe(false);
        expect(blocks(result)[1]).toMatchObject({
            kind: "text",
            text: "This list is empty.",
        });
    });

    test("suffix is appended as a trailing text block", () => {
        const result = buildListResult("shopping", ["milk"], "Anything else?");
        const last = blocks(result)[blocks(result).length - 1];
        expect(last).toMatchObject({ kind: "text", text: "Anything else?" });
    });

    test("rawData carries the list name and items", () => {
        const items = ["milk", "eggs"];
        const raw = (buildListResult("shopping", items).displayContent as any)
            .rawData;
        expect(raw).toMatchObject({ name: "shopping", items });
    });

    test("entities include the list and each item", () => {
        const result = buildListResult("shopping", ["milk", "eggs"]);
        const names = result.entities.map((e) => e.name);
        expect(names).toEqual(
            expect.arrayContaining(["shopping", "milk", "eggs"]),
        );
    });
});
