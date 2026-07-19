// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the Phase-5 structured-content result builders in
 * github-cliActionHandler.  Each builder converts a raw `gh` JSON payload
 * into an ActionResultSuccess with a StructuredContent displayContent that
 * contains a heading + table (or keyValue) block.
 *
 * Tests run against compiled dist/ (jest-esm, same pattern as the rest of
 * this package's tests).
 */

import {
    buildStructuredListResult,
    buildStructuredRepoView,
    buildStructuredDependabotResult,
    buildStructuredContributorsResult,
    buildStructuredPrView,
    buildStructuredIssueView,
    buildStructuredField,
} from "../src/github-cliActionHandler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function heading(result: ReturnType<typeof buildStructuredListResult>) {
    const content = result?.displayContent as any;
    return content?.blocks?.[0];
}

function table(result: ReturnType<typeof buildStructuredListResult>) {
    const content = result?.displayContent as any;
    return content?.blocks?.[1];
}

function kvBlock(result: ReturnType<typeof buildStructuredRepoView>) {
    const content = result?.displayContent as any;
    return content?.blocks?.[1];
}

// ---------------------------------------------------------------------------
// buildStructuredListResult — prList
// ---------------------------------------------------------------------------

describe("buildStructuredListResult — prList", () => {
    const prs = [
        {
            number: 42,
            title: "Fix the bug",
            state: "OPEN",
            isDraft: false,
            headRefName: "fix/the-bug",
            url: "https://github.com/owner/repo/pull/42",
            createdAt: "2026-01-15T10:00:00Z",
        },
        {
            number: 99,
            title: "Draft feature",
            state: "OPEN",
            isDraft: true,
            headRefName: "feat/draft",
            url: "https://github.com/owner/repo/pull/99",
            createdAt: "2026-02-01T08:30:00Z",
        },
    ];

    test("returns an ActionResultSuccess for prList", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        expect(result).toBeDefined();
    });

    test("heading block has correct text with count", () => {
        const result = buildStructuredListResult(prs, "prList", "pr list");
        expect(heading(result)).toMatchObject({
            kind: "heading",
            level: 3,
            text: "pr list — 2 results",
        });
    });

    test("table block has expected columns", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const t = table(result);
        expect(t.kind).toBe("table");
        expect(t.columns.map((c: any) => c.id)).toEqual([
            "number",
            "title",
            "state",
            "branch",
            "created",
        ]);
    });

    test("open PR has info badge", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const t = table(result);
        const stateCell = t.rows[0][2]; // first row, state column
        expect(stateCell).toMatchObject({ badge: "info" });
    });

    test("draft PR has warning badge", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const t = table(result);
        const stateCell = t.rows[1][2]; // second row, state column
        expect(stateCell).toMatchObject({ badge: "warning", text: "Draft" });
    });

    test("number cell contains link", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const t = table(result);
        const numCell = t.rows[0][0];
        expect(numCell).toMatchObject({
            text: "42",
            href: "https://github.com/owner/repo/pull/42",
        });
    });

    test("table is sortable", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        expect(table(result).sortable).toBe(true);
    });

    test("rawData is set on displayContent", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        expect((result?.displayContent as any)?.rawData).toBe(prs);
    });

    test("alternates include markdown and text", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const content = result?.displayContent as any;
        const types = content?.alternates?.map((a: any) => a.type);
        expect(types).toContain("markdown");
        expect(types).toContain("text");
    });

    test("markdown alternate contains heading and table headers", () => {
        const result = buildStructuredListResult(prs, "prList", "prList");
        const content = result?.displayContent as any;
        const mdAlt = content?.alternates?.find(
            (a: any) => a.type === "markdown",
        );
        expect(mdAlt?.content).toContain("prList — 2 results");
        expect(mdAlt?.content).toContain("| # |");
    });
});

// ---------------------------------------------------------------------------
// buildStructuredListResult — issueList
// ---------------------------------------------------------------------------

