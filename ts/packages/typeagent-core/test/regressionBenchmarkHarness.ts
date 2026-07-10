// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Harness that turns hand-authored grammar variants into genuine action deltas
// by running the real grammar replay resolver over the committed player corpus.
// Each variant is materialized as a throwaway git commit (built with plumbing,
// no working-tree mutation) whose only difference from HEAD is the player
// grammar file; the resolver then reads HEAD and the variant with `git show`,
// so the deltas come from the real matcher rather than being written by hand.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusEntry } from "../src/corpus/types.js";
import { actionsEqual } from "../src/replay/engine.js";
import {
    createGrammarReplayResolver,
    resolveGrammarReplayTarget,
    type GrammarReplayTarget,
} from "../src/replay/grammarResolver.js";
import type { VersionSpec } from "../src/replay/types.js";

/** Git path of the player grammar, relative to the repository top level. */
export const PLAYER_GRAMMAR_GIT_PATH =
    "ts/packages/agents/player/src/agent/playerSchema.agr";

/** Package root (`ts/packages/typeagent-core`). The compiled harness runs from
 *  `dist/test`, so the package root is two levels above it. */
const PKG_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
);

/**
 * Absolute repository top level (the git working copy root), derived from this
 * module's location rather than `git rev-parse` so the measurement tests can
 * locate the committed fixtures without a git executable and without a
 * shell-out at import time. The git-backed authenticity tests guard themselves
 * separately via {@link gitAvailable}.
 */
export const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..", "..");

/** The `ts` monorepo root, where agent packages live under `packages/agents`. */
export const TS_ROOT = path.join(REPO_ROOT, "ts");

/** Directory holding the hand-authored variant grammars. */
export const VARIANTS_DIR = path.join(
    TS_ROOT,
    "packages",
    "typeagent-core",
    "test",
    "fixtures",
    "regression-variants",
);

/** Path of the committed player corpus that every variant replays over. */
export const PLAYER_CORPUS_PATH = path.join(
    REPO_ROOT,
    "ts",
    "corpus",
    "player.utterances.jsonl",
);

/** Path of the committed, blind-labelled benchmark delta set. */
export const BENCHMARK_PATH = path.join(
    REPO_ROOT,
    "ts",
    "corpus",
    "player.regression-benchmark.jsonl",
);

function git(args: string[], env?: NodeJS.ProcessEnv): string {
    return execFileSync("git", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: env ?? process.env,
    }).trim();
}

