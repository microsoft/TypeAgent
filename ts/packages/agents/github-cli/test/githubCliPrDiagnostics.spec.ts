// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the read-only pull request diagnostics actions (`prFiles` and
 * `prFailedChecks`).
 *
 * Everything here drives the real orchestrators through a fake `GhRunner`, so
 * the gh argument construction, JSON parsing, output bounds, and error paths
 * are all covered without touching the network.
 */

import type {
    ActionResult,
    ActionResultSuccess,
    StructuredBlock,
} from "@typeagent/agent-sdk";
import {
    GhResult,
    GhRunner,
    PrFailedChecksData,
    PrFilesData,
    buildAnnotationsArgs,
    buildFileEntries,
    buildPrChecksArgs,
    buildPrFilesArgs,
    buildPrViewArgs,
    clampCount,
    countBuckets,
    describeGhFailure,
    ghFailureHint,
    normalizeRepoParam,
    parseCheckRunRef,
    parsePrUrl,
    runPrFailedChecks,
    runPrFiles,
    selectAnnotations,
    selectFailedChecks,
    truncatePatch,
} from "../src/prDiagnostics.js";

// ── fake gh ──────────────────────────────────────────────────────────────────

function ok(stdout: string): GhResult {
    return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): GhResult {
    return { stdout: "", stderr, exitCode };
}

// A gh runner backed by a list of matcher/response pairs. Records every
// invocation so tests can assert on the exact gh commands that ran.
function fakeGh(
    responses: Array<{ match: (args: string[]) => boolean; res: GhResult }>,
): GhRunner & { calls: string[][] } {
    const calls: string[][] = [];
    const runner = async (args: string[]): Promise<GhResult> => {
        calls.push(args);
        const hit = responses.find((r) => r.match(args));
        if (hit === undefined) {
            throw new Error(`unexpected gh invocation: gh ${args.join(" ")}`);
        }
        return hit.res;
    };
    return Object.assign(runner, { calls });
}

const isPrView = (a: string[]) => a[0] === "pr" && a[1] === "view";
const isPrChecks = (a: string[]) => a[0] === "pr" && a[1] === "checks";
const isFilesApi = (a: string[]) =>
    a[0] === "api" && a[3].includes("/pulls/") && a[3].includes("/files");
const isAnnotationsApi = (a: string[]) =>
    a[0] === "api" && a[3].includes("/annotations");
// `per_page=100` contains "page=1", so page matching has to be anchored.
const onPage = (n: number) => (a: string[]) => a[3].endsWith(`&page=${n}`);

const PR_VIEW_JSON = JSON.stringify({
    number: 42,
    title: "Add widget",
    url: "https://github.com/microsoft/TypeAgent/pull/42",
    state: "OPEN",
    isDraft: false,
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    headRefName: "feature",
    baseRefName: "main",
    headRepository: { name: "TypeAgent", nameWithOwner: "microsoft/TypeAgent" },
    headRepositoryOwner: { login: "microsoft" },
});

function successOf(result: ActionResult): ActionResultSuccess {
    const err = errorOf(result);
    if (err !== undefined) {
        throw new Error(`expected a successful result, got: ${err}`);
    }
    return result as ActionResultSuccess;
}

function errorOf(result: ActionResult): string | undefined {
    return (result as { error?: string }).error;
}

function rawData<T>(result: ActionResult): T {
    return (successOf(result).displayContent as { rawData: T }).rawData;
}

function blocks(result: ActionResult): StructuredBlock[] {
    return (successOf(result).displayContent as { blocks: StructuredBlock[] })
        .blocks;
}

function markdown(result: ActionResult): string {
    const alternates = (
        successOf(result).displayContent as {
            alternates: Array<{ type: string; content: string }>;
        }
    ).alternates;
    return alternates.find((a) => a.type === "markdown")!.content;
}

// ── bounds ───────────────────────────────────────────────────────────────────

describe("clampCount", () => {
    test("falls back when the value is missing or not a number", () => {
        expect(clampCount(undefined, 50, 300)).toBe(50);
        expect(clampCount(Number.NaN, 50, 300)).toBe(50);
        expect(clampCount(Number.POSITIVE_INFINITY, 50, 300)).toBe(50);
    });

    test("clamps to [1, max] and floors fractions", () => {
        expect(clampCount(0, 50, 300)).toBe(1);
        expect(clampCount(-7, 50, 300)).toBe(1);
        expect(clampCount(9999, 50, 300)).toBe(300);
        expect(clampCount(12.9, 50, 300)).toBe(12);
    });
});

// ── URL parsing ──────────────────────────────────────────────────────────────

describe("parsePrUrl", () => {
    test("extracts the base repository, including on GitHub Enterprise", () => {
        expect(
            parsePrUrl("https://github.com/microsoft/TypeAgent/pull/42"),
        ).toEqual({
            host: "github.com",
            owner: "microsoft",
            repo: "TypeAgent",
        });
        expect(parsePrUrl("https://ghe.example.com/org/repo/pull/7")).toEqual({
            host: "ghe.example.com",
            owner: "org",
            repo: "repo",
        });
    });

    test("rejects anything that is not a pull request URL", () => {
        expect(parsePrUrl("")).toBeUndefined();
        expect(
            parsePrUrl("https://github.com/microsoft/TypeAgent/issues/42"),
        ).toBeUndefined();
    });
});

