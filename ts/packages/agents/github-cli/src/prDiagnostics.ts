// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Read-only pull request diagnostics: what a PR changed, and why its checks
 * are red. Both actions are deterministic - they shell out to `gh`, parse the
 * JSON it returns, and build a typed result. No LLM is involved, so they are
 * safe to call directly from an external client via `@action github-cli ...`.
 *
 * Everything here is bounded on purpose. A pull request can touch thousands of
 * files and a check can carry hundreds of annotations, so each result carries
 * explicit truncation flags rather than silently dropping data.
 */

import {
    ActionResult,
    ActionResultSuccess,
    BadgeTone,
    KeyValuePair,
    StructuredBlock,
    TableCell,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import {
    ColumnSpec,
    createStructuredContent,
} from "@typeagent/agent-sdk/helpers/display";
import { PrFailedChecksAction, PrFilesAction } from "./github-cliSchema.js";
import { buildTableBlock } from "./structuredResults.js";

// ============================================================================
// gh invocation
// ============================================================================

// The result of one `gh` invocation. A non-zero exit is data here, not an
// exception: `gh pr checks` exits non-zero when checks fail or are still
// pending yet still writes the JSON we asked for, and a failed annotations
// fetch must degrade to "annotations unavailable" instead of failing the whole
// action. `exitCode` is -1 when gh never ran (missing binary, timeout).
export type GhResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
};

export type GhRunner = (args: string[]) => Promise<GhResult>;

// ============================================================================
// Output bounds
// ============================================================================

const FILES_DEFAULT = 50;
const FILES_MAX = 300;
const PATCH_LINES_DEFAULT = 40;
const PATCH_LINES_MAX = 200;
// Ceiling on the combined patch excerpt across all files, so a high file cap
// combined with includePatch can't produce an unbounded payload.
const PATCH_TOTAL_LINES_MAX = 600;
// Line counts alone do not bound a patch: a generated or minified file can put
// megabytes on a single line. Every patch excerpt is therefore capped by
// characters as well, per file and in aggregate.
const PATCH_CHARS_MAX = 8_000;
const PATCH_TOTAL_CHARS_MAX = 40_000;
const CHECKS_DEFAULT = 5;
const CHECKS_MAX = 20;
const ANNOTATIONS_DEFAULT = 10;
const ANNOTATIONS_MAX = 50;
// GitHub's per-page ceiling for the pull request files endpoint.
const FILES_PAGE_SIZE = 100;
// 100 is the per-page ceiling for the check run annotations endpoint. The
// endpoint returns annotations in the order the check reported them, so a
// noisy check can emit a page of warnings before the failure that actually
// explains the red state - read a few pages before giving up on finding one.
const ANNOTATIONS_FETCH_PAGE_SIZE = 100;
const ANNOTATIONS_MAX_PAGES = 3;
// How many annotation fetches to have in flight at once. Failing checks are
// independent, but firing all of them at once would spike the API rate limit
// for no useful gain.
const ANNOTATIONS_FETCH_CONCURRENCY = 4;
// Annotation messages are free-form and occasionally carry a whole stack
// trace, so cap each one.
const ANNOTATION_MESSAGE_MAX_CHARS = 400;

// Clamp a caller-supplied count into [1, max], falling back when it is absent
// or not a number. Callers come from a validated action schema, but the schema
// can't express a range.
export function clampCount(
    value: number | undefined,
    fallback: number,
    max: number,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(Math.floor(value), 1), max);
}

// ============================================================================
// URL parsing
// ============================================================================

// A repository on a specific GitHub host. `gh api` talks to the host you tell
// it to, so carrying the host through keeps GitHub Enterprise callers working.
export type RepoRef = {
    host: string;
    owner: string;
    repo: string;
};

export function repoSlug(ref: RepoRef): string {
    return `${ref.owner}/${ref.repo}`;
}

// A PR's web URL is the one place `gh pr view` reports the *base* repository,
// which is what the files and check-runs REST endpoints key on - a PR opened
// from a fork still lives in the base repo.
export function parsePrUrl(url: string): RepoRef | undefined {
    const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
    return m ? { host: m[1], owner: m[2], repo: m[3] } : undefined;
}

// Reduce whatever the caller used to name a repository down to something
// `gh --repo` accepts.
//
// gh takes `OWNER/REPO`, `HOST/OWNER/REPO`, and a plain repository URL, but it
// rejects a URL that points at anything *inside* the repository - a pull
// request link fails with "invalid path: /owner/repo/pull/123", which tells the
// user nothing useful. Yet a PR link is the most natural way to refer to a pull
// request in some other repository, and it already carries the host, so trim it
// back to `HOST/OWNER/REPO` instead of letting gh reject it.
//
// The PR number is NOT taken from the link: `number` is a required parameter
// and stays authoritative, so there is only ever one place the number comes
// from. Anything unrecognized is passed through untouched for gh (or the shared
// repo validation) to rule on.
export function normalizeRepoParam(
    repo: string | undefined,
): string | undefined {
    if (repo === undefined || repo.length === 0) {
        return repo;
    }
    const url = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)(?:\/.*)?$/.exec(repo);
    if (!url) {
        return repo;
    }
    // Strip a trailing ".git" so a clone URL names the same repo as its web URL.
    const name = url[3].replace(/\.git$/, "");
    return `${url[1]}/${url[2]}/${name}`;
}

