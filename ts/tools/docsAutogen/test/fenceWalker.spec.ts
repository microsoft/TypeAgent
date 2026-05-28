// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseFenceLine, walkLinesWithFences } from "../src/fenceWalker.js";

describe("parseFenceLine", () => {
    it("recognises ``` openers", () => {
        const f = parseFenceLine("```ts");
        expect(f).toEqual({ marker: "`", length: 3, info: "ts" });
    });
    it("recognises ~~~ openers", () => {
        const f = parseFenceLine("~~~json");
        expect(f).toEqual({ marker: "~", length: 3, info: "json" });
    });
    it("recognises long fences (>3 chars)", () => {
        const f = parseFenceLine("`````` shell");
        expect(f).toEqual({ marker: "`", length: 6, info: "shell" });
    });
    it("returns null for non-fence lines", () => {
        expect(parseFenceLine("plain text")).toBeNull();
        expect(parseFenceLine("``")).toBeNull();
        expect(parseFenceLine("~~")).toBeNull();
    });
    it("ignores leading whitespace (markdown allows up to 3 spaces)", () => {
        const f = parseFenceLine("   ```ts");
        expect(f).toEqual({ marker: "`", length: 3, info: "ts" });
    });
});

describe("walkLinesWithFences", () => {
    function collectInside(body: string): string[] {
        const inside: string[] = [];
        walkLinesWithFences(body, (line, _idx, state) => {
            if (state.inFence && !state.isFence) inside.push(line);
        });
        return inside;
    }

    it("tracks plain ``` blocks", () => {
        const body = ["before", "```ts", "x", "y", "```", "after"].join("\n");
        expect(collectInside(body)).toEqual(["x", "y"]);
    });
    it("tracks ~~~ blocks", () => {
        const body = ["before", "~~~md", "x", "~~~", "after"].join("\n");
        expect(collectInside(body)).toEqual(["x"]);
    });
    it("a ~~~ inside a ``` block is NOT a closer", () => {
        const body = [
            "```ts",
            "let s = `~~~`;",
            "~~~",
            "still inside",
            "```",
        ].join("\n");
        expect(collectInside(body)).toEqual([
            "let s = `~~~`;",
            "~~~",
            "still inside",
        ]);
    });
    it("requires a closer of equal-or-greater length", () => {
        const body = ["````md", "x", "```", "still inside", "````"].join("\n");
        // Opener length 4; closer length 3 does NOT close (treated as content).
        expect(collectInside(body)).toEqual(["x", "```", "still inside"]);
    });
    it("flags opener and closer lines via isFence", () => {
        const body = ["```ts", "x", "```"].join("\n");
        const fenceLines: number[] = [];
        walkLinesWithFences(body, (_line, idx, state) => {
            if (state.isFence) fenceLines.push(idx);
        });
        expect(fenceLines).toEqual([0, 2]);
    });
    it("treats an unterminated opener as ongoing fence to EOF", () => {
        const body = ["```ts", "x", "y"].join("\n");
        // Once opened, every subsequent line is inFence; the opener
        // line itself is reported with inFence=false (boundary).
        const states: Array<{
            line: string;
            inFence: boolean;
            isFence: boolean;
        }> = [];
        walkLinesWithFences(body, (line, _idx, state) =>
            states.push({ line, ...state }),
        );
        expect(states).toEqual([
            { line: "```ts", inFence: false, isFence: true },
            { line: "x", inFence: true, isFence: false },
            { line: "y", inFence: true, isFence: false },
        ]);
    });
});
