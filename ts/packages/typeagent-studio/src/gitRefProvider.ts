// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host-side git ref enumeration for the Impact Report version pickers.
 *
 * The webview never shells out to git (the security boundary); the extension
 * host enumerates branches/tags/commits here and offers them through a native
 * VS Code QuickPick. Every git call is read-only (`rev-parse`, `for-each-ref`,
 * `log`). The exec function is injected so the parsing is unit-testable without
 * a real repository.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VersionSpec } from "@typeagent/core/replay";
import type {
    ResolvedVersion,
    VersionProvenance,
} from "./webviewKit/replayViewModel.js";

const execFileAsync = promisify(execFile);

/** Runs `git -C <repoRoot> <args>` and resolves with raw stdout. */
export type GitExec = (args: string[]) => Promise<string>;

/** A real git runner rooted at `repoRoot`. */
export function defaultGitExec(repoRoot: string): GitExec {
    return async (args) => {
        const { stdout } = await execFileAsync(
            "git",
            ["-C", repoRoot, ...args],
            {
                maxBuffer: 16 * 1024 * 1024,
            },
        );
        return stdout;
    };
}

/** Cap recent-commit enumeration so a deep history stays a snappy QuickPick. */
const RECENT_COMMIT_LIMIT = 30;
/** Field separator embedded in git format strings (ASCII unit separator). */
const FS = "\u001f";

function lines(stdout: string): string[] {
    return stdout
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0);
}

/** Run a git command, resolving with its stdout or `undefined` if it fails, so
 *  one unreadable section never sinks the whole enumeration. */
async function tryExec(
    exec: GitExec,
    args: string[],
): Promise<string | undefined> {
    try {
        return await exec(args);
    } catch {
        return undefined;
    }
}

/** Pull the current branch name out of a `git log %D` decoration, e.g.
 *  "HEAD -> main, origin/main, tag: v1" → "main". A detached HEAD ("HEAD, …")
 *  has no `HEAD -> ` segment and yields undefined. */
function parseCurrentBranch(
    decoration: string | undefined,
): string | undefined {
    if (!decoration) {
        return undefined;
    }
    const head = decoration
        .split(",")
        .map((s) => s.trim())
        .find((s) => s.startsWith("HEAD -> "));
    return head ? head.slice("HEAD -> ".length).trim() : undefined;
}

const WORKING_TREE: ResolvedVersion = {
    spec: { kind: "workingTree" },
    label: "working tree",
    tooltip: "Your uncommitted edits in the working tree.",
};

/**
 * Enumerate the local versions a user can compare, ordered for the QuickPick:
 * working tree, HEAD, the current branch, other branches (most-recent first),
 * tags, then recent commits. Remote-tracking branches are intentionally excluded
 * (see {@link listRemoteRefs}) to keep this fast and the list short.
 *
 * Spawning git is the dominant cost (each process is expensive), so this issues
 * exactly **two** parallel calls: one `git log` that yields HEAD + the current
 * branch + recent commits, and one `git for-each-ref` that yields branches and
 * tags together. Resilient — a call that fails is skipped and the working tree
 * is always offered.
 */
export async function listVersionRefs(
    exec: GitExec,
): Promise<ResolvedVersion[]> {
    const [headLog, refRows] = await Promise.all([
        // First line is HEAD (its %D decoration names the current branch); all
        // lines are the recent-commit list.
        tryExec(exec, [
            "log",
            "-n",
            String(RECENT_COMMIT_LIMIT),
            `--format=%h${FS}%s${FS}%D`,
        ]),
        // Branches and tags in one pass; the full %(refname) classifies each.
        tryExec(exec, [
            "for-each-ref",
            "--sort=-committerdate",
            `--format=%(refname)${FS}%(refname:short)${FS}%(objectname:short)${FS}%(contents:subject)`,
            "refs/heads",
            "refs/tags",
        ]),
    ]);

    const refs: ResolvedVersion[] = [WORKING_TREE];

    const commitLines = headLog !== undefined ? lines(headLog) : [];
    let currentBranch: string | undefined;
    if (commitLines.length > 0) {
        const [sha, subject, decoration] = commitLines[0].split(FS);
        currentBranch = parseCurrentBranch(decoration);
        refs.push({
            spec: { kind: "git", ref: "HEAD" },
            label: currentBranch ? `HEAD (${currentBranch})` : "HEAD",
            tooltip: currentBranch
                ? `Last commit on ${currentBranch} \u2014 ${sha} ${subject ?? ""}`.trim()
                : `Last commit (detached) \u2014 ${sha} ${subject ?? ""}`.trim(),
        });
    }

    const branches: { name: string; sha: string; subject: string }[] = [];
    const tags: { name: string; sha: string; subject: string }[] = [];
    if (refRows !== undefined) {
        for (const line of lines(refRows)) {
            const [fullRef, name, sha, subject] = line.split(FS);
            if (!name) continue;
            const entry = { name, sha, subject: subject ?? "" };
            if (fullRef.startsWith("refs/heads/")) {
                branches.push(entry);
            } else if (fullRef.startsWith("refs/tags/")) {
                tags.push(entry);
            }
        }
    }

    // Current branch first so the most likely pick is at the top.
    branches.sort((a, b) => {
        if (a.name === currentBranch) return -1;
        if (b.name === currentBranch) return 1;
        return 0;
    });
    for (const b of branches) {
        const isCurrent = b.name === currentBranch;
        refs.push({
            spec: { kind: "git", ref: b.name },
            label: isCurrent ? `${b.name} (current)` : b.name,
            tooltip: `Branch ${b.name} \u2014 ${b.sha} ${b.subject}`.trim(),
        });
    }
    for (const t of tags) {
        refs.push({
            spec: { kind: "git", ref: t.name },
            label: t.name,
            tooltip: `Tag ${t.name} \u2014 ${t.sha} ${t.subject}`.trim(),
        });
    }

    for (const line of commitLines) {
        const [sha, subject] = line.split(FS);
        if (!sha) continue;
        const subj = subject ?? "";
        refs.push({
            spec: { kind: "git", ref: sha },
            label: subj ? `${sha} ${subj}` : sha,
            tooltip: `Commit ${sha} \u2014 ${subj}`.trim(),
        });
    }

    return refs;
}