// `gh pr checks` reports a `link` per check. Two GitHub URL shapes carry a
// check run id, which is the key the annotations endpoint takes:
//
//   https://HOST/OWNER/REPO/runs/<checkRunId>
//   https://HOST/OWNER/REPO/actions/runs/<runId>/job/<jobId>
//
// For GitHub Actions the job id *is* the check run id (a job's `check_run_url`
// ends in the same number), so both shapes resolve the same way. Links to
// third-party CI (Azure Pipelines and friends) and to GitHub Apps carry no
// check run id and return undefined - those checks have no annotations to
// fetch.
export function parseCheckRunRef(
    link: string | undefined,
): (RepoRef & { checkRunId: string }) | undefined {
    if (!link) {
        return undefined;
    }
    const job =
        /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/actions\/runs\/\d+\/job\/(\d+)/.exec(
            link,
        );
    if (job) {
        return {
            host: job[1],
            owner: job[2],
            repo: job[3],
            checkRunId: job[4],
        };
    }
    const run = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/runs\/(\d+)/.exec(link);
    if (run) {
        return {
            host: run[1],
            owner: run[2],
            repo: run[3],
            checkRunId: run[4],
        };
    }
    return undefined;
}

// ============================================================================
// gh argument construction
// ============================================================================

const PR_VIEW_FIELDS =
    "number,title,url,state,isDraft,additions,deletions,changedFiles,headRefName,baseRefName,headRepository,headRepositoryOwner";

const PR_CHECKS_FIELDS =
    "bucket,name,state,link,workflow,event,startedAt,completedAt,description";

export function buildPrViewArgs(prNumber: number, repo?: string): string[] {
    const args = ["pr", "view", String(prNumber)];
    if (repo) {
        args.push("--repo", repo);
    }
    args.push("--json", PR_VIEW_FIELDS);
    return args;
}

export function buildPrChecksArgs(prNumber: number, repo?: string): string[] {
    const args = ["pr", "checks", String(prNumber)];
    if (repo) {
        args.push("--repo", repo);
    }
    args.push("--json", PR_CHECKS_FIELDS);
    return args;
}

// `gh api` defaults to the account's default host, which is not necessarily
// the host the PR lives on, so the hostname is always explicit.
function buildApiArgs(host: string, path: string): string[] {
    return ["api", "--hostname", host, path];
}

// The pull request files endpoint always includes each file's full patch, and
// there is no query parameter to suppress it. Without a projection a
// metadata-only request still transfers - and buffers - every patch in the PR.
// `gh --jq` applies the filter inside gh, so the patches never reach us.
const FILES_METADATA_JQ =
    "[.[] | {filename, status, additions, deletions, changes, previous_filename}]";

export function buildPrFilesArgs(
    ref: RepoRef,
    prNumber: number,
    page: number,
    perPage: number,
    includePatch: boolean,
): string[] {
    const args = buildApiArgs(
        ref.host,
        `repos/${ref.owner}/${ref.repo}/pulls/${prNumber}/files?per_page=${perPage}&page=${page}`,
    );
    if (!includePatch) {
        args.push("--jq", FILES_METADATA_JQ);
    }
    return args;
}

export function buildAnnotationsArgs(
    ref: RepoRef & { checkRunId: string },
    page: number,
): string[] {
    return buildApiArgs(
        ref.host,
        `repos/${ref.owner}/${ref.repo}/check-runs/${ref.checkRunId}/annotations?per_page=${ANNOTATIONS_FETCH_PAGE_SIZE}&page=${page}`,
    );
}

// ============================================================================
// Error reporting
// ============================================================================

// Turn a gh failure into one line the caller can act on. gh puts the useful
// text on stderr, but writes nothing there when it fails to start at all.
export function describeGhFailure(args: string[], res: GhResult): string {
    const detail = (res.stderr || res.stdout).trim();
    const firstLine =
        detail
            .split("\n")
            .find((line) => line.trim().length > 0)
            ?.trim() ?? `gh exited with code ${res.exitCode}`;
    const hint = ghFailureHint(detail);
    return `\`gh ${args.join(" ")}\` failed: ${firstLine}${hint ? ` ${hint}` : ""}`;
}

// gh surfaces auth, permission, and not-found problems as bare HTTP status
// lines. Say what to do about them instead of passing the status through.
export function ghFailureHint(detail: string): string | undefined {
    if (/HTTP 401|not logged in|gh auth login/i.test(detail)) {
        return "Run `gh auth login` and retry.";
    }
    if (/HTTP 403/i.test(detail)) {
        return "The authenticated account lacks permission for this repository, or the API rate limit is exhausted.";
    }
    if (/HTTP 404/i.test(detail)) {
        return "Check the OWNER/REPO slug and pull request number, and that the account can see this repository.";
    }
    return undefined;
}

function parseJsonArray(stdout: string): Record<string, unknown>[] | undefined {
    try {
        const parsed: unknown = JSON.parse(stdout);
        return Array.isArray(parsed)
            ? (parsed as Record<string, unknown>[])
            : undefined;
    } catch {
        return undefined;
    }
}