describe("normalizeRepoParam", () => {
    test("reduces a pull request link to something gh --repo accepts", () => {
        // gh rejects a URL pointing inside a repo ("invalid path: ..."), but a
        // PR link is the most natural way to name someone else's PR.
        expect(
            normalizeRepoParam(
                "https://github.com/microsoft/TypeAgent/pull/2974",
            ),
        ).toBe("github.com/microsoft/TypeAgent");
        expect(
            normalizeRepoParam(
                "https://github.com/microsoft/TypeAgent/pull/2974/files#diff-abc",
            ),
        ).toBe("github.com/microsoft/TypeAgent");
    });

    test("keeps the host so GitHub Enterprise links stay on their host", () => {
        expect(
            normalizeRepoParam("https://ghe.contoso.com/team/app/pull/7"),
        ).toBe("ghe.contoso.com/team/app");
    });

    test("normalizes plain repository and clone URLs too", () => {
        expect(
            normalizeRepoParam("https://github.com/microsoft/TypeAgent"),
        ).toBe("github.com/microsoft/TypeAgent");
        expect(
            normalizeRepoParam("https://github.com/microsoft/TypeAgent.git"),
        ).toBe("github.com/microsoft/TypeAgent");
    });

    test("passes through the forms gh already understands", () => {
        expect(normalizeRepoParam("microsoft/TypeAgent")).toBe(
            "microsoft/TypeAgent",
        );
        expect(normalizeRepoParam("github.com/microsoft/TypeAgent")).toBe(
            "github.com/microsoft/TypeAgent",
        );
        // A bare word is resolved by the shared repo validation, not here.
        expect(normalizeRepoParam("TypeAgent")).toBe("TypeAgent");
        expect(normalizeRepoParam(undefined)).toBeUndefined();
        expect(normalizeRepoParam("")).toBe("");
    });
});

describe("parseCheckRunRef", () => {
    test("reads the check run id from a GitHub Actions job link", () => {
        // For GitHub Actions the job id is also the check run id.
        expect(
            parseCheckRunRef(
                "https://github.com/microsoft/TypeAgent/actions/runs/123/job/100784451953",
            ),
        ).toEqual({
            host: "github.com",
            owner: "microsoft",
            repo: "TypeAgent",
            checkRunId: "100784451953",
        });
    });

    test("reads the check run id from a bare check run link", () => {
        expect(
            parseCheckRunRef("https://github.com/microsoft/TypeAgent/runs/999"),
        ).toEqual({
            host: "github.com",
            owner: "microsoft",
            repo: "TypeAgent",
            checkRunId: "999",
        });
    });

    test("returns undefined for links that carry no check run", () => {
        // Third-party CI.
        expect(
            parseCheckRunRef("https://dev.azure.com/org/proj/_build/results"),
        ).toBeUndefined();
        // A GitHub App page — "apps" must not be mistaken for an owner.
        expect(
            parseCheckRunRef(
                "https://github.com/apps/microsoft-github-policy-service",
            ),
        ).toBeUndefined();
        expect(parseCheckRunRef(undefined)).toBeUndefined();
    });
});

// ── argument construction ────────────────────────────────────────────────────

describe("gh argument construction", () => {
    test("pr view requests every field the results depend on", () => {
        const args = buildPrViewArgs(42, "microsoft/TypeAgent");
        expect(args.slice(0, 5)).toEqual([
            "pr",
            "view",
            "42",
            "--repo",
            "microsoft/TypeAgent",
        ]);
        const fields = args[args.indexOf("--json") + 1].split(",");
        expect(fields).toEqual(
            expect.arrayContaining([
                "url",
                "changedFiles",
                "additions",
                "deletions",
                "isDraft",
                "headRepository",
            ]),
        );
    });

    test("omits --repo when the caller did not name a repository", () => {
        expect(buildPrViewArgs(42)).not.toContain("--repo");
        expect(buildPrChecksArgs(42)).not.toContain("--repo");
    });

    test("pr checks requests link and timing fields", () => {
        const fields =
            buildPrChecksArgs(42)[buildPrChecksArgs(42).indexOf("--json") + 1];
        expect(fields.split(",")).toEqual(
            expect.arrayContaining([
                "bucket",
                "name",
                "link",
                "startedAt",
                "completedAt",
            ]),
        );
    });

    test("api calls pin the host so enterprise pull requests resolve", () => {
        const ref = { host: "ghe.example.com", owner: "org", repo: "repo" };
        expect(buildPrFilesArgs(ref, 7, 2, 100, true)).toEqual([
            "api",
            "--hostname",
            "ghe.example.com",
            "repos/org/repo/pulls/7/files?per_page=100&page=2",
        ]);
        expect(buildAnnotationsArgs({ ...ref, checkRunId: "55" }, 3)).toEqual([
            "api",
            "--hostname",
            "ghe.example.com",
            "repos/org/repo/check-runs/55/annotations?per_page=100&page=3",
        ]);
    });

    test("projects patches away with --jq when they were not requested", () => {
        const ref = { host: "github.com", owner: "org", repo: "repo" };
        const args = buildPrFilesArgs(ref, 7, 1, 100, false);
        const jq = args[args.indexOf("--jq") + 1];
        expect(args).toContain("--jq");
        expect(jq).toContain("filename");
        expect(jq).not.toContain("patch");
        // Requesting patches must not filter them out again.
        expect(buildPrFilesArgs(ref, 7, 1, 100, true)).not.toContain("--jq");
    });
});

