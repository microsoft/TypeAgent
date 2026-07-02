// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateStudioServiceToken,
    getStudioServiceTokenPath,
    isValidStudioServiceTokenFormat,
    studioServiceTokenMatches,
} from "../src/runtime/studioServiceAuth.js";

describe("studio service capability token", () => {
    it("generates 64-char lowercase hex tokens that validate", () => {
        const token = generateStudioServiceToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(isValidStudioServiceTokenFormat(token)).toBe(true);
        // Each call is distinct.
        expect(generateStudioServiceToken()).not.toBe(token);
    });

    it("rejects malformed token formats", () => {
        expect(isValidStudioServiceTokenFormat("")).toBe(false);
        expect(isValidStudioServiceTokenFormat("xyz")).toBe(false);
        expect(isValidStudioServiceTokenFormat("A".repeat(64))).toBe(false); // uppercase
        expect(isValidStudioServiceTokenFormat("a".repeat(63))).toBe(false); // too short
        expect(isValidStudioServiceTokenFormat("a".repeat(65))).toBe(false); // too long
    });

    it("matches only the exact token (constant-time, format-guarded)", () => {
        const token = generateStudioServiceToken();
        expect(studioServiceTokenMatches(token, token)).toBe(true);
        expect(studioServiceTokenMatches(undefined, token)).toBe(false);
        expect(studioServiceTokenMatches("b".repeat(64), token)).toBe(false);
        // Malformed presented token never reaches timingSafeEqual (no throw).
        expect(studioServiceTokenMatches("short", token)).toBe(false);
        expect(studioServiceTokenMatches(token, "not-a-token")).toBe(false);
    });

    it("derives a per-port token file path", () => {
        const p1 = getStudioServiceTokenPath(1234);
        const p2 = getStudioServiceTokenPath(5678);
        expect(p1).toContain("service-token-1234.json");
        expect(p2).toContain("service-token-5678.json");
        expect(p1).not.toBe(p2);
    });
});