function parseJsonObject(stdout: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(stdout);
        return parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

// ============================================================================
// Pull request metadata (shared by both actions)
// ============================================================================

export type PrMeta = {
    ref: RepoRef;
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    // Set only for a PR opened from another repository. CI for a fork PR runs
    // with a read-only token and no secrets, which is a common root cause of a
    // check failing there but not on a branch PR.
    headRepo?: string;
    fromFork: boolean;
};

type Fetched<T> = { ok: true; value: T } | { ok: false; error: string };

function nestedString(
    data: Record<string, unknown>,
    key: string,
    field: string,
): string | undefined {
    const nested = data[key];
    if (nested === null || typeof nested !== "object") {
        return undefined;
    }
    const value = (nested as Record<string, unknown>)[field];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function toPrMeta(
    data: Record<string, unknown>,
): PrMeta | { error: string } {
    const url = typeof data.url === "string" ? data.url : "";
    const ref = parsePrUrl(url);
    if (ref === undefined) {
        return {
            error: `Could not determine the repository from the pull request URL (${url || "missing"}).`,
        };
    }
    const headRepo = nestedString(data, "headRepository", "nameWithOwner");
    const headOwner = nestedString(data, "headRepositoryOwner", "login");
    // `headRepository.nameWithOwner` is the reliable comparison; fall back to
    // the owner login when an older gh omits it.
    const fromFork =
        headRepo !== undefined
            ? headRepo.toLowerCase() !== repoSlug(ref).toLowerCase()
            : headOwner !== undefined
              ? headOwner.toLowerCase() !== ref.owner.toLowerCase()
              : false;
    return {
        ref,
        number: Number(data.number ?? 0),
        title: String(data.title ?? ""),
        url,
        state: String(data.state ?? ""),
        isDraft: Boolean(data.isDraft),
        headRefName: String(data.headRefName ?? ""),
        baseRefName: String(data.baseRefName ?? ""),
        additions: Number(data.additions ?? 0),
        deletions: Number(data.deletions ?? 0),
        changedFiles: Number(data.changedFiles ?? 0),
        ...(fromFork && headRepo !== undefined ? { headRepo } : {}),
        fromFork,
    };
}

async function fetchPrMeta(
    gh: GhRunner,
    prNumber: number,
    repo: string | undefined,
): Promise<Fetched<PrMeta>> {
    const args = buildPrViewArgs(prNumber, repo);
    const res = await gh(args);
    const data = parseJsonObject(res.stdout);
    if (res.exitCode !== 0 || data === undefined) {
        return { ok: false, error: describeGhFailure(args, res) };
    }
    const meta = toPrMeta(data);
    if ("error" in meta) {
        return { ok: false, error: meta.error };
    }
    return { ok: true, value: meta };
}

// The identity fields both result payloads carry, so one helper can render
// the shared metadata block for either of them.
type PrIdentity = {
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    headRepo?: string;
    fromFork: boolean;
    url: string;
    retrievedAt: string;
};

// Metadata both actions show, so a caller always knows which pull request and
// which head/base pair the result describes, and how fresh it is.
function prMetaPairs(pr: PrIdentity): KeyValuePair[] {
    const pairs: KeyValuePair[] = [
        {
            label: "State",
            value: {
                text: pr.isDraft ? "Draft" : pr.state,
                badge: pr.isDraft
                    ? "warning"
                    : pr.state.toUpperCase() === "OPEN"
                      ? "info"
                      : "neutral",
            },
        },
        {
            label: "Branch",
            value: `${pr.headRefName} → ${pr.baseRefName}`,
        },
    ];
    if (pr.fromFork) {
        pairs.push({
            label: "Fork",
            value: {
                text: pr.headRepo ?? "head branch is in another repository",
                badge: "warning",
            },
        });
    }
    pairs.push({
        label: "Link",
        value: { text: pr.url, href: pr.url },
    });
    pairs.push({ label: "Retrieved", value: pr.retrievedAt });
    return pairs;
}

// ============================================================================
// prFiles
// ============================================================================

export type PrFileEntry = {
    path: string;
    // Where a renamed or copied file came from. Without it a rename reads as
    // an unrelated delete plus add.
    previousPath?: string;
    // added | removed | modified | renamed | copied | changed | unchanged
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    // Present only when patches were requested and GitHub returned one.
    patch?: string;
    // Why the patch is missing, when one was requested. "unavailable" means
    // GitHub itself omitted it (binary blob, or a diff it considers too large
    // to inline); "budget" means the combined patch cap was already spent.
    patchOmitted?: "unavailable" | "budget";
    // Lines dropped from the end of this file's patch.
    patchTruncatedLines?: number;
    // Characters dropped by the per-patch character budget. Set only when a
    // single line was longer than the budget allows, which the line count
    // alone cannot express.
    patchTruncatedChars?: number;
};

export type PrFilesData = {
    kind: "prFiles";
    repo: string;
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    headRepo?: string;
    fromFork: boolean;
    totals: {
        additions: number;
        deletions: number;
        changedFiles: number;
    };
    files: PrFileEntry[];
    truncated: {
        // More files exist than were returned.
        files: boolean;
        // At least one patch was shortened or dropped.
        patches: boolean;
    };
    retrievedAt: string;
};

// Keep the head of a patch rather than the tail: the hunk header and the first
// changed lines say what the edit is, while the tail is usually trailing
// context.
//
// Both a line cap and a character cap apply. The line cap is what a reader
// thinks in, but it bounds nothing on its own - a generated or minified file
// can hold megabytes on one line - so the character cap is the real bound.
export function truncatePatch(
    patch: string,
    maxLines: number,
    maxChars: number,
): {
    text: string;
    keptLines: number;
    omittedLines: number;
    omittedChars: number;
} {
    const lines = patch.split("\n");
    const kept = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
    const head = kept.join("\n");
    if (head.length <= maxChars) {
        return {
            text: head,
            keptLines: kept.length,
            omittedLines: lines.length - kept.length,
            omittedChars: 0,
        };
    }
    const cut = head.slice(0, maxChars);
    const lastNewline = cut.lastIndexOf("\n");
    // Prefer to end on a line boundary, but not when that would throw away
    // most of the budget: a single line longer than the budget is cut mid-line
    // so its start - where the diff marker and the useful content are - still
    // shows. A partial trailing line does not count as kept.
    const onBoundary = lastNewline >= Math.floor(maxChars / 2);
    const text = onBoundary ? cut.slice(0, lastNewline) : cut;
    const keptLines = onBoundary
        ? text.split("\n").length
        : text.split("\n").length - 1;
    return {
        text,
        keptLines,
        omittedLines: lines.length - keptLines,
        omittedChars: head.length - text.length,
    };
}

export function buildFileEntries(
    rawFiles: Record<string, unknown>[],
    includePatch: boolean,
    maxPatchLines: number,
): PrFileEntry[] {
    let remainingPatchLines = PATCH_TOTAL_LINES_MAX;
    let remainingPatchChars = PATCH_TOTAL_CHARS_MAX;
    return rawFiles.map((raw) => {
        const entry: PrFileEntry = {
            path: String(raw.filename ?? ""),
            status: String(raw.status ?? "unknown"),
            additions: Number(raw.additions ?? 0),
            deletions: Number(raw.deletions ?? 0),
            changes: Number(raw.changes ?? 0),
        };
        if (typeof raw.previous_filename === "string") {
            entry.previousPath = raw.previous_filename;
        }
        if (!includePatch) {
            return entry;
        }
        if (typeof raw.patch !== "string") {
            entry.patchOmitted = "unavailable";
            return entry;
        }
        if (remainingPatchLines <= 0 || remainingPatchChars <= 0) {
            entry.patchOmitted = "budget";
            return entry;
        }
        const { text, keptLines, omittedLines, omittedChars } = truncatePatch(
            raw.patch,
            Math.min(maxPatchLines, remainingPatchLines),
            Math.min(PATCH_CHARS_MAX, remainingPatchChars),
        );
        remainingPatchLines -= keptLines;
        remainingPatchChars -= text.length;
        entry.patch = text;
        if (omittedLines > 0) {
            entry.patchTruncatedLines = omittedLines;
        }
        if (omittedChars > 0) {
            entry.patchTruncatedChars = omittedChars;
        }
        return entry;
    });
}

// Page through the pull request files endpoint until we have as many files as
// the caller asked for, or GitHub runs out.
//
// One file more than the cap is asked for, so that "are there more?" is
// answered by the API rather than inferred. A full page proves nothing on its
// own - a PR of exactly `maxFiles` files fills the page too - and the PR's own
// `changedFiles` total is read in a separate, earlier call, so a push landing
// between the two can leave it stale.
async function fetchPrFiles(
    gh: GhRunner,
    ref: RepoRef,
    prNumber: number,
    maxFiles: number,
    includePatch: boolean,
): Promise<Fetched<{ files: Record<string, unknown>[]; hasMore: boolean }>> {
    const files: Record<string, unknown>[] = [];
    // `page` is an offset in units of `per_page`, so the page size has to stay
    // fixed for the whole walk. Below GitHub's ceiling the extra file rides
    // along in the first request; at or above it, the probe below is needed.
    const perPage = Math.min(FILES_PAGE_SIZE, maxFiles + 1);
    let lastPageFull = false;
    for (let page = 1; files.length < maxFiles; page++) {
        const args = buildPrFilesArgs(
            ref,
            prNumber,
            page,
            perPage,
            includePatch,
        );
        const res = await gh(args);
        const batch =
            res.exitCode === 0 ? parseJsonArray(res.stdout) : undefined;
        if (batch === undefined) {
            return { ok: false, error: describeGhFailure(args, res) };
        }
        files.push(...batch);
        lastPageFull = batch.length >= perPage;
        if (!lastPageFull) {
            break;
        }
    }

    if (files.length > maxFiles) {
        return {
            ok: true,
            value: { files: files.slice(0, maxFiles), hasMore: true },
        };
    }
    if (!lastPageFull) {
        return { ok: true, value: { files, hasMore: false } };
    }

    // Exactly `maxFiles` files arrived on whole pages, so whether a further one
    // exists is still open. Ask for that single file rather than another full
    // page, and never with patches - it is evidence, not output.
    const probeArgs = buildPrFilesArgs(ref, prNumber, maxFiles + 1, 1, false);
    const probeRes = await gh(probeArgs);
    const probe =
        probeRes.exitCode === 0 ? parseJsonArray(probeRes.stdout) : undefined;
    if (probe === undefined) {
        return { ok: false, error: describeGhFailure(probeArgs, probeRes) };
    }
    return { ok: true, value: { files, hasMore: probe.length > 0 } };
}

function fileStatusBadge(status: string): BadgeTone {
    switch (status) {
        case "added":
            return "success";
        case "removed":
            return "error";
        case "renamed":
        case "copied":
            return "info";
        default:
            return "neutral";
    }
}

// The patch excerpts, one section per file that has one, plus the notes
// explaining anything that was cut or never available.
function patchBlocks(files: PrFileEntry[]): StructuredBlock[] {
    const blocks: StructuredBlock[] = [];
    for (const file of files) {
        if (file.patch === undefined) {
            continue;
        }
        blocks.push({ kind: "divider" });
        blocks.push({ kind: "heading", level: 3, text: file.path });
        blocks.push({ kind: "code", code: file.patch, language: "diff" });
        const cuts: string[] = [];
        if (file.patchTruncatedLines !== undefined) {
            cuts.push(
                `${file.patchTruncatedLines} more patch line${file.patchTruncatedLines === 1 ? "" : "s"}`,
            );
        }
        if (file.patchTruncatedChars !== undefined) {
            cuts.push(
                `${file.patchTruncatedChars} more character${file.patchTruncatedChars === 1 ? "" : "s"} on a line too long to show`,
            );
        }
        if (cuts.length > 0) {
            blocks.push({
                kind: "text",
                text: `*…${cuts.join(" and ")} omitted.*`,
                format: "markdown",
            });
        }
    }

    const countOmitted = (reason: PrFileEntry["patchOmitted"]) =>
        files.filter((f) => f.patchOmitted === reason).length;
    const unavailable = countOmitted("unavailable");
    const overBudget = countOmitted("budget");
    const notes: string[] = [];
    if (unavailable > 0) {
        notes.push(
            `${unavailable} file${unavailable === 1 ? "" : "s"} had no patch (binary, or a diff GitHub considers too large)`,
        );
    }
    if (overBudget > 0) {
        notes.push(
            `${overBudget} file${overBudget === 1 ? "" : "s"} exceeded the combined patch limit of ${PATCH_TOTAL_LINES_MAX} lines / ${PATCH_TOTAL_CHARS_MAX} characters`,
        );
    }
    if (notes.length > 0) {
        blocks.push({
            kind: "text",
            text: `*${notes.join("; ")}.*`,
            format: "markdown",
        });
    }
    return blocks;
}

export function buildStructuredPrFiles(data: PrFilesData): ActionResultSuccess {
    const shown = data.files.length;
    const headingText = `#${data.number} ${data.title} — ${shown} of ${data.totals.changedFiles} file${data.totals.changedFiles === 1 ? "" : "s"}`;

    const pairs: KeyValuePair[] = [
        {
            label: "Changes",
            value: `+${data.totals.additions} −${data.totals.deletions} across ${data.totals.changedFiles} file${data.totals.changedFiles === 1 ? "" : "s"}`,
        },
    ];

    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headingText },
        { kind: "keyValue", pairs },
        { kind: "keyValue", pairs: prMetaPairs(data) },
    ];

    if (shown === 0) {
        blocks.push({
            kind: "text",
            text: "This pull request changes no files.",
        });
    } else {
        const cols: ColumnSpec<PrFileEntry>[] = [
            {
                id: "path",
                header: "File",
                type: "code",
                value: (f) =>
                    f.previousPath ? `${f.previousPath} → ${f.path}` : f.path,
            },
            {
                id: "status",
                header: "Status",
                type: "badge",
                value: (f): TableCell => ({
                    text: f.status,
                    badge: fileStatusBadge(f.status),
                }),
            },
            {
                id: "additions",
                header: "+",
                type: "number",
                align: "right",
                value: (f) => f.additions,
            },
            {
                id: "deletions",
                header: "−",
                type: "number",
                align: "right",
                value: (f) => f.deletions,
            },
        ];
        blocks.push(
            buildTableBlock(cols, data.files, {
                sortable: true,
                pageSize: 15,
            }),
        );
    }

    // `changedFiles` is read in an earlier call than the file list, so a push
    // landing in between can leave it equal to what is shown even though more
    // files exist. Only claim a total when it is actually larger.
    if (data.truncated.files) {
        blocks.push({
            kind: "text",
            text:
                data.totals.changedFiles > shown
                    ? `*Showing ${shown} of ${data.totals.changedFiles} changed files. Raise \`maxFiles\` to see more.*`
                    : `*Showing the first ${shown} files; the pull request has more. Raise \`maxFiles\` to see them.*`,
            format: "markdown",
        });
    }

    blocks.push(...patchBlocks(data.files));

    return {
        historyText: headingText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: data }),
    };
}