// ── patch bounding ───────────────────────────────────────────────────────────

describe("truncatePatch", () => {
    test("keeps the head of the patch, where the hunk header lives", () => {
        const patch = ["@@ -1,3 +1,4 @@", "a", "b", "c", "d"].join("\n");
        const { text, keptLines, omittedLines, omittedChars } = truncatePatch(
            patch,
            2,
            10_000,
        );
        expect(text).toBe("@@ -1,3 +1,4 @@\na");
        expect(keptLines).toBe(2);
        expect(omittedLines).toBe(3);
        expect(omittedChars).toBe(0);
    });

    test("passes short patches through untouched", () => {
        const patch = "@@ -1 +1 @@\n-a\n+b";
        expect(truncatePatch(patch, 40, 10_000)).toEqual({
            text: patch,
            keptLines: 3,
            omittedLines: 0,
            omittedChars: 0,
        });
    });

    test("cuts on a line boundary when the character budget runs out first", () => {
        const patch = ["@@", "aaaa", "bbbb", "cccc"].join("\n");
        const { text, keptLines, omittedLines, omittedChars } = truncatePatch(
            patch,
            40,
            12,
        );
        expect(text).toBe("@@\naaaa");
        expect(keptLines).toBe(2);
        expect(omittedLines).toBe(2);
        expect(omittedChars).toBe(patch.length - text.length);
    });

    test("bounds a single line longer than the whole budget", () => {
        // A minified or generated file passes any line-based cap while still
        // carrying megabytes, so the character cap has to be the real bound.
        const patch = `@@\n${"x".repeat(500_000)}`;
        const { text, keptLines, omittedLines, omittedChars } = truncatePatch(
            patch,
            40,
            100,
        );
        // Cut mid-line rather than falling back to the "@@" header alone.
        expect(text).toHaveLength(100);
        expect(text.startsWith("@@\nxxx")).toBe(true);
        // Only the header line is shown in full.
        expect(keptLines).toBe(1);
        expect(omittedLines).toBe(1);
        expect(omittedChars).toBeGreaterThan(400_000);
    });
});

describe("buildFileEntries", () => {
    const raw = [
        {
            filename: "src/a.ts",
            status: "modified",
            additions: 5,
            deletions: 2,
            changes: 7,
            patch: "@@\n1\n2\n3\n4",
        },
        {
            filename: "src/new.ts",
            previous_filename: "src/old.ts",
            status: "renamed",
            additions: 0,
            deletions: 0,
            changes: 0,
            patch: "@@\nx",
        },
        {
            filename: "assets/logo.png",
            status: "modified",
            additions: 0,
            deletions: 0,
            changes: 0,
        },
    ];

    test("omits patches entirely unless the caller asked for them", () => {
        const entries = buildFileEntries(raw, false, 40);
        expect(entries.every((e) => e.patch === undefined)).toBe(true);
        // No patch was requested, so nothing counts as omitted.
        expect(entries.every((e) => e.patchOmitted === undefined)).toBe(true);
    });

    test("carries the previous path for a rename", () => {
        expect(buildFileEntries(raw, false, 40)[1].previousPath).toBe(
            "src/old.ts",
        );
    });

    test("marks a binary or oversized file as having no patch available", () => {
        const entries = buildFileEntries(raw, true, 40);
        expect(entries[2].patch).toBeUndefined();
        expect(entries[2].patchOmitted).toBe("unavailable");
    });

    test("truncates a patch past the per-file line cap", () => {
        const entries = buildFileEntries(raw, true, 2);
        expect(entries[0].patch).toBe("@@\n1");
        expect(entries[0].patchTruncatedLines).toBe(3);
    });

    test("stops emitting patches once the combined budget is spent", () => {
        // 20 files of 100 lines each far exceeds the 600-line total budget.
        const many = Array.from({ length: 20 }, (_, i) => ({
            filename: `f${i}.ts`,
            status: "modified",
            additions: 1,
            deletions: 0,
            changes: 1,
            patch: Array.from({ length: 100 }, (_, n) => `line ${n}`).join(
                "\n",
            ),
        }));
        const entries = buildFileEntries(many, true, 200);
        const kept = entries
            .filter((e) => e.patch !== undefined)
            .reduce((sum, e) => sum + e.patch!.split("\n").length, 0);
        expect(kept).toBeLessThanOrEqual(600);
        expect(entries.some((e) => e.patchOmitted === "budget")).toBe(true);
    });

    test("bounds the combined payload by characters, not just lines", () => {
        // Ten files, each one enormous line: every line-based cap passes, so
        // only the character budget keeps the payload finite.
        const many = Array.from({ length: 10 }, (_, i) => ({
            filename: `min${i}.js`,
            status: "modified",
            additions: 1,
            deletions: 0,
            changes: 1,
            patch: `@@\n${"x".repeat(1_000_000)}`,
        }));
        const entries = buildFileEntries(many, true, 200);
        const totalChars = entries.reduce(
            (sum, e) => sum + (e.patch?.length ?? 0),
            0,
        );
        expect(totalChars).toBeLessThanOrEqual(40_000);
        expect(entries[0].patchTruncatedChars).toBeGreaterThan(0);
        expect(entries.some((e) => e.patchOmitted === "budget")).toBe(true);
    });
});