describe("buildStructuredListResult — issueList", () => {
    const issues = [
        {
            number: 7,
            title: "Memory leak",
            state: "OPEN",
            url: "https://github.com/o/r/issues/7",
            createdAt: "2026-03-01T12:00:00Z",
            labels: [{ name: "bug" }, { name: "performance" }],
        },
    ];

    test("returns structured result for issueList", () => {
        const result = buildStructuredListResult(
            issues,
            "issueList",
            "issueList",
        );
        expect(result).toBeDefined();
        expect(table(result).kind).toBe("table");
    });

    test("labels cell joins label names", () => {
        const result = buildStructuredListResult(
            issues,
            "issueList",
            "issueList",
        );
        const t = table(result);
        const labelsColIdx = t.columns.findIndex((c: any) => c.id === "labels");
        const labelsCell = t.rows[0][labelsColIdx];
        expect(labelsCell).toContain("bug");
        expect(labelsCell).toContain("performance");
    });

    test("open issue gets info badge", () => {
        const result = buildStructuredListResult(
            issues,
            "issueList",
            "issueList",
        );
        const t = table(result);
        const stateIdx = t.columns.findIndex((c: any) => c.id === "state");
        expect(t.rows[0][stateIdx]).toMatchObject({ badge: "info" });
    });
});

// ---------------------------------------------------------------------------
// buildStructuredListResult — empty result
// ---------------------------------------------------------------------------

describe("buildStructuredListResult — empty array", () => {
    test("returns a result with heading and 'no results' text", () => {
        const result = buildStructuredListResult([], "prList", "PR list");
        expect(result).toBeDefined();
        const content = result?.displayContent as any;
        expect(content.blocks[0]).toMatchObject({
            kind: "heading",
            text: "PR list — 0 results",
        });
        expect(content.blocks[1]).toMatchObject({
            kind: "text",
            text: "No results found.",
        });
    });
});

// ---------------------------------------------------------------------------
// buildStructuredListResult — unknown action returns undefined
// ---------------------------------------------------------------------------

