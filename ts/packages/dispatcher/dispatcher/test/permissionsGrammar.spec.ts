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
    "permissionsActionSchema.agr",
);

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "permissionsActionSchema.agr",
        fs.readFileSync(grammarPath, "utf-8"),
        errors,
    );
    if (errors.length > 0 || grammar === undefined) {
        throw new Error(
            `Failed to parse permissions grammar: ${errors.join("; ")}`,
        );
    }
    const nfa = compileGrammarToNFA(grammar, "system.permissions");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? (result.actionValue as any) : undefined;
    };
}

describe("system.permissions grammar", () => {
    const match = makeMatcher();

    it.each([
        "allow all permissions for this session",
        "automatically approve all agent permissions in the current session",
        "turn on automatic approval for tool permissions this session",
        "stop asking me to approve permission requests for this session",
    ])("enables approval for phrase %p", (input) => {
        expect(match(input)).toEqual({
            actionName: "setPermissionApproval",
            parameters: { enable: true },
        });
    });

    it.each([
        "stop automatic approval for permissions",
        "ask me to approve tool permissions again",
        "require permission confirmation again",
        "turn on permission confirmation",
    ])("disables approval for phrase %p", (input) => {
        expect(match(input)).toEqual({
            actionName: "setPermissionApproval",
            parameters: { enable: false },
        });
    });

    it.each(["allow all", "approve this", "turn off confirmation"])(
        "does not capture unscoped phrase %p",
        (input) => {
            expect(match(input)).toBeUndefined();
        },
    );
});