// ── check classification ─────────────────────────────────────────────────────

describe("check bucket handling", () => {
    const checks = [
        { bucket: "pass" },
        { bucket: "fail" },
        { bucket: "fail" },
        { bucket: "pending" },
        { bucket: "skipping" },
        { bucket: "cancel" },
    ];

    test("counts every bucket gh reports", () => {
        expect(countBuckets(checks)).toEqual({
            total: 6,
            passing: 1,
            failing: 2,
            pending: 1,
            skipping: 1,
            cancelled: 1,
        });
    });

    test("details only genuine failures, not cancellations or pending runs", () => {
        expect(selectFailedChecks(checks)).toHaveLength(2);
    });
});

describe("selectAnnotations", () => {
    test("prefers failure-level annotations over warnings and notices", () => {
        const { annotations } = selectAnnotations(
            [
                { annotation_level: "warning", message: "style" },
                { annotation_level: "failure", message: "boom" },
                { annotation_level: "notice", message: "fyi" },
            ],
            10,
        );
        expect(annotations).toHaveLength(1);
        expect(annotations[0].message).toBe("boom");
    });

    test("falls back to warnings when nothing failed at annotation level", () => {
        const { annotations } = selectAnnotations(
            [{ annotation_level: "warning", message: "style" }],
            10,
        );
        expect(annotations).toHaveLength(1);
        expect(annotations[0].level).toBe("warning");
    });

    test("caps the count and reports the truncation", () => {
        const raw = Array.from({ length: 5 }, (_, i) => ({
            annotation_level: "failure",
            message: `e${i}`,
        }));
        const { annotations, truncated } = selectAnnotations(raw, 2);
        expect(annotations).toHaveLength(2);
        expect(truncated).toBe(true);
    });

    test("reports truncation when pages were left unread", () => {
        // Everything fetched fits under the cap, but GitHub still had more,
        // so claiming a complete picture would be wrong.
        const { annotations, truncated } = selectAnnotations(
            [{ annotation_level: "failure", message: "boom" }],
            10,
            true,
        );
        expect(annotations).toHaveLength(1);
        expect(truncated).toBe(true);
    });

    test("caps a runaway annotation message", () => {
        const { annotations } = selectAnnotations(
            [{ annotation_level: "failure", message: "x".repeat(5000) }],
            10,
        );
        expect(annotations[0].message.length).toBeLessThanOrEqual(401);
        expect(annotations[0].message.endsWith("…")).toBe(true);
    });

    test("carries file and line location through", () => {
        const { annotations } = selectAnnotations(
            [
                {
                    annotation_level: "failure",
                    message: "Type error",
                    path: "src/a.ts",
                    start_line: 12,
                    end_line: 14,
                    title: "TS2339",
                },
            ],
            10,
        );
        expect(annotations[0]).toEqual({
            level: "failure",
            message: "Type error",
            path: "src/a.ts",
            startLine: 12,
            endLine: 14,
            title: "TS2339",
        });
    });
});

// ── error reporting ──────────────────────────────────────────────────────────

describe("gh failure reporting", () => {
    test("reports the first meaningful stderr line and the command", () => {
        const msg = describeGhFailure(
            ["pr", "view", "42"],
            fail("\n\ngh: Not Found (HTTP 404)\nmore detail"),
        );
        expect(msg).toContain("`gh pr view 42` failed");
        expect(msg).toContain("gh: Not Found (HTTP 404)");
        expect(msg).not.toContain("more detail");
    });

    test("falls back to the exit code when gh said nothing", () => {
        expect(describeGhFailure(["api", "x"], fail("", 7))).toContain(
            "gh exited with code 7",
        );
    });

    test("turns bare HTTP statuses into actionable advice", () => {
        expect(ghFailureHint("HTTP 401")).toContain("gh auth login");
        expect(ghFailureHint("gh: Forbidden (HTTP 403)")).toContain(
            "permission",
        );
        expect(ghFailureHint("HTTP 404")).toContain("OWNER/REPO");
        expect(ghFailureHint("something else entirely")).toBeUndefined();
    });
});