describe("buildStructuredListResult — unknown action", () => {
    test("returns undefined for unrecognised actionName", () => {
        const result = buildStructuredListResult(
            [{ foo: "bar" }],
            "unknownAction",
            "label",
        );
        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// buildStructuredListResult — searchRepos
// ---------------------------------------------------------------------------

describe("buildStructuredListResult — searchRepos", () => {
    const repos = [
        {
            fullName: "microsoft/TypeAgent",
            description: "AI agent framework",
            stargazersCount: 1200,
            url: "https://github.com/microsoft/TypeAgent",
            updatedAt: "2026-06-01T00:00:00Z",
        },
    ];

    test("returns structured result for searchRepos", () => {
        const result = buildStructuredListResult(
            repos,
            "searchRepos",
            "search",
        );
        expect(result).toBeDefined();
    });

    test("name cell links to repo url", () => {
        const result = buildStructuredListResult(
            repos,
            "searchRepos",
            "search",
        );
        const t = table(result);
        const nameIdx = t.columns.findIndex((c: any) => c.id === "name");
        expect(t.rows[0][nameIdx]).toMatchObject({
            text: "microsoft/TypeAgent",
            href: "https://github.com/microsoft/TypeAgent",
        });
    });

    test("stars are formatted as number column", () => {
        const result = buildStructuredListResult(
            repos,
            "searchRepos",
            "search",
        );
        const t = table(result);
        const starsIdx = t.columns.findIndex((c: any) => c.id === "stars");
        expect(t.columns[starsIdx].type).toBe("number");
        expect(t.rows[0][starsIdx]).toBe("1200");
    });

    test("zero stars renders as '0' not empty", () => {
        const zeroStarRepo = [{ ...repos[0], stargazersCount: 0 }];
        const result = buildStructuredListResult(
            zeroStarRepo,
            "searchRepos",
            "search",
        );
        const t = table(result);
        const starsIdx = t.columns.findIndex((c: any) => c.id === "stars");
        expect(t.rows[0][starsIdx]).toBe("0");
    });
});

// ---------------------------------------------------------------------------
// buildStructuredRepoView
// ---------------------------------------------------------------------------

describe("buildStructuredRepoView", () => {
    const repoData = {
        name: "TypeAgent",
        owner: { login: "microsoft" },
        description: "Intelligent agents framework",
        stargazerCount: 450,
        forkCount: 30,
        visibility: "public",
        url: "https://github.com/microsoft/TypeAgent",
        primaryLanguage: { name: "TypeScript" },
        watchers: { totalCount: 12 },
        defaultBranchRef: { name: "main" },
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
    };

    test("returns a defined result", () => {
        const result = buildStructuredRepoView(repoData, "repo view");
        expect(result).toBeDefined();
    });

    test("heading block has label", () => {
        const result = buildStructuredRepoView(repoData, "TypeAgent repo");
        expect(heading(result as any)).toMatchObject({
            kind: "heading",
            text: "TypeAgent repo",
        });
    });

    test("keyValue block has repo name as link", () => {
        const result = buildStructuredRepoView(repoData, "label");
        const kv = kvBlock(result);
        expect(kv.kind).toBe("keyValue");
        const repoPair = kv.pairs.find((p: any) => p.label === "Repository");
        expect(repoPair?.value).toMatchObject({
            text: "microsoft/TypeAgent",
            href: "https://github.com/microsoft/TypeAgent",
        });
    });

    test("rawData is the original repoData object", () => {
        const result = buildStructuredRepoView(repoData, "label");
        expect((result.displayContent as any).rawData).toBe(repoData);
    });

    test("alternates include markdown", () => {
        const result = buildStructuredRepoView(repoData, "label");
        const content = result.displayContent as any;
        const types = content?.alternates?.map((a: any) => a.type);
        expect(types).toContain("markdown");
    });
});

// ---------------------------------------------------------------------------
// buildStructuredDependabotResult
// ---------------------------------------------------------------------------

describe("buildStructuredDependabotResult", () => {
    const alerts = [
        {
            security_advisory: { severity: "HIGH", summary: "ReDoS in foo" },
            dependency: { package: { name: "foo" } },
            html_url: "https://github.com/advisor/GHSA-test",
        },
        {
            security_advisory: { severity: "MEDIUM", summary: "SSRF in bar" },
            dependency: { package: { name: "bar" } },
            html_url: "https://github.com/advisor/GHSA-test2",
        },
    ];

    test("returns defined result", () => {
        expect(buildStructuredDependabotResult(alerts)).toBeDefined();
    });

    test("heading reflects alert count", () => {
        const result = buildStructuredDependabotResult(alerts);
        expect(heading(result as any).text).toContain("2 Dependabot alerts");
    });

    test("severity column uses badge type", () => {
        const result = buildStructuredDependabotResult(alerts);
        const t = table(result as any);
        const sevIdx = t.columns.findIndex((c: any) => c.id === "severity");
        expect(t.columns[sevIdx].type).toBe("badge");
        expect(t.rows[0][sevIdx]).toMatchObject({ badge: "error" }); // HIGH
        expect(t.rows[1][sevIdx]).toMatchObject({ badge: "warning" }); // MEDIUM
    });

    test("advisory cell links to html_url", () => {
        const result = buildStructuredDependabotResult(alerts);
        const t = table(result as any);
        const advIdx = t.columns.findIndex((c: any) => c.id === "advisory");
        expect(t.rows[0][advIdx]).toMatchObject({
            text: "ReDoS in foo",
            href: "https://github.com/advisor/GHSA-test",
        });
    });
});

// ---------------------------------------------------------------------------
// buildStructuredContributorsResult
// ---------------------------------------------------------------------------

describe("buildStructuredContributorsResult", () => {
    const contributors = [
        { login: "alice", contributions: 500 },
        { login: "bob", contributions: 200 },
    ];

    test("returns defined result", () => {
        expect(buildStructuredContributorsResult(contributors)).toBeDefined();
    });

    test("heading for multiple contributors says 'Top N contributors'", () => {
        const result = buildStructuredContributorsResult(contributors);
        expect(heading(result as any).text).toBe("Top 2 contributors");
    });

    test("heading for single contributor", () => {
        const result = buildStructuredContributorsResult([
            { login: "alice", contributions: 500 },
        ]);
        expect(heading(result as any).text).toBe("Top contributor");
    });

    test("rank column assigns 1-based index", () => {
        const result = buildStructuredContributorsResult(contributors);
        const t = table(result as any);
        const rankIdx = t.columns.findIndex((c: any) => c.id === "rank");
        expect(t.rows[0][rankIdx]).toBe("1");
        expect(t.rows[1][rankIdx]).toBe("2");
    });

    test("login cell links to github profile", () => {
        const result = buildStructuredContributorsResult(contributors);
        const t = table(result as any);
        const loginIdx = t.columns.findIndex((c: any) => c.id === "login");
        expect(t.rows[0][loginIdx]).toMatchObject({
            text: "alice",
            href: "https://github.com/alice",
        });
    });

    test("table is sortable", () => {
        const result = buildStructuredContributorsResult(contributors);
        expect(table(result as any).sortable).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildStructuredPrView
// ---------------------------------------------------------------------------

describe("buildStructuredPrView", () => {
    const pr = {
        number: 7,
        title: "Add feature",
        state: "OPEN",
        isDraft: false,
        author: { login: "alice" },
        headRefName: "feat/x",
        baseRefName: "main",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        createdAt: "2026-01-01T00:00:00Z",
        url: "https://github.com/owner/repo/pull/7",
        body: "Some description",
    };

    test("heading shows number and title", () => {
        const result = buildStructuredPrView(pr);
        expect(heading(result as any)).toMatchObject({
            kind: "heading",
            text: "#7 Add feature",
        });
    });

    test("state pair is a badge", () => {
        const result = buildStructuredPrView(pr);
        const kv = kvBlock(result);
        const statePair = kv.pairs.find((p: any) => p.label === "State");
        expect(statePair?.value).toMatchObject({ badge: "info" });
    });

    test("draft PR uses warning badge and Draft label", () => {
        const result = buildStructuredPrView({ ...pr, isDraft: true });
        const kv = kvBlock(result);
        const statePair = kv.pairs.find((p: any) => p.label === "State");
        expect(statePair?.value).toMatchObject({
            text: "Draft",
            badge: "warning",
        });
    });

    test("body becomes a divider + text block", () => {
        const result = buildStructuredPrView(pr);
        const blocks = (result.displayContent as any).blocks;
        expect(blocks.some((b: any) => b.kind === "divider")).toBe(true);
        expect(blocks[blocks.length - 1]).toMatchObject({
            kind: "text",
            text: "Some description",
        });
    });

    test("rawData is the original object", () => {
        const result = buildStructuredPrView(pr);
        expect((result.displayContent as any).rawData).toBe(pr);
    });
});

// ---------------------------------------------------------------------------
// buildStructuredIssueView
// ---------------------------------------------------------------------------

describe("buildStructuredIssueView", () => {
    const issue = {
        number: 12,
        title: "A bug",
        state: "OPEN",
        author: { login: "bob" },
        labels: [{ name: "bug" }, { name: "p1" }],
        assignees: [{ login: "carol" }],
        comments: [{}, {}],
        createdAt: "2026-01-01T00:00:00Z",
        url: "https://github.com/owner/repo/issues/12",
        body: "Repro steps",
    };

    test("heading shows number and title", () => {
        const result = buildStructuredIssueView(issue);
        expect(heading(result as any).text).toBe("#12 A bug");
    });

    test("state pair uses issue badge", () => {
        const result = buildStructuredIssueView(issue);
        const kv = kvBlock(result);
        const statePair = kv.pairs.find((p: any) => p.label === "State");
        expect(statePair?.value).toMatchObject({ badge: "info" });
    });

    test("labels joined and comment count numeric", () => {
        const result = buildStructuredIssueView(issue);
        const kv = kvBlock(result);
        expect(kv.pairs.find((p: any) => p.label === "Labels")?.value).toBe(
            "bug, p1",
        );
        expect(kv.pairs.find((p: any) => p.label === "Comments")?.value).toBe(
            2,
        );
    });

    test("rawData is the original object", () => {
        const result = buildStructuredIssueView(issue);
        expect((result.displayContent as any).rawData).toBe(issue);
    });
});

// ---------------------------------------------------------------------------
// buildStructuredField
// ---------------------------------------------------------------------------

describe("buildStructuredField", () => {
    const repoData = {
        name: "TypeAgent",
        owner: { login: "microsoft" },
        stargazerCount: 450,
        forkCount: 30,
        primaryLanguage: { name: "TypeScript" },
        description: "Agents framework",
    };

    test("returns undefined for unknown field", () => {
        expect(
            buildStructuredField("nonsense", repoData, "microsoft/TypeAgent"),
        ).toBeUndefined();
    });

    test("stars field yields keyValue pair with numeric value", () => {
        const result = buildStructuredField(
            "stars",
            repoData,
            "microsoft/TypeAgent",
        )!;
        const kv = kvBlock(result);
        const pair = kv.pairs[0];
        expect(pair).toMatchObject({ label: "Stars", value: 450 });
    });

    test("rawData carries repo, field and value", () => {
        const result = buildStructuredField(
            "stars",
            repoData,
            "microsoft/TypeAgent",
        )!;
        expect((result.displayContent as any).rawData).toMatchObject({
            repo: "microsoft/TypeAgent",
            field: "stars",
            value: 450,
        });
    });
});
