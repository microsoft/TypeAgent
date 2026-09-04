// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar contract for the pull request diagnostics rules in
 * github-cliSchema.agr.
 *
 * These phrases sit close to the existing prView ("show PR N") and prChecks
 * ("show checks for PR N") rules, so the point of these tests is that each
 * phrasing lands on the action the user actually meant.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGrammarRules, matchGrammar } from "@typeagent/action-grammar";

function resolveAgrPath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, "../src/github-cliSchema.agr"),
        join(here, "../../src/github-cliSchema.agr"),
    ];
    for (const c of candidates) {
        if (existsSync(c)) {
            return c;
        }
    }
    throw new Error(`github-cliSchema.agr not found from ${here}`);
}

function loadGithubCliGrammar() {
    const source = readFileSync(resolveAgrPath(), "utf8")
        .replace(/^import .*$/m, "")
        .replace(/<Start>\s*:\s*GithubCliActions\s*=/, "<Start> =");
    return loadGrammarRules("github-cliSchema.agr", source);
}

const grammar = loadGithubCliGrammar();

function actions(request: string) {
    return matchGrammar(grammar, request).map(
        (m) => (m as { match: unknown }).match ?? m,
    ) as Array<{
        actionName: string;
        parameters: {
            number?: number;
            repo?: string;
            includePatch?: boolean;
        };
    }>;
}

describe("github-cliSchema.agr — prFiles", () => {
    it.each([
        "show files changed in PR 2196",
        "what files does PR 2196 change",
    ])("%s", (request) => {
        expect(actions(request)[0]).toMatchObject({
            actionName: "prFiles",
            parameters: { number: 2196 },
        });
    });

    it("carries the repository through", () => {
        expect(
            actions("show files changed in PR 42 in microsoft/TypeAgent")[0],
        ).toMatchObject({
            actionName: "prFiles",
            parameters: { number: 42, repo: "microsoft/TypeAgent" },
        });
    });

    it("asking for the diff turns patches on", () => {
        expect(actions("show the diff for PR 42")[0]).toMatchObject({
            actionName: "prFiles",
            parameters: { number: 42, includePatch: true },
        });
    });
});

describe("github-cliSchema.agr — prFailedChecks", () => {
    it.each([
        "show failing checks for PR 2196",
        "why is CI failing on PR 2196",
    ])("%s", (request) => {
        expect(actions(request)[0]).toMatchObject({
            actionName: "prFailedChecks",
            parameters: { number: 2196 },
        });
    });

    it("carries the repository through", () => {
        expect(
            actions("show failing checks for PR 42 in microsoft/TypeAgent")[0],
        ).toMatchObject({
            actionName: "prFailedChecks",
            parameters: { number: 42, repo: "microsoft/TypeAgent" },
        });
    });
});

describe("github-cliSchema.agr — neighbouring rules still win their phrasings", () => {
    it.each([
        ["show PR 42", "prView"],
        ["show checks for PR 42", "prChecks"],
        ["show check runs for PR 42", "prChecks"],
        ["show CI status for PR 42", "prChecks"],
    ])("%s stays %s", (request, expected) => {
        const matched = actions(request);
        expect(matched.length).toBeGreaterThan(0);
        expect(matched[0].actionName).toBe(expected);
        // The diagnostics rules must not have stolen these phrasings.
        expect(
            matched.every(
                (a) =>
                    a.actionName !== "prFiles" &&
                    a.actionName !== "prFailedChecks",
            ),
        ).toBe(true);
    });
});
