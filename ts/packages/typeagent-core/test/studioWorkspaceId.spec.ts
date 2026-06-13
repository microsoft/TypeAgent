// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import {
    canonicalizeRepoRoot,
    studioWorkspaceKey,
    sameWorkspace,
} from "../src/runtime/studioWorkspaceId.js";

describe("studio workspace identity", () => {
    it("canonicalizes to an absolute, separator-trimmed path", () => {
        const canonical = canonicalizeRepoRoot("some/rel/path/");
        expect(path.isAbsolute(canonical)).toBe(true);
        // No trailing separator (a non-root path).
        expect(/[\\/]$/.test(canonical)).toBe(false);
    });

    it("is stable across equivalent spellings of the same path", () => {
        const a = canonicalizeRepoRoot("/repo/ts");
        const b = canonicalizeRepoRoot("/repo/ts/");
        const c = canonicalizeRepoRoot("/repo/foo/../ts");
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it("treats case per platform (insensitive on win32/darwin)", () => {
        const lower = canonicalizeRepoRoot("/Repo/TS");
        const upper = canonicalizeRepoRoot("/repo/ts");
        if (process.platform === "win32" || process.platform === "darwin") {
            expect(lower).toBe(upper);
        } else {
            expect(lower).not.toBe(upper);
        }
    });

    it("derives a stable 16-hex-char workspace key", () => {
        const key = studioWorkspaceKey("/repo/ts");
        expect(key).toMatch(/^[0-9a-f]{16}$/);
        // Deterministic for the same canonical path.
        expect(studioWorkspaceKey("/repo/ts/")).toBe(key);
        // Different workspaces → different keys.
        expect(studioWorkspaceKey("/repo/other")).not.toBe(key);
    });

    it("sameWorkspace compares canonically", () => {
        expect(sameWorkspace("/repo/ts", "/repo/ts/")).toBe(true);
        expect(sameWorkspace("/repo/ts", "/repo/other")).toBe(false);
    });
});