// ── prFiles end to end ───────────────────────────────────────────────────────

describe("runPrFiles", () => {
    test("returns files with totals, and reports no truncation", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify([
                        {
                            filename: "src/a.ts",
                            status: "modified",
                            additions: 8,
                            deletions: 3,
                            changes: 11,
                            patch: "@@\n+x",
                        },
                        {
                            filename: "src/b.ts",
                            status: "added",
                            additions: 2,
                            deletions: 0,
                            changes: 2,
                            patch: "@@\n+y",
                        },
                    ]),
                ),
            },
        ]);

        const result = await runPrFiles({ number: 42 }, gh);
        const data = rawData<PrFilesData>(result);

        expect(errorOf(result)).toBeUndefined();
        expect(data.kind).toBe("prFiles");
        expect(data.repo).toBe("microsoft/TypeAgent");
        expect(data.totals).toEqual({
            additions: 10,
            deletions: 3,
            changedFiles: 2,
        });
        expect(data.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
        expect(data.truncated).toEqual({ files: false, patches: false });
        // Patches were not requested, so none are returned.
        expect(data.files.every((f) => f.patch === undefined)).toBe(true);
        expect(data.fromFork).toBe(false);
        expect(Date.parse(data.retrievedAt)).not.toBeNaN();
    });

    test("accepts a pull request link in place of an OWNER/REPO slug", async () => {
        // Naming an out-of-repo PR by pasting its link is the common case; gh
        // itself rejects the link, so it has to be reduced first.
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isFilesApi, res: ok("[]") },
        ]);

        const result = await runPrFiles(
            {
                number: 42,
                repo: "https://github.com/microsoft/TypeAgent/pull/42",
            },
            gh,
        );

        expect(errorOf(result)).toBeUndefined();
        const view = gh.calls.find(isPrView)!;
        expect(view).toContain("--repo");
        expect(view[view.indexOf("--repo") + 1]).toBe(
            "github.com/microsoft/TypeAgent",
        );
    });

    test("includes patches, rendered as diff code blocks, on request", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify([
                        {
                            filename: "src/a.ts",
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                            patch: "@@ -1 +1,2 @@\n a\n+b",
                        },
                    ]),
                ),
            },
        ]);

        const result = await runPrFiles({ number: 42, includePatch: true }, gh);
        const data = rawData<PrFilesData>(result);
        expect(data.files[0].patch).toBe("@@ -1 +1,2 @@\n a\n+b");
        expect(
            blocks(result).some(
                (b) => b.kind === "code" && b.language === "diff",
            ),
        ).toBe(true);
    });

    test("pages until the file cap is reached", async () => {
        const page = (n: number) =>
            JSON.stringify(
                Array.from({ length: 100 }, (_, i) => ({
                    filename: `p${n}-f${i}.ts`,
                    status: "modified",
                    additions: 1,
                    deletions: 0,
                    changes: 1,
                })),
            );
        const big = JSON.parse(PR_VIEW_JSON);
        big.changedFiles = 400;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(big)) },
            {
                match: (a) => isFilesApi(a) && onPage(1)(a),
                res: ok(page(1)),
            },
            {
                match: (a) => isFilesApi(a) && onPage(2)(a),
                res: ok(page(2)),
            },
        ]);

        const data = rawData<PrFilesData>(
            await runPrFiles({ number: 42, maxFiles: 150 }, gh),
        );
        expect(data.files).toHaveLength(150);
        expect(gh.calls.filter(isFilesApi)).toHaveLength(2);
        expect(data.truncated.files).toBe(true);
    });

    test("does not claim truncation for a pull request of exactly maxFiles", async () => {
        // One file more than the cap is requested, so a PR of exactly maxFiles
        // files comes back short of that and is known to be complete.
        const exact = JSON.parse(PR_VIEW_JSON);
        exact.changedFiles = 10;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(exact)) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify(
                        Array.from({ length: 10 }, (_, i) => ({
                            filename: `f${i}.ts`,
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                        })),
                    ),
                ),
            },
        ]);
        const result = await runPrFiles({ number: 42, maxFiles: 10 }, gh);
        expect(rawData<PrFilesData>(result).files).toHaveLength(10);
        expect(rawData<PrFilesData>(result).truncated.files).toBe(false);
        expect(markdown(result)).not.toContain("Raise `maxFiles`");
        // The extra file is asked for in the same request, not another one.
        expect(gh.calls.filter(isFilesApi)).toHaveLength(1);
        expect(gh.calls.find(isFilesApi)![3]).toContain("per_page=11");
    });

    test("detects more files from the API even when the PR total is stale", async () => {
        // A push between `gh pr view` and the files request leaves changedFiles
        // equal to what was fetched, so only the extra file reveals the truth.
        const stale = JSON.parse(PR_VIEW_JSON);
        stale.changedFiles = 10;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(stale)) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify(
                        Array.from({ length: 11 }, (_, i) => ({
                            filename: `f${i}.ts`,
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                        })),
                    ),
                ),
            },
        ]);
        const result = await runPrFiles({ number: 42, maxFiles: 10 }, gh);
        const data = rawData<PrFilesData>(result);
        // The extra file is used as evidence only, never reported.
        expect(data.files).toHaveLength(10);
        expect(data.truncated.files).toBe(true);
        expect(markdown(result)).toContain("the pull request has more");
    });

    test("probes for one more file instead of fetching another whole page", async () => {
        // Above GitHub's page ceiling the extra file cannot ride along in the
        // first request, so the follow-up must ask for exactly one file - and
        // never with patches, since it is only evidence.
        const big = JSON.parse(PR_VIEW_JSON);
        big.changedFiles = 100;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(big)) },
            {
                match: (a) => isFilesApi(a) && a[3].includes("per_page=100"),
                res: ok(
                    JSON.stringify(
                        Array.from({ length: 100 }, (_, i) => ({
                            filename: `f${i}.ts`,
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                            patch: "@@\n+x",
                        })),
                    ),
                ),
            },
            {
                match: (a) => isFilesApi(a) && a[3].includes("per_page=1&"),
                res: ok(
                    JSON.stringify([
                        {
                            filename: "extra.ts",
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                        },
                    ]),
                ),
            },
        ]);
        const data = rawData<PrFilesData>(
            await runPrFiles(
                { number: 42, maxFiles: 100, includePatch: true },
                gh,
            ),
        );
        expect(data.files).toHaveLength(100);
        // The probed file is evidence only and is never reported.
        expect(data.files.some((f) => f.path === "extra.ts")).toBe(false);
        expect(data.truncated.files).toBe(true);

        const probe = gh.calls.find((a) => a[3]?.includes("per_page=1&"))!;
        expect(probe[3]).toContain("page=101");
        // Patches are pointless for a file we discard.
        expect(probe).toContain("--jq");
        expect(gh.calls.filter(isFilesApi)).toHaveLength(2);
    });

    test("reports truncation when the PR has more files than were fetched", async () => {
        const big = JSON.parse(PR_VIEW_JSON);
        big.changedFiles = 40;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(big)) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify(
                        Array.from({ length: 10 }, (_, i) => ({
                            filename: `f${i}.ts`,
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                        })),
                    ),
                ),
            },
        ]);
        const result = await runPrFiles({ number: 42, maxFiles: 10 }, gh);
        expect(rawData<PrFilesData>(result).truncated.files).toBe(true);
        expect(markdown(result)).toContain("Showing 10 of 40 changed files");
    });

    test("stops paging as soon as a short page comes back", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isFilesApi,
                res: ok(
                    JSON.stringify([
                        {
                            filename: "only.ts",
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                        },
                    ]),
                ),
            },
        ]);
        await runPrFiles({ number: 42, maxFiles: 300 }, gh);
        expect(gh.calls.filter(isFilesApi)).toHaveLength(1);
    });

    test("caps the page size so a small maxFiles fetches one small page", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isFilesApi, res: ok("[]") },
        ]);
        await runPrFiles({ number: 42, maxFiles: 5 }, gh);
        // One over the cap, so "are there more?" needs no extra request.
        expect(gh.calls.find(isFilesApi)![3]).toContain("per_page=6");
    });

    test("flags a fork pull request", async () => {
        const forked = JSON.parse(PR_VIEW_JSON);
        forked.headRepository = {
            name: "TypeAgent",
            nameWithOwner: "contributor/TypeAgent",
        };
        forked.headRepositoryOwner = { login: "contributor" };
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(forked)) },
            { match: isFilesApi, res: ok("[]") },
        ]);
        const data = rawData<PrFilesData>(await runPrFiles({ number: 42 }, gh));
        expect(data.fromFork).toBe(true);
        expect(data.headRepo).toBe("contributor/TypeAgent");
        // The files still come from the base repository, not the fork.
        expect(gh.calls.find(isFilesApi)![3]).toContain(
            "repos/microsoft/TypeAgent/",
        );
    });

    test("surfaces a permissions failure from gh with advice", async () => {
        const gh = fakeGh([
            {
                match: isPrView,
                res: fail("gh: Must have push access (HTTP 403)"),
            },
        ]);
        const result = await runPrFiles({ number: 42 }, gh);
        expect(errorOf(result)).toContain("HTTP 403");
        expect(errorOf(result)).toContain("permission");
        // We never attempted the files call after metadata failed.
        expect(gh.calls.filter(isFilesApi)).toHaveLength(0);
    });

    test("fails clearly when a files page cannot be read", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isFilesApi, res: fail("gh: Not Found (HTTP 404)") },
        ]);
        const result = await runPrFiles({ number: 42 }, gh);
        expect(errorOf(result)).toContain("HTTP 404");
    });

    test("handles a pull request that changes nothing", async () => {
        const empty = JSON.parse(PR_VIEW_JSON);
        empty.changedFiles = 0;
        empty.additions = 0;
        empty.deletions = 0;
        const gh = fakeGh([
            { match: isPrView, res: ok(JSON.stringify(empty)) },
            { match: isFilesApi, res: ok("[]") },
        ]);
        const result = await runPrFiles({ number: 42 }, gh);
        expect(rawData<PrFilesData>(result).files).toEqual([]);
        expect(markdown(result)).toContain("changes no files");
    });
});

