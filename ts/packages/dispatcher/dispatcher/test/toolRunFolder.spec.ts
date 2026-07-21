// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ToolRunFolder } from "../src/reasoning/reasoningLoopBase.js";

// Collect the strings the folder emits so each test can assert on the exact
// sequence of rendered tool-call lines.
function makeFolder(): { folder: ToolRunFolder; emitted: string[] } {
    const emitted: string[] = [];
    const folder = new ToolRunFolder((content) => emitted.push(content));
    return { folder, emitted };
}

describe("ToolRunFolder", () => {
    it("emits a single tool call unchanged (no multiplier)", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        expect(emitted).toEqual([]); // buffered until flushed
        folder.flush();
        expect(emitted).toEqual(["A"]);
    });

    it("folds identical adjacent calls into one xN line", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.tool("A");
        folder.tool("A");
        folder.flush();
        expect(emitted).toEqual(["A x3"]);
    });

    it("keeps duplicate calls separate when a different call splits them", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.tool("B");
        folder.tool("A");
        folder.flush();
        expect(emitted).toEqual(["A", "B", "A"]);
    });

    it("does not merge across a flush (e.g. a thinking block between runs)", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.flush(); // interrupted by a non-tool display
        folder.tool("A");
        folder.flush();
        expect(emitted).toEqual(["A", "A"]);
    });

    it("folds multiple distinct runs independently", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.tool("A");
        folder.tool("B");
        folder.tool("B");
        folder.tool("B");
        folder.flush();
        expect(emitted).toEqual(["A x2", "B x3"]);
    });

    it("emits the prior run immediately when a different call starts", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.tool("A");
        // Switching tools flushes the buffered run without an explicit flush().
        folder.tool("B");
        expect(emitted).toEqual(["A x2"]);
        folder.flush();
        expect(emitted).toEqual(["A x2", "B"]);
    });

    it("treats flush with nothing pending as a no-op", () => {
        const { folder, emitted } = makeFolder();
        folder.flush();
        folder.flush();
        expect(emitted).toEqual([]);
    });

    it("resets the count after each flushed run", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A");
        folder.tool("A");
        folder.flush();
        folder.tool("A");
        folder.flush();
        expect(emitted).toEqual(["A x2", "A"]);
    });
});
