// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    classifyCodingRequest,
    establishCodingAffinity,
    clearCodingAffinity,
    isCodeAgentRequest,
    isGenericFallbackCandidate,
} from "../src/reasoning/codingRouting.js";
import os from "node:os";
import fs from "node:fs";

describe("coding request classification", () => {
    test.each([
        "fix the error in parser.ts",
        "create a README.md for this project",
        "run pnpm test",
        "implement the missing function",
        "refactor this module",
        "review this repository",
        "explain the code in parser.ts",
    ])("routes high-confidence coding request: %s", (request) => {
        expect(classifyCodingRequest(request, false)).toBe("coding");
    });

    test.each([
        "explain a binary tree",
        "write a poem",
        "what is the weather",
        "play some music",
    ])("leaves non-coding request in normal routing: %s", (request) => {
        expect(classifyCodingRequest(request, false)).toBe("notCoding");
    });

    test("uses affinity for related follow-ups without trapping unrelated turns", () => {
        expect(classifyCodingRequest("now add a regression test", true)).toBe(
            "coding",
        );
        expect(classifyCodingRequest("what is the weather", true)).toBe(
            "notCoding",
        );
    });
});

describe("coding affinity lifecycle", () => {
    test("establishes a local affinity and clears it", () => {
        const context = {
            currentOptions: { workingDirectory: os.tmpdir() },
            currentRequestId: { requestId: "local" },
            codingAffinity: undefined,
            codingSessions: new Map(),
        } as any;
        expect(establishCodingAffinity(context)).toBe(
            fs.realpathSync(os.tmpdir()),
        );
        expect(context.codingAffinity).toEqual({
            workingDirectory: fs.realpathSync(os.tmpdir()),
        });
        clearCodingAffinity(context);
        expect(context.codingAffinity).toBeUndefined();
    });

    test("does not inherit server cwd for a remote request", () => {
        const context = {
            currentOptions: undefined,
            currentRequestId: {
                requestId: "remote",
                connectionId: "client",
            },
            codingAffinity: undefined,
            codingSessions: new Map(),
        } as any;
        expect(establishCodingAffinity(context)).toBeUndefined();
        expect(context.codingAffinity).toBeUndefined();
    });

    test("restores the resumable session for the same working directory", () => {
        const workingDirectory = fs.realpathSync(os.tmpdir());
        const context = {
            currentOptions: { workingDirectory },
            currentRequestId: { requestId: "local" },
            codingAffinity: undefined,
            codingSessions: new Map([
                [
                    workingDirectory,
                    { sessionId: "coding-session", lastUsedAt: Date.now() },
                ],
            ]),
        } as any;
        expect(establishCodingAffinity(context)).toBe(workingDirectory);
        expect(context.codingAffinity).toEqual({
            workingDirectory,
            copilotSessionId: "coding-session",
        });
    });
});

describe("post-translation coding eligibility", () => {
    const requestAction = (...actions: any[]) =>
        ({ actions: actions.map((action) => ({ action })) }) as any;

    test.each([
        [{ schemaName: "chat", actionName: "generateResponse" }],
        [
            {
                schemaName: "browser.lookupAndAnswer",
                actionName: "lookupAndAnswerInternet",
            },
        ],
        [{ schemaName: "dispatcher", actionName: "unknown" }],
        [
            {
                schemaName: "dispatcher.reasoning",
                actionName: "reasoningAction",
            },
        ],
    ])("allows a generic fallback candidate", (action) => {
        expect(isGenericFallbackCandidate(requestAction(action))).toBe(true);
    });

    test.each([
        [{ schemaName: "calendar", actionName: "addEvent" }],
        [{ schemaName: "code", actionName: "openFile" }],
        [{ schemaName: "browser", actionName: "openWebPage" }],
    ])("preserves a known domain action", (action) => {
        expect(isGenericFallbackCandidate(requestAction(action))).toBe(false);
    });

    test("recognizes existing code-agent actions without treating them as fallback", () => {
        const action = requestAction({
            schemaName: "code.editor",
            actionName: "format",
        });
        expect(isCodeAgentRequest(action)).toBe(true);
        expect(isGenericFallbackCandidate(action)).toBe(false);
    });
});