export async function runPrFiles(
    params: PrFilesAction["parameters"],
    gh: GhRunner,
): Promise<ActionResult> {
    const maxFiles = clampCount(params.maxFiles, FILES_DEFAULT, FILES_MAX);
    const maxPatchLines = clampCount(
        params.maxPatchLines,
        PATCH_LINES_DEFAULT,
        PATCH_LINES_MAX,
    );
    const includePatch = params.includePatch === true;
    const repo = normalizeRepoParam(params.repo);

    const meta = await fetchPrMeta(gh, params.number, repo);
    if (!meta.ok) {
        return createActionResultFromError(meta.error);
    }
    const pr = meta.value;

    const raw = await fetchPrFiles(
        gh,
        pr.ref,
        params.number,
        maxFiles,
        includePatch,
    );
    if (!raw.ok) {
        return createActionResultFromError(raw.error);
    }

    const files = buildFileEntries(
        raw.value.files,
        includePatch,
        maxPatchLines,
    );
    // Two independent signals, either of which means files were left out: the
    // extra file GitHub handed back for this request, and the PR's own
    // changedFiles total (which also covers GitHub capping the files endpoint
    // at 3000 entries).
    const changedFiles = Math.max(pr.changedFiles, files.length);
    const moreFiles = raw.value.hasMore || files.length < changedFiles;
    const data: PrFilesData = {
        kind: "prFiles",
        repo: repoSlug(pr.ref),
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        ...(pr.headRepo !== undefined ? { headRepo: pr.headRepo } : {}),
        fromFork: pr.fromFork,
        totals: {
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles,
        },
        files,
        truncated: {
            files: moreFiles,
            patches: files.some(
                (f) =>
                    f.patchOmitted !== undefined ||
                    f.patchTruncatedLines !== undefined ||
                    f.patchTruncatedChars !== undefined,
            ),
        },
        retrievedAt: new Date().toISOString(),
    };

    return buildStructuredPrFiles(data);
}

