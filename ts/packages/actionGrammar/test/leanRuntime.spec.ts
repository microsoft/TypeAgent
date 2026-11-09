// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    compileGrammarToNFA,
    globalEntityRegistry,
    loadGrammarRules,
    matchGrammar,
    matchGrammarWithNFA,
    registerBuiltInEntities,
} from "@typeagent/action-grammar/runtime";
import { execFileSync } from "node:child_process";

describe("lean grammar runtime", () => {
    it("exposes the shared built-in entity converters", () => {
        registerBuiltInEntities();
        expect(
            globalEntityRegistry.getConverter<number>("Cardinal")?.convert("3"),
        ).toBe(3);
        expect(globalEntityRegistry.getConverter<number>("cardinal")).toBe(
            globalEntityRegistry.getConverter<number>("Cardinal"),
        );
    });

    it("matches local grammar through AST and NFA without generation", () => {
        const grammar = loadGrammarRules(
            "fixture.agr",
            '<Start> = read document -> { title: "current" };',
        );
        expect(
            matchGrammar(grammar, "read document").map((match) => match.match),
        ).toEqual([{ title: "current" }]);
        expect(matchGrammar(grammar, "delete document")).toEqual([]);
        const nfa = compileGrammarToNFA(grammar, "fixture.agr");
        expect(
            matchGrammarWithNFA(grammar, nfa, "read document").map(
                (match) => match.match,
            ),
        ).toEqual([{ title: "current" }]);
    });

    it("imports and matches with model/config/dispatcher module access denied", () => {
        const loader = `export async function resolve(specifier, context, next) {
            if (/@typeagent\\/(aiclient|config|dispatcher|agent-server)|@github\\/copilot|@anthropic|dotenv|generation\\/|grammarStore/.test(specifier))
                throw new Error("Forbidden runtime dependency: " + specifier);
            return next(specifier, context);
        }`;
        const script = `
            import { register } from "node:module";
            register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)}, import.meta.url);
            const { loadGrammarRules, matchGrammar, globalEntityRegistry, registerBuiltInEntities } =
                await import("@typeagent/action-grammar/runtime");
            registerBuiltInEntities();
            const grammar = loadGrammarRules("fixture.agr", "<Start> = local match -> true;");
            process.stdout.write(JSON.stringify({
                matches: matchGrammar(grammar, "local match").map(m => m.match),
                cardinal: globalEntityRegistry.getConverter("Cardinal").convert("3"),
            }));
        `;
        const output = execFileSync(
            process.execPath,
            ["--input-type=module", "-e", script],
            {
                cwd: process.cwd(),
                encoding: "utf8",
                timeout: 30_000,
            },
        );
        expect(JSON.parse(output)).toEqual({ matches: [true], cardinal: 3 });
    });
});
