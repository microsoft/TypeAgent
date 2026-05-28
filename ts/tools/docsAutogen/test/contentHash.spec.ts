// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    computeContentHash,
    formatHashComment,
    parseHashComment,
} from "../src/contentHash.js";

describe("computeContentHash", () => {
    it("returns a 64-hex sha256 string", () => {
        const h = computeContentHash({ a: "1", b: "2" });
        expect(h).toMatch(/^[0-9a-f]{64}$/u);
    });
    it("is insensitive to insertion order", () => {
        const h1 = computeContentHash({ a: "1", b: "2", c: "3" });
        const h2 = computeContentHash({ c: "3", a: "1", b: "2" });
        expect(h1).toBe(h2);
    });
    it("changes when any value changes", () => {
        const h1 = computeContentHash({ a: "1" });
        const h2 = computeContentHash({ a: "2" });
        expect(h1).not.toBe(h2);
    });
    it("does NOT collide on swapped key/value pairs", () => {
        // Without separators between key and value, {ab: cd} would hash
        // to the same string as {a: bcd}. The separator-based encoding
        // prevents that collision.
        const h1 = computeContentHash({ ab: "cd" });
        const h2 = computeContentHash({ a: "bcd" });
        expect(h1).not.toBe(h2);
    });
});

describe("formatHashComment / parseHashComment", () => {
    it("round-trips a hash through the comment format", () => {
        const h = "a".repeat(64);
        const comment = formatHashComment(h);
        expect(comment).toBe(`<!-- AUTOGEN:DOCS:HASH:sha256=${h} -->`);
        expect(parseHashComment(comment)).toBe(h);
    });
    it("parses the hash even when surrounded by other content", () => {
        const h = "0123456789abcdef".repeat(4);
        const blob = `prefix\n<!-- AUTOGEN:DOCS:HASH:sha256=${h} -->\nsuffix`;
        expect(parseHashComment(blob)).toBe(h);
    });
    it("returns null for content without a hash comment", () => {
        expect(parseHashComment("nothing here")).toBeNull();
    });
    it("rejects invalid (non-hex / wrong-length) hashes", () => {
        const badLength = "<!-- AUTOGEN:DOCS:HASH:sha256=abc -->";
        const badHex = `<!-- AUTOGEN:DOCS:HASH:sha256=${"z".repeat(64)} -->`;
        expect(parseHashComment(badLength)).toBeNull();
        expect(parseHashComment(badHex)).toBeNull();
    });
});