// ============================================================================
// prFailedChecks
// ============================================================================

export type CheckCounts = {
    total: number;
    passing: number;
    failing: number;
    pending: number;
    skipping: number;
    cancelled: number;
};

export type CheckAnnotation = {
    // failure | warning | notice
    level: string;
    message: string;
    path?: string;
    startLine?: number;
    endLine?: number;
    title?: string;
};

export type FailedCheckDetail = {
    name: string;
    state: string;
    workflow?: string;
    event?: string;
    description?: string;
    link?: string;
    startedAt?: string;
    completedAt?: string;
    annotations: CheckAnnotation[];
    // More annotations exist on this check than were returned.
    annotationsTruncated: boolean;
    // Why annotations are missing or incomplete, when that is not simply
    // "there are none".
    annotationsUnavailable?: string;
};

export type PrFailedChecksData = {
    kind: "prFailedChecks";
    repo: string;
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    headRepo?: string;
    fromFork: boolean;
    counts: CheckCounts;
    // True while any check is still queued or running. The failing set can
    // still grow, so "nothing else is broken" is not a safe conclusion yet.
    inProgress: boolean;
    failedChecks: FailedCheckDetail[];
    truncated: {
        // More checks failed than were detailed.
        checks: boolean;
    };
    retrievedAt: string;
};

