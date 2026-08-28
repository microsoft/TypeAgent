// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyBindingUpdateFromView,
    shouldAdoptBindingUpdate,
} from "../src/agent/markdownActionHandler.js";

type Ctx = {
    currentFileName?: string | undefined;
    currentFilePath?: string | undefined;
    currentWorkspaceRoot?: string | undefined;
    currentBindingToken?: string | undefined;
    localHostPort: number;
};

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
    return {
        localHostPort: 0,
        currentFileName: "notes/plan.md",
        currentFilePath: "/root/notes/plan.md",
        currentWorkspaceRoot: "/root",
        currentBindingToken: "T-original",
        ...overrides,
    };
}

describe("shouldAdoptBindingUpdate / applyBindingUpdateFromView", () => {
    test("adopts when boundRoot + boundRelativePath + boundFilePath match agent context", () => {
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/notes/plan.md",
        });
        expect(decision).toEqual({ kind: "adopt", bindingToken: "T-new" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/notes/plan.md",
        });
        expect(ctx.currentBindingToken).toBe("T-new");
    });

    test("rejects (leaves token untouched) when boundRelativePath differs", () => {
        // Simulates the browser switching via /api/switch-document to a
        // different file. The agent still has plan.md active but the view
        // rebound to something else - adopting would let a subsequent
        // apply carry the fresh token and land on the wrong file.
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "other.md",
            boundFilePath: "/root/other.md",
        });
        expect(decision).toEqual({ kind: "reject-path-mismatch" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "other.md",
            boundFilePath: "/root/other.md",
        });
        expect(ctx.currentBindingToken).toBe("T-original");
    });

    test("rejects when boundRoot differs from agent's current workspace root", () => {
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/other-root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/other-root/notes/plan.md",
        });
        expect(decision).toEqual({ kind: "reject-path-mismatch" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/other-root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/other-root/notes/plan.md",
        });
        expect(ctx.currentBindingToken).toBe("T-original");
    });

    test("rejects when boundFilePath differs even if relative path matches", () => {
        // Edge case: view reports the same relative path but an absolute
        // path that doesn't match the agent's currentFilePath. Fail
        // closed to catch a canonicalization mismatch.
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/via-symlink/notes/plan.md",
        });
        expect(decision).toEqual({ kind: "reject-file-mismatch" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/via-symlink/notes/plan.md",
        });
        expect(ctx.currentBindingToken).toBe("T-original");
    });

    test("rejects when agent has no active document yet", () => {
        // A bindingUpdated arriving before create/openDocument has set
        // the agent's currentFileName must NOT be adopted - the agent has
        // nothing to pair the token with, and adopting would let a
        // browser-selected binding silently become the agent's active
        // document.
        const ctx = makeCtx({
            currentFileName: undefined,
            currentFilePath: undefined,
            currentWorkspaceRoot: undefined,
            currentBindingToken: undefined,
        });
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "any.md",
            boundFilePath: "/root/any.md",
        });
        expect(decision).toEqual({ kind: "reject-path-mismatch" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-new",
            boundRoot: "/root",
            boundRelativePath: "any.md",
            boundFilePath: "/root/any.md",
        });
        expect(ctx.currentBindingToken).toBeUndefined();
    });

    test("adopts a rebinding to the same relative path (e.g. our own setFile ack)", () => {
        // Rebinding to the same file rotates the token; the agent must
        // adopt the new token so its subsequent apply carries the freshest
        // value.
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: "T-rotated",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/notes/plan.md",
        });
        expect(decision).toEqual({
            kind: "adopt",
            bindingToken: "T-rotated",
        });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: "T-rotated",
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/notes/plan.md",
        });
        expect(ctx.currentBindingToken).toBe("T-rotated");
    });

    test("clears the token when the view reports memory-only mode", () => {
        // The view emits bindingUpdated with all-null fields when a setFile
        // switches it into memory-only mode. The agent must clear its
        // cached token so a later same-token rebinding cannot silently
        // reattach.
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: null,
            boundRoot: null,
            boundRelativePath: null,
            boundFilePath: null,
        });
        expect(decision).toEqual({ kind: "clear" });

        applyBindingUpdateFromView(ctx as any, {
            type: "bindingUpdated",
            bindingToken: null,
            boundRoot: null,
            boundRelativePath: null,
            boundFilePath: null,
        });
        expect(ctx.currentBindingToken).toBeUndefined();
    });

    test("ignores non-binding messages", () => {
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "somethingElse",
            bindingToken: "T-new",
        });
        expect(decision).toEqual({ kind: "ignore-non-binding" });
        expect(ctx.currentBindingToken).toBe("T-original");
    });

    test("ignores a bindingUpdated with a non-string token", () => {
        const ctx = makeCtx();
        const decision = shouldAdoptBindingUpdate(ctx, {
            type: "bindingUpdated",
            bindingToken: 42,
            boundRoot: "/root",
            boundRelativePath: "notes/plan.md",
            boundFilePath: "/root/notes/plan.md",
        });
        expect(decision).toEqual({ kind: "ignore-missing-fields" });
        expect(ctx.currentBindingToken).toBe("T-original");
    });
});