/** True when a `git` executable is available (harness is skipped otherwise). */
export function gitAvailable(): boolean {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Build a commit whose tree equals HEAD except that the player grammar file is
 * replaced by `variantAgrAbsPath`. Uses a throwaway index so the working tree
 * and the real index are untouched. The commit is reachable as a parent of the
 * returned SHA, so `git show <sha>:<path>` resolves without creating a ref.
 */
export function buildVariantCommit(variantAgrAbsPath: string): string {
    const blob = git([
        "hash-object",
        "-w",
        "--path",
        PLAYER_GRAMMAR_GIT_PATH,
        variantAgrAbsPath,
    ]);
    const indexFile = path.join(
        tmpdir(),
        `rgbench-index-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    // Pin the committer/author identity so `commit-tree` succeeds even when the
    // environment has no configured git user (e.g. a fresh CI runner). Only the
    // resulting tree content is read back, so the exact identity is irrelevant;
    // the host name is used for the email domain so a stray commit object is
    // traceable to the machine that produced it.
    const host = hostname() || "localhost";
    const identityEmail = `regression-benchmark@${host}`;
    const env = {
        ...process.env,
        GIT_INDEX_FILE: indexFile,
        GIT_AUTHOR_NAME: "regression-benchmark",
        GIT_AUTHOR_EMAIL: identityEmail,
        GIT_COMMITTER_NAME: "regression-benchmark",
        GIT_COMMITTER_EMAIL: identityEmail,
    };
    try {
        git(["read-tree", "HEAD"], env);
        git(
            [
                "update-index",
                "--add",
                "--cacheinfo",
                `100644,${blob},${PLAYER_GRAMMAR_GIT_PATH}`,
            ],
            env,
        );
        const tree = git(["write-tree"], env);
        return git(
            ["commit-tree", tree, "-p", "HEAD", "-m", "regression variant"],
            env,
        );
    } finally {
        rmSync(indexFile, { force: true });
    }
}

/** Read and parse the player corpus (one JSON object per line). */
export function loadPlayerCorpus(): CorpusEntry[] {
    return readFileSync(PLAYER_CORPUS_PATH, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as CorpusEntry);
}

/** Resolve the real player grammar target (grammar + action schema). */
export async function resolvePlayerTarget(): Promise<GrammarReplayTarget> {
    const target = await resolveGrammarReplayTarget(
        [path.join(TS_ROOT, "packages", "agents")],
        "player",
        TS_ROOT,
    );
    if (target === undefined) {
        throw new Error("could not resolve the player grammar target");
    }
    return target;
}

export interface DeltaRow {
    rowId: string;
    variant: string;
    corpusId: string;
    utterance: string;
    tags: string[];
    expectedAction: unknown;
    actionA: unknown;
    actionB: unknown;
    classification: "changed" | "lost" | "gained";
}

/** The variant fixtures that make up the benchmark, in a stable order. */
export const BENCHMARK_VARIANTS = [
    "v1-lost-transport",
    "v2-lost-track-number",
    "v4-skip-to-previous",
    "v5-gained-good",
    "v6-over-broad-genre",
    "v9-wrong-enrichment",
];

/**
 * Regenerate the full benchmark delta set from the variant fixtures by running
 * the real resolver over the corpus for every variant. Returns the rows in
 * variant order (matching {@link BENCHMARK_VARIANTS}).
 */
export async function generateAllDeltas(): Promise<DeltaRow[]> {
    const corpus = loadPlayerCorpus();
    const target = await resolvePlayerTarget();
    const all: DeltaRow[] = [];
    for (const variant of BENCHMARK_VARIANTS) {
        const commit = buildVariantCommit(
            path.join(VARIANTS_DIR, `${variant}.agr`),
        );
        all.push(
            ...(await generateVariantDeltas(target, variant, commit, corpus)),
        );
    }
    return all;
}

/**
 * Replay every corpus entry through HEAD (side A) and the variant commit
 * (side B) and return the rows whose action differs between the two versions.
 */
export async function generateVariantDeltas(
    target: GrammarReplayTarget,
    variantName: string,
    variantCommit: string,
    corpus: CorpusEntry[],
): Promise<DeltaRow[]> {
    const baseVersion: VersionSpec = { kind: "git", ref: "HEAD" };
    const variantVersion: VersionSpec = { kind: "git", ref: variantCommit };
    const resolver = createGrammarReplayResolver({ target });
    await resolver.prepare(baseVersion, variantVersion);

    const rows: DeltaRow[] = [];
    for (const entry of corpus) {
        const a = await resolver.resolve(entry, baseVersion, "A");
        const b = await resolver.resolve(entry, variantVersion, "B");
        const actionA = a.action;
        const actionB = b.action;
        if (actionsEqual(actionA, actionB)) {
            continue;
        }
        const hasA = actionA !== undefined;
        const hasB = actionB !== undefined;
        const classification: DeltaRow["classification"] =
            hasA && hasB ? "changed" : hasB ? "gained" : "lost";
        rows.push({
            rowId: `${variantName}:${entry.id}`,
            variant: variantName,
            corpusId: entry.id,
            utterance: entry.utterance,
            tags: entry.tags ?? [],
            expectedAction: entry.expectedAction,
            actionA: actionA ?? null,
            actionB: actionB ?? null,
            classification,
        });
    }
    return rows;
}