export function countBuckets(checks: Record<string, unknown>[]): CheckCounts {
    const counts: CheckCounts = {
        total: checks.length,
        passing: 0,
        failing: 0,
        pending: 0,
        skipping: 0,
        cancelled: 0,
    };
    for (const check of checks) {
        switch (String(check.bucket ?? "")) {
            case "pass":
                counts.passing++;
                break;
            case "fail":
                counts.failing++;
                break;
            case "pending":
                counts.pending++;
                break;
            case "skipping":
                counts.skipping++;
                break;
            case "cancel":
                counts.cancelled++;
                break;
        }
    }
    return counts;
}

// Only the "fail" bucket is a failure. A cancelled check is reported in the
// counts but not detailed - it has no failure to explain.
export function selectFailedChecks(
    checks: Record<string, unknown>[],
): Record<string, unknown>[] {
    return checks.filter((check) => String(check.bucket ?? "") === "fail");
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

// Failure-level annotations are the ones that explain a red check; warnings
// and notices only get through when there are no failures to show. The level
// is rendered on every row, so a warnings-only result is visibly that.
export function selectAnnotations(
    raw: Record<string, unknown>[],
    maxAnnotations: number,
    morePages = false,
): { annotations: CheckAnnotation[]; truncated: boolean } {
    const mapped: CheckAnnotation[] = raw.map((a) => {
        const message = String(a.message ?? "");
        const annotation: CheckAnnotation = {
            level: String(a.annotation_level ?? "unknown"),
            message:
                message.length > ANNOTATION_MESSAGE_MAX_CHARS
                    ? `${message.slice(0, ANNOTATION_MESSAGE_MAX_CHARS)}…`
                    : message,
        };
        const path = optionalString(a.path);
        if (path !== undefined) {
            annotation.path = path;
        }
        const startLine = optionalNumber(a.start_line);
        if (startLine !== undefined) {
            annotation.startLine = startLine;
        }
        const endLine = optionalNumber(a.end_line);
        if (endLine !== undefined) {
            annotation.endLine = endLine;
        }
        const title = optionalString(a.title);
        if (title !== undefined) {
            annotation.title = title;
        }
        return annotation;
    });
    const failures = mapped.filter((a) => a.level === "failure");
    const chosen = failures.length > 0 ? failures : mapped;
    return {
        annotations: chosen.slice(0, maxAnnotations),
        // Annotations left unread on a later page count as truncation just as
        // much as ones dropped by the cap - otherwise a check whose failures
        // sit past the page budget would claim to be showing all of them.
        truncated: chosen.length > maxAnnotations || morePages,
    };
}

// Read annotations a page at a time, stopping as soon as GitHub runs out or
// the page budget is spent. `morePages` is true only when we stopped with a
// full page in hand, meaning GitHub has more we chose not to read.
//
// A failure part-way through keeps whatever earlier pages returned: a check's
// first-page failures are the useful part, and discarding them because page
// three hit a rate limit would throw away the answer we came for.
async function fetchAnnotationPages(
    gh: GhRunner,
    ref: RepoRef & { checkRunId: string },
): Promise<{
    annotations: Record<string, unknown>[];
    morePages: boolean;
    error?: string;
}> {
    const annotations: Record<string, unknown>[] = [];
    for (let page = 1; page <= ANNOTATIONS_MAX_PAGES; page++) {
        const args = buildAnnotationsArgs(ref, page);
        const res = await gh(args);
        const batch =
            res.exitCode === 0 ? parseJsonArray(res.stdout) : undefined;
        if (batch === undefined) {
            return {
                annotations,
                morePages: true,
                error: describeGhFailure(args, res),
            };
        }
        annotations.push(...batch);
        if (batch.length < ANNOTATIONS_FETCH_PAGE_SIZE) {
            return { annotations, morePages: false };
        }
    }
    return { annotations, morePages: true };
}

async function fetchAnnotations(
    gh: GhRunner,
    link: string | undefined,
    maxAnnotations: number,
): Promise<
    Pick<
        FailedCheckDetail,
        "annotations" | "annotationsTruncated" | "annotationsUnavailable"
    >
> {
    const ref = parseCheckRunRef(link);
    if (ref === undefined) {
        return {
            annotations: [],
            annotationsTruncated: false,
            annotationsUnavailable:
                "This check is not a GitHub check run, so GitHub has no annotations for it. Follow the link for details.",
        };
    }
    const raw = await fetchAnnotationPages(gh, ref);
    const { annotations, truncated } = selectAnnotations(
        raw.annotations,
        maxAnnotations,
        raw.morePages,
    );
    return {
        annotations,
        annotationsTruncated: truncated,
        ...(raw.error !== undefined
            ? { annotationsUnavailable: raw.error }
            : {}),
    };
}

// Run an async mapping with a fixed number of calls in flight, preserving the
// order of the input.
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            while (next < items.length) {
                const index = next++;
                results[index] = await fn(items[index]);
            }
        },
    );
    await Promise.all(workers);
    return results;
}

