// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for gh CLI argument construction — specifically the "unassigned"
 * filter. `gh issue list --assignee <x>` treats <x> as a literal GitHub
 * login, so "--assignee none" fails with "Could not find an assignee with
 * the login 'none'". Unassigned items must instead be filtered with the
 * search qualifier `--search "no:assignee"`.
 */

import { buildArgs } from "../src/github-cliActionHandler.js";
import type { TypeAgentAction } from "@typeagent/agent-sdk";
import type { GithubCliActions } from "../src/github-cliSchema.js";

function action(
    actionName: string,
    parameters: Record<string, unknown>,
): TypeAgentAction<GithubCliActions> {
    return {
        schemaName: "github-cli",
        actionName,
        parameters,
    } as unknown as TypeAgentAction<GithubCliActions>;
}

describe("buildArgs — issueList assignee handling", () => {
    test("maps assignee 'none' to the no:assignee search qualifier", () => {
        const args = buildArgs(
            action("issueList", {
                repo: "microsoft/TypeAgent",
                state: "open",
                assignee: "none",
            }),
        )!;
        expect(args.join(" ")).toContain("--search no:assignee");
        // Must NOT pass the invalid literal login.
        expect(args).not.toContain("--assignee");
        // State filtering still applies alongside the search qualifier.
        expect(args.join(" ")).toContain("--state open");
    });

    test.each(["none", "@none", "unassigned", "nobody", "NONE", " none "])(
        "treats %j as unassigned",
        (value) => {
            const args = buildArgs(
                action("issueList", { repo: "o/r", assignee: value }),
            )!;
            expect(args.join(" ")).toContain("--search no:assignee");
            expect(args).not.toContain("--assignee");
        },
    );

    test("composes state + label filters alongside the unassigned search", () => {
        const args = buildArgs(
            action("issueList", {
                repo: "o/r",
                state: "open",
                label: "bug",
                assignee: "none",
            }),
        )!;
        // gh honors --state and --label together with --search, so all three
        // filters must be present (this is the label+unassigned combination).
        const joined = args.join(" ");
        expect(joined).toContain("--state open");
        expect(joined).toContain("--label bug");
        expect(joined).toContain("--search no:assignee");
        expect(args).not.toContain("--assignee");
    });

    test("passes a real login through as --assignee", () => {
        const args = buildArgs(
            action("issueList", { repo: "o/r", assignee: "octocat" }),
        )!;
        expect(args).toContain("--assignee");
        expect(args).toContain("octocat");
        expect(args.join(" ")).not.toContain("no:assignee");
    });

    test("keeps @me as an --assignee filter", () => {
        const args = buildArgs(
            action("issueList", { repo: "o/r", assignee: "@me" }),
        )!;
        expect(args).toContain("--assignee");
        expect(args).toContain("@me");
        expect(args.join(" ")).not.toContain("no:assignee");
    });

    test("omits assignee filtering entirely when unset", () => {
        const args = buildArgs(
            action("issueList", { repo: "o/r", state: "open" }),
        )!;
        expect(args).not.toContain("--assignee");
        expect(args.join(" ")).not.toContain("no:assignee");
    });
});

describe("buildArgs — prList assignee handling", () => {
    test("maps assignee 'none' to the no:assignee search qualifier", () => {
        const args = buildArgs(
            action("prList", {
                repo: "microsoft/TypeAgent",
                state: "open",
                assignee: "none",
            }),
        )!;
        expect(args.join(" ")).toContain("--search no:assignee");
        expect(args).not.toContain("--assignee");
    });

    test("passes a real login through as --assignee", () => {
        const args = buildArgs(
            action("prList", { repo: "o/r", assignee: "octocat" }),
        )!;
        expect(args).toContain("--assignee");
        expect(args).toContain("octocat");
        expect(args.join(" ")).not.toContain("no:assignee");
    });

    test("composes state + label filters alongside the unassigned search", () => {
        const args = buildArgs(
            action("prList", {
                repo: "o/r",
                state: "open",
                label: "bug",
                assignee: "none",
            }),
        )!;
        const joined = args.join(" ");
        expect(joined).toContain("--state open");
        expect(joined).toContain("--label bug");
        expect(joined).toContain("--search no:assignee");
        expect(args).not.toContain("--assignee");
    });
});
