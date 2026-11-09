// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the reasoning ask_user classification helper. The model
 * tags each ask via the schema's `kind` parameter; the helper maps that to
 * the ClientIO `source` string the host uses to route the ask to either the
 * inline chat or the standalone permission queue.
 */

import {
    ASK_USER_KIND_VALUES,
    ASK_USER_SOURCE_REASONING,
    ASK_USER_SOURCE_REASONING_PERMISSION,
    resolveAskUserSource,
} from "../src/reasoning/askUserSource.js";

describe("resolveAskUserSource", () => {
    it('routes "permission" to the standalone permission queue source', () => {
        expect(resolveAskUserSource("permission")).toBe(
            ASK_USER_SOURCE_REASONING_PERMISSION,
        );
    });

    it('routes "question" to the ordinary reasoning source', () => {
        expect(resolveAskUserSource("question")).toBe(
            ASK_USER_SOURCE_REASONING,
        );
    });

    it("defaults absent classification to the ordinary reasoning source", () => {
        // Backward compatibility: old reasoning-model calls that don't yet
        // supply `kind` must keep rendering inline in the chat.
        expect(resolveAskUserSource(undefined)).toBe(ASK_USER_SOURCE_REASONING);
    });

    it("treats unknown or malformed classifications as ordinary questions", () => {
        // Anything other than the exact literal "permission" must fall back
        // to inline so a typo or garbage value can't turn every ask into a
        // modal permission prompt.
        for (const value of [
            null,
            "",
            "PERMISSION",
            " permission",
            "destructive",
            42,
            true,
            {},
            [],
        ]) {
            expect(resolveAskUserSource(value)).toBe(ASK_USER_SOURCE_REASONING);
        }
    });

    it("resolves every declared kind value to a defined source", () => {
        for (const kind of ASK_USER_KIND_VALUES) {
            const source = resolveAskUserSource(kind);
            expect(source).toEqual(expect.any(String));
            expect(source.length).toBeGreaterThan(0);
        }
    });

    it("uses distinct sources for question and permission", () => {
        expect(ASK_USER_SOURCE_REASONING).not.toBe(
            ASK_USER_SOURCE_REASONING_PERMISSION,
        );
    });
});