function annotationBadge(level: string): BadgeTone {
    switch (level) {
        case "failure":
            return "error";
        case "warning":
            return "warning";
        default:
            return "neutral";
    }
}

function annotationLocation(annotation: CheckAnnotation): string {
    if (annotation.path === undefined) {
        return "";
    }
    if (annotation.startLine === undefined) {
        return annotation.path;
    }
    const end =
        annotation.endLine !== undefined &&
        annotation.endLine !== annotation.startLine
            ? `-${annotation.endLine}`
            : "";
    return `${annotation.path}:${annotation.startLine}${end}`;
}

function checkDetailBlocks(check: FailedCheckDetail): StructuredBlock[] {
    const pairs: KeyValuePair[] = [
        { label: "Result", value: { text: check.state, badge: "error" } },
    ];
    if (check.workflow !== undefined) {
        pairs.push({ label: "Workflow", value: check.workflow });
    }
    if (check.event !== undefined) {
        pairs.push({ label: "Event", value: check.event });
    }
    if (check.description !== undefined) {
        pairs.push({ label: "Summary", value: check.description });
    }
    if (check.startedAt !== undefined) {
        pairs.push({ label: "Started", value: check.startedAt });
    }
    if (check.completedAt !== undefined) {
        pairs.push({ label: "Completed", value: check.completedAt });
    }
    if (check.link !== undefined) {
        pairs.push({
            label: "Link",
            value: { text: check.link, href: check.link },
        });
    }

    const blocks: StructuredBlock[] = [
        { kind: "divider" },
        { kind: "heading", level: 3, text: check.name },
        { kind: "keyValue", pairs },
    ];

    if (check.annotations.length > 0) {
        const cols: ColumnSpec<CheckAnnotation>[] = [
            {
                id: "level",
                header: "Level",
                type: "badge",
                value: (a): TableCell => ({
                    text: a.level,
                    badge: annotationBadge(a.level),
                }),
            },
            {
                id: "location",
                header: "Location",
                type: "code",
                value: (a) => annotationLocation(a),
            },
            {
                id: "message",
                header: "Message",
                value: (a) =>
                    a.title ? `${a.title}: ${a.message}` : a.message,
            },
        ];
        blocks.push(
            buildTableBlock(cols, check.annotations, { sortable: false }),
        );
        if (check.annotationsTruncated) {
            blocks.push({
                kind: "text",
                text: "*More annotations exist on this check than are shown. Raise `maxAnnotations`, or follow the link for the full list.*",
                format: "markdown",
            });
        }
        // A partial fetch still shows what it got, but must say it is partial.
        if (check.annotationsUnavailable !== undefined) {
            blocks.push({
                kind: "text",
                text: `*Annotations are incomplete: ${check.annotationsUnavailable}*`,
                format: "markdown",
            });
        }
    } else {
        blocks.push({
            kind: "text",
            text:
                check.annotationsUnavailable ??
                "GitHub recorded no annotations for this check.",
        });
    }
    return blocks;
}

