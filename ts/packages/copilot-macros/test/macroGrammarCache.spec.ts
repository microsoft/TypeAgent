// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro } from "../src/contracts.js";

const jest = (
    import.meta as ImportMeta & {
        jest: typeof globalThis.jest & {
            unstable_mockModule(name: string, factory: () => unknown): void;
        };
    }
).jest;
const runtime = await import("@typeagent/action-grammar/runtime");
const compile = jest.fn(runtime.compileGrammarToNFA);
jest.unstable_mockModule("@typeagent/action-grammar/runtime", () => ({
    ...runtime,
    compileGrammarToNFA: compile,
}));
const { matchMacroGrammarInputs } = await import(
    "../src/macroAuthoringRuntime.js"
);

function macro(phrase: string): CopilotToolMacro {
    return {
        schemaVersion: 1,
        macroId: "cached",
        version: 1,
        name: "Cached",
        description: "Read fixture",
        state: "approved",
        executionClass: "replayable",
        inputs: [],
        steps: [],
        sourceTraceId: "fixture",
        createdAt: "2026-10-18T00:00:00Z",
        warnings: [],
        learning: {
            authoring: {
                captureId: "fixture",
                taskId: "fixture:root-user",
                tokenId: "fixture-token",
                contextDigest: "a".repeat(64),
            },
            jobId: "fixture",
            cwd: ".",
            mode: "read-only",
            requiresLivePermissions: true,
            grammarRules: [
                `<Start> = ${phrase} -> { actionName: "run_cached_v1" };`,
            ],
            exampleInputs: {},
            requests: [phrase],
        },
    };
}

test("reuses exact grammar source, detects edits and evicts old compilations", () => {
    const original = macro("read fixture");
    expect(matchMacroGrammarInputs(original, "read fixture")).toEqual([{}]);
    expect(
        matchMacroGrammarInputs(structuredClone(original), "read fixture"),
    ).toEqual([{}]);
    expect(compile).toHaveBeenCalledTimes(1);
    const changed = macro("read updated");
    expect(matchMacroGrammarInputs(changed, "read fixture")).toEqual([]);
    expect(matchMacroGrammarInputs(changed, "read updated")).toEqual([{}]);
    expect(compile).toHaveBeenCalledTimes(2);
    for (let ordinal = 0; ordinal < 128; ordinal++) {
        const phrase = `read fixture${ordinal}`;
        expect(matchMacroGrammarInputs(macro(phrase), phrase)).toEqual([{}]);
    }
    const beforeReload = compile.mock.calls.length;
    expect(matchMacroGrammarInputs(original, "read fixture")).toEqual([{}]);
    expect(compile).toHaveBeenCalledTimes(beforeReload + 1);
});

test("failed compilations do not populate the cache", () => {
    const valid = macro("read repaired");
    compile.mockImplementationOnce(() => {
        throw new Error("Injected compiler failure");
    });
    expect(matchMacroGrammarInputs(valid, "read repaired")).toEqual([]);
    expect(matchMacroGrammarInputs(valid, "read repaired")).toEqual([{}]);
});
