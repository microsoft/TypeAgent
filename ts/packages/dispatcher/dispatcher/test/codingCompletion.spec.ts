// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createCodingCompletionTracker,
    isMutatingCodingRequest,
    requiresCodingValidation,
    isValidationToolUse,
    isWriteToolUse,
} from "../src/reasoning/codingCompletion.js";

describe("coding completion evidence", () => {
    test("distinguishes analysis from mutation requests", () => {
        expect(isMutatingCodingRequest("explain parser.ts")).toBe(false);
        expect(isMutatingCodingRequest("fix parser.ts")).toBe(true);
    });

    test("does not require code validation for documentation-only mutations", () => {
        expect(requiresCodingValidation("create README.md")).toBe(false);
        expect(requiresCodingValidation("update the markdown docs")).toBe(
            false,
        );
        expect(requiresCodingValidation("update parser.ts and its docs")).toBe(
            true,
        );
    });

    test.each([
        ["edit", { path: "a.ts" }],
        ["apply_patch", { patch: "..." }],
        ["shell", { command: "Set-Content a.md hello" }],
    ])("recognizes write tool evidence", (name, args) => {
        expect(isWriteToolUse(name as string, args)).toBe(true);
    });

    test.each([
        ["shell", { command: "pnpm test" }],
        ["bash", { command: "npm run build" }],
        ["typecheck", {}],
    ])("recognizes validation tool evidence", (name, args) => {
        expect(isValidationToolUse(name as string, args)).toBe(true);
    });

    test("blocks a mutating task once when writes lack validation", () => {
        const tracker = createCodingCompletionTracker("fix parser.ts");
        tracker.onToolSuccess("edit", { path: "parser.ts" });
        expect(tracker.onAgentStop(false)?.decision).toBe("block");
        expect(tracker.onAgentStop(false)).toBeUndefined();
        expect(tracker.onAgentStop(true)).toBeUndefined();
        expect(tracker.outcome("session-1")).toMatchObject({
            taskKind: "mutation",
            status: "unvalidated",
            filesChanged: true,
            validationSucceeded: false,
        });
    });

    test("accepts a mutating task after successful validation", () => {
        const tracker = createCodingCompletionTracker("update the module");
        tracker.onToolSuccess("edit", { path: "module.ts" });
        tracker.onToolStart("shell", { command: "pnpm test" });
        tracker.onToolSuccess("shell", { command: "pnpm test" });
        expect(tracker.onAgentStop(false)).toBeUndefined();
        expect(tracker.outcome("session-2")).toMatchObject({
            status: "completed",
            validationAttempted: true,
            validationSucceeded: true,
        });
    });

    test("does not require validation for read-only analysis", () => {
        const tracker = createCodingCompletionTracker("review parser.ts");
        expect(tracker.onAgentStop(false)).toBeUndefined();
        expect(tracker.outcome("session-3")).toMatchObject({
            taskKind: "analysis",
            status: "completed",
            filesChanged: false,
        });
    });

    test("does not block documentation-only writes", () => {
        const tracker = createCodingCompletionTracker("create README.md");
        tracker.onToolSuccess("write", { path: "README.md" });
        expect(tracker.onAgentStop(false)).toBeUndefined();
        expect(tracker.outcome("session-4")).toMatchObject({
            taskKind: "mutation",
            validationRequired: false,
            status: "completed",
        });
    });
});