export function buildStructuredPrFailedChecks(
    data: PrFailedChecksData,
): ActionResultSuccess {
    const { failing } = data.counts;
    const headingText = `#${data.number} ${data.title} — ${failing} failing check${failing === 1 ? "" : "s"}`;

    const pairs: KeyValuePair[] = [
        {
            label: "Checks",
            value: `${data.counts.passing} passing, ${data.counts.failing} failing, ${data.counts.pending} pending, ${data.counts.skipping} skipped, ${data.counts.cancelled} cancelled`,
        },
    ];

    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headingText },
        { kind: "keyValue", pairs },
        { kind: "keyValue", pairs: prMetaPairs(data) },
    ];

    if (data.inProgress) {
        blocks.push({
            kind: "text",
            text: `*${data.counts.pending} check${data.counts.pending === 1 ? " is" : "s are"} still running, so more may yet fail.*`,
            format: "markdown",
        });
    }

    if (failing === 0) {
        blocks.push({
            kind: "text",
            text: "No checks are failing on this pull request.",
        });
    }

    for (const check of data.failedChecks) {
        blocks.push(...checkDetailBlocks(check));
    }

    if (data.truncated.checks) {
        blocks.push({
            kind: "text",
            text: `*Showing ${data.failedChecks.length} of ${failing} failing checks. Raise \`maxChecks\` to see more.*`,
            format: "markdown",
        });
    }

    return {
        historyText: headingText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: data }),
    };
}

// Copy a value onto the target only when it is a non-empty string, so a field
// gh reported as "" (common for third-party status descriptions) is absent
// rather than blank.
function assignOptionalString(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    const str = optionalString(value);
    if (str !== undefined) {
        target[key] = str;
    }
}

function toFailedCheckDetail(
    check: Record<string, unknown>,
    annotations: Pick<
        FailedCheckDetail,
        "annotations" | "annotationsTruncated" | "annotationsUnavailable"
    >,
): FailedCheckDetail {
    const detail: Record<string, unknown> = {
        name: optionalString(check.name) ?? "(unnamed check)",
        state: optionalString(check.state) ?? "FAILURE",
        ...annotations,
    };
    for (const key of [
        "workflow",
        "event",
        "description",
        "link",
        "startedAt",
        "completedAt",
    ]) {
        assignOptionalString(detail, key, check[key]);
    }
    return detail as unknown as FailedCheckDetail;
}

export async function runPrFailedChecks(
    params: PrFailedChecksAction["parameters"],
    gh: GhRunner,
): Promise<ActionResult> {
    const maxChecks = clampCount(params.maxChecks, CHECKS_DEFAULT, CHECKS_MAX);
    const maxAnnotations = clampCount(
        params.maxAnnotations,
        ANNOTATIONS_DEFAULT,
        ANNOTATIONS_MAX,
    );

    // `gh pr checks` is addressed by PR number and repo, exactly like
    // `gh pr view`, so neither call depends on the other's result.
    const repo = normalizeRepoParam(params.repo);
    const checksArgs = buildPrChecksArgs(params.number, repo);
    const [meta, checksRes] = await Promise.all([
        fetchPrMeta(gh, params.number, repo),
        gh(checksArgs),
    ]);
    if (!meta.ok) {
        return createActionResultFromError(meta.error);
    }
    const pr = meta.value;

    // `gh pr checks` exits non-zero when checks fail or are pending, so the
    // JSON on stdout - not the exit code - decides whether the call worked.
    const checks = parseJsonArray(checksRes.stdout);
    if (checks === undefined) {
        if (/no checks reported/i.test(checksRes.stderr)) {
            return buildStructuredPrFailedChecks({
                ...prFailedChecksBase(pr),
                counts: {
                    total: 0,
                    passing: 0,
                    failing: 0,
                    pending: 0,
                    skipping: 0,
                    cancelled: 0,
                },
                inProgress: false,
                failedChecks: [],
                truncated: { checks: false },
                retrievedAt: new Date().toISOString(),
            });
        }
        return createActionResultFromError(
            describeGhFailure(checksArgs, checksRes),
        );
    }

    const counts = countBuckets(checks);
    const failed = selectFailedChecks(checks);
    const detailed = failed.slice(0, maxChecks);

    // Each failing check's annotations are independent, so fetch them with a
    // few calls in flight rather than one round trip at a time.
    const failedChecks = await mapWithConcurrency(
        detailed,
        ANNOTATIONS_FETCH_CONCURRENCY,
        async (check) =>
            toFailedCheckDetail(
                check,
                await fetchAnnotations(
                    gh,
                    optionalString(check.link),
                    maxAnnotations,
                ),
            ),
    );

    const data: PrFailedChecksData = {
        ...prFailedChecksBase(pr),
        counts,
        inProgress: counts.pending > 0,
        failedChecks,
        truncated: { checks: failed.length > detailed.length },
        retrievedAt: new Date().toISOString(),
    };

    return buildStructuredPrFailedChecks(data);
}

function prFailedChecksBase(
    pr: PrMeta,
): Omit<
    PrFailedChecksData,
    "counts" | "inProgress" | "failedChecks" | "truncated" | "retrievedAt"
> {
    return {
        kind: "prFailedChecks",
        repo: repoSlug(pr.ref),
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        ...(pr.headRepo !== undefined ? { headRepo: pr.headRepo } : {}),
        fromFork: pr.fromFork,
    };
}
