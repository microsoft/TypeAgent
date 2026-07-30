// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildActionCommand } from "../src/onboardingDispatcher.js";

// `submitAction` turns a typed onboarding action into an `@action <schema>
// <name> --parameters '<json>'` text command, because the dispatcher exposes
// only a text-command interface. The dispatcher then tokenizes that string and
// JSON.parses the `--parameters` value. The tokenizer treats a bare `'` as the
// token terminator and its `stripQuoteFromToken` does NOT unescape, so any free
// text with an apostrophe (the user's agent description flows through
// `startOnboarding` verbatim) used to truncate the JSON and crash Discovery.
//
// These tests replicate the dispatcher's tokenizer + strip path faithfully and
// assert the payload survives round-trip for arbitrary text.

// Faithful port of parameters.ts `nextToken` single-quote branch: scan from the
// leading quote to the next occurrence not preceded by a backslash.
function tokenizeSingleQuoted(input: string): string {
    const quote = input[0];
    expect(quote).toBe("'");
    let end = 0;
    while (true) {
        end = input.indexOf(quote, end + 1);
        if (end === -1) {
            return input; // unterminated: whole remainder is the token
        }
        if (input[end - 1] !== "\\") {
            return input.substring(0, end + 1);
        }
    }
}

// Faithful port of parameters.ts `stripQuoteFromToken` (no unescape).
function stripQuoteFromToken(term: string): string {
    if (term.length !== 0 && (term[0] === "'" || term[0] === '"')) {
        const lastChar = term[term.length - 1];
        if (term.length === 1 || lastChar !== term[0]) {
            return term.substring(1);
        }
        return term.substring(1, term.length - 1);
    }
    return term;
}

// Recover the parameters object the dispatcher would parse from a built command.
function parseParamsFromCommand(command: string): unknown {
    const marker = "--parameters ";
    const idx = command.indexOf(marker);
    expect(idx).toBeGreaterThanOrEqual(0);
    const rest = command.substring(idx + marker.length);
    const token = tokenizeSingleQuoted(rest);
    const stripped = stripQuoteFromToken(token);
    return JSON.parse(stripped);
}

describe("buildActionCommand parameter serialization", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        [
            "plain text",
            { integrationName: "weather", description: "A weather agent" },
        ],
        [
            "apostrophe in description",
            { description: "Manage the user's calendar" },
        ],
        ["leading apostrophe word", { description: "It's a weather agent" }],
        ["multiple apostrophes", { description: "don't; it's the user's" }],
        ["embedded double quotes", { description: 'He said "hi" to me' }],
        ["backslashes", { path: "C:\\Users\\me\\a'gent" }],
        [
            "url with apostrophe (deterministic fallback)",
            { url: "https://ex.com/o'brien?q=a b" },
        ],
        [
            "nested + numbers + bool",
            { a: { b: "it's", n: 3, ok: true }, list: ["x'y", "z"] },
        ],
        ["newlines and tabs", { description: "line1\nline2\tcol's" }],
    ];

    it.each(cases)("round-trips %s through the tokenizer", (_name, params) => {
        const command = buildActionCommand(
            "onboarding",
            "startOnboarding",
            params,
        );
        expect(parseParamsFromCommand(command)).toEqual(params);
    });

    it("emits no bare single quote inside the payload (tokenizer-safe)", () => {
        const command = buildActionCommand("onboarding", "startOnboarding", {
            description: "It's the user's 'favorite' agent",
        });
        // Strip the wrapping quotes, then assert nothing but the wrappers held a `'`.
        const marker = "--parameters ";
        const payload = command.substring(
            command.indexOf(marker) + marker.length,
        );
        const inner = payload.slice(1, -1); // drop the outer single quotes
        expect(inner.includes("'")).toBe(false);
    });

    it("prefixes the schema and action name", () => {
        const command = buildActionCommand(
            "onboarding.onboarding-discovery",
            "crawlDocUrl",
            { url: "https://example.com" },
        );
        expect(
            command.startsWith(
                "@action onboarding.onboarding-discovery crawlDocUrl --parameters '",
            ),
        ).toBe(true);
    });
});
