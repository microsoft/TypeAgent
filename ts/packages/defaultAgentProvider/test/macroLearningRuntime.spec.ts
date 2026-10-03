// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { MacroLearningRuntime } from "@typeagent/copilot-macros";
import {
    createMacroLearningRuntime,
    validateMacroGrammar,
    type MacroLearningQuery,
} from "../src/macroLearningRuntime.js";

const trace: Parameters<MacroLearningRuntime["extract"]>[0] = {
    schemaVersion: 1,
    sessionId: "test",
    cwd: ".",
    prompt: "Read package.json now",
    response: "Done",
    startedAt: "2026-09-30T00:00:00.000Z",
    completedAt: "2026-09-30T00:00:01.000Z",
    toolCalls: [
        {
            toolCallId: "call-1",
            name: "read",
            arguments: { path: "package.json" },
            result: { content: "private-body" },
            status: "completed",
        },
    ],
};

describe("macro learning runtime", () => {
    it("accepts the shared generator's omitted parameters for a zero-input action only", () => {
        const rule = `<Start> = show my agenda -> { actionName: "lookup" };`;
        expect(() =>
            validateMacroGrammar([rule], ["show my agenda"], "lookup", {}),
        ).not.toThrow();
        expect(() =>
            validateMacroGrammar([rule], ["show my agenda"], "lookup", {
                topic: "work",
            }),
        ).toThrow("expected action/inputs");
    });
    it("extracts evidence without sending raw result bodies or executing task tools", async () => {
        const recipe = {
            schemaVersion: 1,
            traceId: "source-1",
            request: trace.prompt,
            toolCallIds: ["call-1"],
            description: "Read a file",
            uncertainties: [],
        };
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(recipe),
        );
        const runtime = createMacroLearningRuntime(query);
        await expect(
            runtime.extract(trace, "source-1", new AbortController().signal),
        ).resolves.toEqual(recipe);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).not.toContain("private-body");
    });

    it("rejects aborted work before requesting a model", async () => {
        const query = jest.fn(async () => "{}");
        const controller = new AbortController();
        controller.abort();
        await expect(
            createMacroLearningRuntime(query).extract(
                trace,
                "source",
                controller.signal,
            ),
        ).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });

    it("checks exact action and inputs, not merely existence of an NFA hit", () => {
        const rule = `<Start> = read $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "package.json",
            }),
        ).not.toThrow();
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "wrong", {
                path: "package.json",
            }),
        ).toThrow("expected action/inputs");
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "stale.json",
            }),
        ).toThrow("expected action/inputs");
    });

    it("rejects a rule that swallows an unsupported extra operation", () => {
        const rule = `<Start> = read $(path:string) -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], ["read package.json"], "lookup", {
                path: "package.json",
            }),
        ).toThrow("unsupported intent");
    });

    it("rejects frozen sample values even when all original requests match", () => {
        const rule = `<Start> = read package.json now -> { actionName: "lookup", parameters: { path: "package.json" } };`;
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "package.json",
            }),
        ).toThrow("did not generalize input 'path'");
    });

    it("changes captured values without requiring identical fixed keywords to change", () => {
        const rule = `<Start> = read file $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], ["read file file now"], "lookup", {
                path: "file",
            }),
        ).not.toThrow();
    });

    it("compares JSON values after worker structured cloning rather than JavaScript prototypes", () => {
        const rule = `<Start> = read $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar(
                [rule],
                [trace.prompt],
                "lookup",
                structuredClone({ path: "package.json" }),
            ),
        ).not.toThrow();
    });
});
