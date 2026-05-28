// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { asLinkTarget, isUnder, toPosixRelative } from "../src/paths.js";

describe("toPosixRelative", () => {
    it("returns POSIX-style relative paths regardless of platform", () => {
        const base = path.resolve("/repo");
        const file = path.resolve("/repo/ts/packages/foo/src/index.ts");
        expect(toPosixRelative(file, base)).toBe(
            "ts/packages/foo/src/index.ts",
        );
    });
    it("returns '.' for the base itself", () => {
        const base = path.resolve("/repo");
        expect(toPosixRelative(base, base)).toBe("");
    });
});

describe("asLinkTarget", () => {
    it("prefixes ./ to bare relative paths", () => {
        expect(asLinkTarget("src/foo.ts")).toBe("./src/foo.ts");
    });
    it("preserves explicit ./ paths", () => {
        expect(asLinkTarget("./src/foo.ts")).toBe("./src/foo.ts");
    });
    it("preserves explicit ../ paths", () => {
        expect(asLinkTarget("../bar/baz.ts")).toBe("../bar/baz.ts");
    });
    it("rewrites accidental absolute-looking POSIX paths to ./...", () => {
        expect(asLinkTarget("/src/foo.ts")).toBe("./src/foo.ts");
    });
});

describe("isUnder", () => {
    it("returns true for paths inside base", () => {
        expect(isUnder("/repo/ts/packages/foo", "/repo/ts/packages")).toBe(
            true,
        );
    });
    it("returns true when path equals base", () => {
        expect(isUnder("/repo/ts/packages", "/repo/ts/packages")).toBe(true);
    });
    it("returns false for siblings", () => {
        expect(isUnder("/repo/ts/packages2", "/repo/ts/packages")).toBe(false);
    });
    it("returns false for parents", () => {
        expect(isUnder("/repo/ts", "/repo/ts/packages")).toBe(false);
    });
});