// ── prFailedChecks end to end ────────────────────────────────────────────────

const FAILING_CHECKS_JSON = JSON.stringify([
    { bucket: "pass", name: "lint", state: "SUCCESS", link: "" },
    {
        bucket: "fail",
        name: "build (ubuntu)",
        state: "FAILURE",
        workflow: "CI",
        event: "pull_request",
        description: "",
        link: "https://github.com/microsoft/TypeAgent/actions/runs/1/job/1234",
        startedAt: "2024-05-01T10:00:00Z",
        completedAt: "2024-05-01T10:12:00Z",
    },
    { bucket: "pending", name: "e2e", state: "IN_PROGRESS", link: "" },
]);

describe("runPrFailedChecks", () => {
    test("accepts a pull request link in place of an OWNER/REPO slug", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok("[]") },
        ]);

        const result = await runPrFailedChecks(
            {
                number: 42,
                repo: "https://github.com/microsoft/TypeAgent/pull/42",
            },
            gh,
        );

        expect(errorOf(result)).toBeUndefined();
        // Both gh calls are addressed by repo, so both must be normalized.
        for (const call of [
            gh.calls.find(isPrView)!,
            gh.calls.find(isPrChecks)!,
        ]) {
            expect(call[call.indexOf("--repo") + 1]).toBe(
                "github.com/microsoft/TypeAgent",
            );
        }
    });

    test("details failing checks with their annotations", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            // gh exits non-zero when checks are failing, but still prints JSON.
            {
                match: isPrChecks,
                res: { stdout: FAILING_CHECKS_JSON, stderr: "", exitCode: 8 },
            },
            {
                match: isAnnotationsApi,
                res: ok(
                    JSON.stringify([
                        {
                            annotation_level: "failure",
                            message: "Property 'x' does not exist.",
                            path: "src/a.ts",
                            start_line: 85,
                            end_line: 85,
                        },
                    ]),
                ),
            },
        ]);

        const result = await runPrFailedChecks({ number: 42 }, gh);
        const data = rawData<PrFailedChecksData>(result);

        expect(errorOf(result)).toBeUndefined();
        expect(data.counts).toEqual({
            total: 3,
            passing: 1,
            failing: 1,
            pending: 1,
            skipping: 0,
            cancelled: 0,
        });
        // A check is still running, so the failing set may yet grow.
        expect(data.inProgress).toBe(true);
        expect(data.failedChecks).toHaveLength(1);
        const check = data.failedChecks[0];
        expect(check.name).toBe("build (ubuntu)");
        expect(check.workflow).toBe("CI");
        expect(check.startedAt).toBe("2024-05-01T10:00:00Z");
        expect(check.annotations[0].path).toBe("src/a.ts");
        expect(check.annotationsTruncated).toBe(false);
        // An empty description from gh is dropped rather than shown blank.
        expect(check.description).toBeUndefined();
        // Annotations are keyed on the job id from the check link.
        expect(gh.calls.find(isAnnotationsApi)![3]).toContain(
            "check-runs/1234/annotations",
        );
    });

    test("reads past the first page to find the failures that explain a check", async () => {
        // A noisy check reports a page of warnings before the real failure, so
        // stopping at page 1 would show only style noise.
        const fullPage = JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
                annotation_level: "warning",
                message: `style ${i}`,
            })),
        );
        const secondPage = JSON.stringify([
            { annotation_level: "failure", message: "the real failure" },
        ]);
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok(FAILING_CHECKS_JSON) },
            {
                match: (a) => isAnnotationsApi(a) && onPage(1)(a),
                res: ok(fullPage),
            },
            {
                match: (a) => isAnnotationsApi(a) && onPage(2)(a),
                res: ok(secondPage),
            },
        ]);
        const data = rawData<PrFailedChecksData>(
            await runPrFailedChecks({ number: 42 }, gh),
        );
        const check = data.failedChecks[0];
        expect(check.annotations).toHaveLength(1);
        expect(check.annotations[0].message).toBe("the real failure");
        // Page 2 was short, so GitHub had nothing further to offer.
        expect(check.annotationsTruncated).toBe(false);
        expect(gh.calls.filter(isAnnotationsApi)).toHaveLength(2);
    });

    test("admits truncation when the annotation page budget runs out", async () => {
        const fullPage = JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
                annotation_level: "warning",
                message: `style ${i}`,
            })),
        );
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok(FAILING_CHECKS_JSON) },
            { match: isAnnotationsApi, res: ok(fullPage) },
        ]);
        const result = await runPrFailedChecks({ number: 42 }, gh);
        const check = rawData<PrFailedChecksData>(result).failedChecks[0];
        expect(check.annotationsTruncated).toBe(true);
        // Paging is bounded even when GitHub keeps returning full pages.
        expect(gh.calls.filter(isAnnotationsApi)).toHaveLength(3);
        // Raising maxAnnotations is not the only remedy, so don't imply it is.
        expect(markdown(result)).toContain("follow the link for the full list");
    });

    test("keeps the annotations it did fetch when a later page fails", async () => {
        // Page 1 carries the failures that explain the check; a rate limit on
        // page 2 must not throw them away.
        const fullPage = JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({
                annotation_level: "failure",
                message: `error ${i}`,
            })),
        );
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok(FAILING_CHECKS_JSON) },
            {
                match: (a) => isAnnotationsApi(a) && onPage(1)(a),
                res: ok(fullPage),
            },
            {
                match: isAnnotationsApi,
                res: fail("gh: API rate limit exceeded (HTTP 403)"),
            },
        ]);
        const result = await runPrFailedChecks({ number: 42 }, gh);
        const check = rawData<PrFailedChecksData>(result).failedChecks[0];
        expect(check.annotations).toHaveLength(10);
        expect(check.annotations[0].message).toBe("error 0");
        expect(check.annotationsTruncated).toBe(true);
        expect(check.annotationsUnavailable).toContain("HTTP 403");
        expect(markdown(result)).toContain("Annotations are incomplete");
    });

    test("degrades gracefully when annotations cannot be fetched", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok(FAILING_CHECKS_JSON) },
            {
                match: isAnnotationsApi,
                res: fail("gh: Not Found (HTTP 404)"),
            },
        ]);
        const data = rawData<PrFailedChecksData>(
            await runPrFailedChecks({ number: 42 }, gh),
        );
        // The action still succeeds — only this check's detail is reduced.
        expect(data.failedChecks[0].annotations).toEqual([]);
        expect(data.failedChecks[0].annotationsUnavailable).toContain(
            "HTTP 404",
        );
    });

    test("explains why a third-party check has no annotations", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isPrChecks,
                res: ok(
                    JSON.stringify([
                        {
                            bucket: "fail",
                            name: "Azure Pipelines",
                            state: "FAILURE",
                            link: "https://dev.azure.com/org/proj/_build/results?buildId=1",
                        },
                    ]),
                ),
            },
        ]);
        const data = rawData<PrFailedChecksData>(
            await runPrFailedChecks({ number: 42 }, gh),
        );
        expect(data.failedChecks[0].annotationsUnavailable).toContain(
            "not a GitHub check run",
        );
        // No pointless annotations request was made.
        expect(gh.calls.filter(isAnnotationsApi)).toHaveLength(0);
    });

    test("caps the number of checks detailed and reports the truncation", async () => {
        const checks = Array.from({ length: 6 }, (_, i) => ({
            bucket: "fail",
            name: `job ${i}`,
            state: "FAILURE",
            link: "",
        }));
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: ok(JSON.stringify(checks)) },
        ]);
        const data = rawData<PrFailedChecksData>(
            await runPrFailedChecks({ number: 42, maxChecks: 2 }, gh),
        );
        expect(data.counts.failing).toBe(6);
        expect(data.failedChecks).toHaveLength(2);
        expect(data.truncated.checks).toBe(true);
    });

    test("reports an all-green pull request without listing failures", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isPrChecks,
                res: ok(
                    JSON.stringify([
                        { bucket: "pass", name: "lint", state: "SUCCESS" },
                    ]),
                ),
            },
        ]);
        const result = await runPrFailedChecks({ number: 42 }, gh);
        const data = rawData<PrFailedChecksData>(result);
        expect(data.failedChecks).toEqual([]);
        expect(data.inProgress).toBe(false);
        expect(markdown(result)).toContain("No checks are failing");
    });

    test("treats a pull request with no checks at all as a valid result", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isPrChecks,
                res: fail("no checks reported on the 'feature' branch"),
            },
        ]);
        const result = await runPrFailedChecks({ number: 42 }, gh);
        expect(errorOf(result)).toBeUndefined();
        expect(rawData<PrFailedChecksData>(result).counts.total).toBe(0);
    });

    test("fails when gh cannot report checks for another reason", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            { match: isPrChecks, res: fail("gh: Unauthorized (HTTP 401)") },
        ]);
        const result = await runPrFailedChecks({ number: 42 }, gh);
        expect(errorOf(result)).toContain("gh auth login");
    });

    test("counts cancelled checks without trying to explain them", async () => {
        const gh = fakeGh([
            { match: isPrView, res: ok(PR_VIEW_JSON) },
            {
                match: isPrChecks,
                res: ok(
                    JSON.stringify([
                        { bucket: "cancel", name: "build", state: "CANCELLED" },
                    ]),
                ),
            },
        ]);
        const data = rawData<PrFailedChecksData>(
            await runPrFailedChecks({ number: 42 }, gh),
        );
        expect(data.counts.cancelled).toBe(1);
        expect(data.failedChecks).toEqual([]);
    });
});
