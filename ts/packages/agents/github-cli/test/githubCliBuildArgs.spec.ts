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

describe('buildArgs — author handling ("my PRs" / "issues I opened")', () => {
    test("maps prList author @me to --author, not --assignee", () => {
        const args = buildArgs(
            action("prList", { state: "open", author: "@me" }),
        )!;
        const joined = args.join(" ");
        expect(joined).toContain("--author @me");
        expect(args).not.toContain("--assignee");
        expect(joined).not.toContain("no:assignee");
    });

    test("composes author and assignee filters together for prList", () => {
        const args = buildArgs(
            action("prList", { author: "@me", assignee: "octocat" }),
        )!;
        const joined = args.join(" ");
        expect(joined).toContain("--author @me");
        expect(joined).toContain("--assignee octocat");
    });

    test("omits --author when unset for prList", () => {
        const args = buildArgs(action("prList", { state: "open" }))!;
        expect(args.join(" ")).not.toContain("--author");
    });

    test("maps issueList author @me to --author", () => {
        const args = buildArgs(
            action("issueList", { repo: "o/r", author: "@me" }),
        )!;
        expect(args.join(" ")).toContain("--author @me");
    });
});

describe("buildArgs — myPullRequests (cross-repo gh search prs)", () => {
    test("searches PRs authored by @me, open by default", () => {
        const args = buildArgs(action("myPullRequests", {}))!;
        const joined = args.join(" ");
        expect(args.slice(0, 2)).toEqual(["search", "prs"]);
        expect(joined).toContain("--author @me");
        expect(joined).toContain("--state open");
        expect(joined).toContain("--limit 20");
        expect(joined).toContain("repository");
    });

    test("honors an explicit state and limit", () => {
        const args = buildArgs(
            action("myPullRequests", { state: "closed", limit: 5 }),
        )!;
        const joined = args.join(" ");
        expect(joined).toContain("--state closed");
        expect(joined).toContain("--limit 5");
    });

    test("scopes to an owner when provided", () => {
        const args = buildArgs(
            action("myPullRequests", { owner: "microsoft" }),
        )!;
        const joined = args.join(" ");
        expect(joined).toContain("--owner microsoft");
    });

    test("omits --owner when unset", () => {
        const args = buildArgs(action("myPullRequests", {}))!;
        expect(args.join(" ")).not.toContain("--owner");
    });
});