/**
 * Enumerate remote-tracking branches (`refs/remotes`) the repo already knows
 * about — local-only, no network `git fetch`. Loaded on demand (and cached by
 * the caller) because a busy remote can have hundreds of branches that would
 * bloat and slow the default version list. The symbolic `<remote>/HEAD` pointer
 * is filtered out.
 */
export async function listRemoteRefs(
    exec: GitExec,
): Promise<ResolvedVersion[]> {
    const out = await tryExec(exec, [
        "for-each-ref",
        "--sort=-committerdate",
        `--format=%(refname:short)${FS}%(objectname:short)${FS}%(contents:subject)`,
        "refs/remotes",
    ]);
    if (out === undefined) {
        return [];
    }
    const refs: ResolvedVersion[] = [];
    for (const line of lines(out)) {
        const [name, sha, subject] = line.split(FS);
        if (!name || name.endsWith("/HEAD")) {
            // Skip the symbolic origin/HEAD pointer.
            continue;
        }
        refs.push({
            spec: { kind: "git", ref: name },
            label: name,
            tooltip:
                `Remote branch ${name} \u2014 ${sha} ${subject ?? ""}`.trim(),
        });
    }
    return refs;
}

/**
 * Validate and resolve a free-form ref the user typed (a commit SHA, tag, branch,
 * or a relative ref like `HEAD~3`). Returns a {@link ResolvedVersion} pinned to
 * the entered ref, or `undefined` if git can't resolve it to a commit. The
 * `^{commit}` peel makes annotated tags resolve to their commit; `--` guards
 * against a ref that collides with a path name. A single git spawn does both the
 * existence check and the subject lookup.
 */
export async function resolveRef(
    exec: GitExec,
    ref: string,
): Promise<ResolvedVersion | undefined> {
    const input = ref.trim();
    if (input.length === 0) {
        return undefined;
    }
    const out = await tryExec(exec, [
        "log",
        "-n",
        "1",
        `--format=%h${FS}%s`,
        `${input}^{commit}`,
        "--",
    ]);
    if (out === undefined) {
        return undefined;
    }
    const [first] = lines(out);
    if (!first) {
        return undefined;
    }
    const [sha, subject] = first.split(FS);
    if (!sha) {
        return undefined;
    }
    const subj = subject ?? "";
    return {
        spec: { kind: "git", ref: input },
        label: subj ? `${input} \u2014 ${subj}` : input,
        tooltip: `Commit ${sha} \u2014 ${subj}`.trim(),
    };
}

/**
 * Resolve the concrete identity a side will run against, captured at run time.
 * A git ref is pinned to its short SHA (so a later branch move doesn't make the
 * report lie); the working tree records the HEAD it sits on plus the live marker.
 * Resolution failures degrade to a label-only provenance rather than throwing.
 */
export async function resolveVersionProvenance(
    spec: VersionSpec,
    exec: GitExec,
): Promise<VersionProvenance> {
    if (spec.kind === "workingTree") {
        const base: VersionProvenance = {
            label: "working tree",
            workingTree: true,
        };
        try {
            const sha = (await exec(["rev-parse", "--short", "HEAD"])).trim();
            return sha ? { ...base, sha } : base;
        } catch {
            return base;
        }
    }
    const base: VersionProvenance = { label: spec.ref, workingTree: false };
    try {
        const sha = (await exec(["rev-parse", "--short", spec.ref])).trim();
        return sha ? { ...base, sha } : base;
    } catch {
        return base;
    }
}
