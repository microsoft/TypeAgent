// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for `extractOperationalError`, the shape-detector that lets
 * `executeCodeAction` distinguish a genuine operational failure reported by
 * the coda VS Code extension (a WebSocket `result` that JSON-encodes
 * `{ error: string }`) from a normal success payload, so failures surface as
 * a failed `ActionResult` (via `createActionResultFromError`) instead of a
 * success-shaped `ActionResult` whose display just happens to contain the
 * word "error".
 */

import { extractOperationalError } from "../src/codeActionHandler.js";

describe("extractOperationalError", () => {
    test("detects the single-key { error: string } shape used by handleReadActions' catch-all", () => {
        expect(extractOperationalError(JSON.stringify({ error: "boom" }))).toBe(
            "boom",
        );
    });

    test("returns undefined for non-string results (e.g. already-parsed objects)", () => {
        expect(extractOperationalError({ error: "boom" })).toBeUndefined();
        expect(extractOperationalError(undefined)).toBeUndefined();
        expect(extractOperationalError(42)).toBeUndefined();
    });

    test("returns undefined for non-JSON strings (e.g. the 'OK'/'pong' acks)", () => {
        expect(extractOperationalError("OK")).toBeUndefined();
        expect(extractOperationalError("pong")).toBeUndefined();
    });

    test("returns undefined for JSON arrays and primitives", () => {
        expect(
            extractOperationalError(JSON.stringify(["error"])),
        ).toBeUndefined();
        expect(
            extractOperationalError(JSON.stringify("error")),
        ).toBeUndefined();
        expect(extractOperationalError(JSON.stringify(null))).toBeUndefined();
        expect(extractOperationalError(JSON.stringify(5))).toBeUndefined();
    });

    test("returns undefined for success-shaped JSON objects with unrelated keys", () => {
        // Real success payloads for read actions (e.g. getGitDiff) are
        // multi-key objects — must never be mistaken for an error.
        expect(
            extractOperationalError(
                JSON.stringify({ files: [], truncated: false }),
            ),
        ).toBeUndefined();
    });

    test("returns undefined when 'error' is present alongside other keys", () => {
        // Only the exact single-key { error: string } shape produced by
        // handleReadActions' explicit error returns counts — an object that
        // happens to also carry an "error" field among real success data
        // must not be treated as an operational failure.
        expect(
            extractOperationalError(
                JSON.stringify({ error: "boom", files: [] }),
            ),
        ).toBeUndefined();
    });

    test("returns undefined when 'error' is present but not a string", () => {
        expect(
            extractOperationalError(JSON.stringify({ error: 123 })),
        ).toBeUndefined();
        expect(
            extractOperationalError(JSON.stringify({ error: null })),
        ).toBeUndefined();
    });

    test("detects the JSON-encoded 'Did not handle the action' failure from handleVSCodeActions", () => {
        // The unhandled-action fallback in handleVSCodeActions.ts must encode
        // as { error: string } (not a bare string) so this failure path is
        // classified the same way as every other operational error.
        expect(
            extractOperationalError(
                JSON.stringify({
                    error: 'Did not handle the action: "someUnknownAction"',
                }),
            ),
        ).toBe('Did not handle the action: "someUnknownAction"');
    });
});
