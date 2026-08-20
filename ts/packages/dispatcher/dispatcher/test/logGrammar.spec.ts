// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "@typeagent/action-grammar";

const grammarPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "context",
    "system",
    "schema",
    "logActionSchema.agr",
);

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "logActionSchema.agr",
        fs.readFileSync(grammarPath, "utf-8"),
        errors,
    );
    if (errors.length > 0 || grammar === undefined) {
        throw new Error(`Failed to parse log grammar: ${errors.join("; ")}`);
    }
    const nfa = compileGrammarToNFA(grammar, "system.log");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? (result.actionValue as any) : undefined;
    };
}

describe("system.log grammar", () => {
    const match = makeMatcher();

    it.each([
        "show local log status",
        "check local telemetry settings",
        "what's the local otel profile",
    ])("maps status phrase %p", (input) => {
        expect(match(input)).toEqual({ actionName: "showLogStatus" });
    });

    it.each([
        ["set local logging profile to focused", "focused"],
        ["use diagnostic profile for local telemetry", "diagnostic"],
        ["switch the local jsonl logs profile to verbose", "verbose"],
        ["turn off local logging", "off"],
        ["enable local telemetry", "focused"],
    ])("maps profile phrase %p", (input, profile) => {
        expect(match(input)).toEqual({
            actionName: "setLogProfile",
            parameters: { profile },
        });
    });

    it.each([
        "reset local logging",
        "clear local telemetry settings",
        "restore the local otel defaults",
    ])("maps reset phrase %p", (input) => {
        expect(match(input)).toEqual({ actionName: "clearLogSettings" });
    });

    it.each(["turn off logging", "show logs", "clear telemetry"])(
        "does not capture unscoped phrase %p",
        (input) => {
            expect(match(input)).toBeUndefined();
        },
    );
});
