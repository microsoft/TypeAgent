// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Close the loop. Read `patterns.jsonl`, filter to winners, group by
// `(mechanism, guidelineHook)`, sample evidence from each group's
// `proposal.json` files, and call an LLM with the current
// `schemaGuidelines` as context to propose candidate additions.
//
// The operator reviews `schemaGuidelines.candidates.md` and promotes by
// hand into the canonical `schemaGuidelines` constant. After promotion,
// the next `explore` run reads the updated text automatically — the
// constant is imported by every lever's propose prompt and by the case
// analyzer's LLM-refinement step.
//
// Defensive design:
//   - Gates on `--min-attempts` (default 10) on total winner count.
//   - Groups under 3 winners are dropped — every candidate cites ≥3
//     sample attempts per acceptance criterion.
//   - LLM responses go through `extractJSON` + shape validation. Garbage
//     responses produce an empty candidates list rather than hallucination.
//   - Sample evaluation paths are validated against the filesystem
//     before citing — stale or moved attempt dirs are filtered out.

import * as fs from "node:fs";
import * as path from "node:path";

import type { ChatModel } from "aiclient";
import type { GuidelineHook, Mechanism } from "./types.js";
import { parsePatternsJsonl, type PatternRow } from "./patternMiner.js";
import { extractJSON } from "./util.js";

// =============================================================================
// Public types
// =============================================================================

export interface GuidelineCandidate {
    /** Short candidate title. */
    title: string;
    /** Which existing `schemaGuidelines` section this candidate extends.
     *  Matches the guidelineHook enum or "new-section" when the LLM
     *  proposes a fresh section. */
    extendsSection: string;
    /** Mechanism the candidate generalizes from. */
    mechanism: Mechanism;
    /** Optional guidelineHook the underlying winners referenced. */
    guidelineHook: GuidelineHook;
    /** Proposed text to add. Plain markdown — no front-matter. */
    proposedText: string;
    /** Supporting evidence stats + sample attempt paths. */
    evidence: {
        winnerCount: number;
        /** Distinct neighborhoods (across runs) where this mechanism won. */
        distinctNeighborhoods: number;
        /** Up to N sample attempt paths the operator can drill into. */
        samplePaths: string[];
    };
}

export interface GuidelineCandidatesReport {
    schemaVersion: 1;
    builtAt: string;
    inputs: { patternsFile: string };
    /** The minAttempts gate that was applied. */
    minAttempts: number;
    /** Total winners considered before grouping. */
    totalWinners: number;
    /** Total attempts in patterns.jsonl. */
    totalAttempts: number;
    /** Distill verdict. */
    status: "completed" | "not-enough-data";
    /** Free-text reason — populated when status === "not-enough-data". */
    statusReason?: string;
    candidates: GuidelineCandidate[];
}

export interface DistillOpts {
    /** Absolute path to `<workdir>/patterns.jsonl`. */
    patternsFile: string;
    /** Total winner threshold. Below this, the distiller returns
     *  `not-enough-data` and emits no candidates. Default 10. */
    minAttempts?: number;
    /** Per-group winner threshold. Groups below this are dropped before
     *  the LLM is called. Default 3 — matches the acceptance criterion
     *  "each candidate cites at least 3 sample patches." */
    minPerGroup?: number;
    /** Up to this many sample attempts are read per group and included
     *  in the LLM prompt. Default 5. */
    samplesPerGroup?: number;
    /** Up to this many candidates are returned. Default 6 — keeps the
     *  candidates.md readable. */
    maxCandidates?: number;
    /** Canonical schemaGuidelines text — given to the LLM as context so
     *  it knows what's already documented. */
    schemaGuidelines: string;
    /** ChatModel factory. Tests pass a mock. */
    createModel: (name: string) => ChatModel;
}

const ALL_GUIDELINE_HOOKS: Exclude<GuidelineHook, null>[] = [
    "schema-shape-work-with-llm-intent",
    "critical-constraint-format",
    "identity-line-closest",
    "property-comment-ordering",
    "enum-like-properties",
];

// =============================================================================
// Public API
// =============================================================================

export async function distillGuidelineCandidates(
    opts: DistillOpts,
): Promise<GuidelineCandidatesReport> {
    const minAttempts = opts.minAttempts ?? 10;
    const minPerGroup = opts.minPerGroup ?? 3;
    const samplesPerGroup = opts.samplesPerGroup ?? 5;
    const maxCandidates = opts.maxCandidates ?? 6;

    if (!fs.existsSync(opts.patternsFile)) {
        return {
            schemaVersion: 1,
            builtAt: new Date().toISOString(),
            inputs: { patternsFile: opts.patternsFile },
            minAttempts,
            totalWinners: 0,
            totalAttempts: 0,
            status: "not-enough-data",
            statusReason: `patterns.jsonl not found at ${opts.patternsFile}`,
            candidates: [],
        };
    }

    const content = fs.readFileSync(opts.patternsFile, "utf-8");
    const rows = parsePatternsJsonl(content);
    const winners = rows.filter((r) => r.isWinner === true);

    if (winners.length < minAttempts) {
        return {
            schemaVersion: 1,
            builtAt: new Date().toISOString(),
            inputs: { patternsFile: opts.patternsFile },
            minAttempts,
            totalWinners: winners.length,
            totalAttempts: rows.length,
            status: "not-enough-data",
            statusReason: `${winners.length} winner(s) accumulated; --min-attempts=${minAttempts}`,
            candidates: [],
        };
    }

    // Group by (mechanism, guidelineHook).
    const groups = groupWinners(winners);
    const viableGroups = [...groups.values()].filter(
        (g) => g.winners.length >= minPerGroup,
    );

    if (viableGroups.length === 0) {
        return {
            schemaVersion: 1,
            builtAt: new Date().toISOString(),
            inputs: { patternsFile: opts.patternsFile },
            minAttempts,
            totalWinners: winners.length,
            totalAttempts: rows.length,
            status: "not-enough-data",
            statusReason: `no (mechanism, guidelineHook) group has ≥${minPerGroup} winners`,
            candidates: [],
        };
    }

    // Sort groups by winner-count desc so the most-frequent mechanisms
    // get distilled first; we cap at maxCandidates.
    viableGroups.sort((a, b) => b.winners.length - a.winners.length);
    const groupsToDistill = viableGroups.slice(0, maxCandidates);

    const candidates: GuidelineCandidate[] = [];
    for (const group of groupsToDistill) {
        const candidate = await distillGroup(
            group,
            samplesPerGroup,
            opts.schemaGuidelines,
            opts.createModel,
        );
        if (candidate) candidates.push(candidate);
    }

    return {
        schemaVersion: 1,
        builtAt: new Date().toISOString(),
        inputs: { patternsFile: opts.patternsFile },
        minAttempts,
        totalWinners: winners.length,
        totalAttempts: rows.length,
        status: candidates.length > 0 ? "completed" : "not-enough-data",
        ...(candidates.length === 0 && {
            statusReason:
                "all group distillations returned empty or invalid responses",
        }),
        candidates,
    };
}

// =============================================================================
// Grouping
// =============================================================================

interface WinnerGroup {
    mechanism: Mechanism;
    guidelineHook: GuidelineHook;
    winners: PatternRow[];
}

function groupWinners(winners: PatternRow[]): Map<string, WinnerGroup> {
    const map = new Map<string, WinnerGroup>();
    for (const w of winners) {
        const key = `${w.mechanism}\0${w.guidelineHook ?? "null"}`;
        let group = map.get(key);
        if (!group) {
            group = {
                mechanism: w.mechanism,
                guidelineHook: w.guidelineHook as GuidelineHook,
                winners: [],
            };
            map.set(key, group);
        }
        group.winners.push(w);
    }
    return map;
}

// =============================================================================
// Per-group distillation
// =============================================================================

interface LLMCandidateResponse {
    title?: string;
    extendsSection?: string;
    proposedText?: string;
}

async function distillGroup(
    group: WinnerGroup,
    samplesPerGroup: number,
    schemaGuidelines: string,
    createModel: (name: string) => ChatModel,
): Promise<GuidelineCandidate | null> {
    // Sample winners — prefer rows whose attempt dir still exists on
    // disk (filters stale references after a workdir move).
    const samples = pickSamples(group.winners, samplesPerGroup);
    if (samples.length === 0) return null;

    // Read each sample's proposal.json if present — gives the LLM
    // concrete rationale text to draw from. Falls back to the
    // patterns.jsonl row data when proposal.json is unavailable.
    const enriched = samples.map((row) => ({
        row,
        proposal: readProposal(row.evaluationPath),
    }));

    const distinctNeighborhoods = new Set(
        group.winners.map((w) => w.neighborhoodId),
    ).size;

    const prompt = buildDistillPrompt({
        group,
        enriched,
        distinctNeighborhoods,
        schemaGuidelines,
    });

    const model = createModel("propose");
    const result = await model.complete(prompt);
    if (!result.success) {
        return null;
    }
    const parsed = extractJSON<LLMCandidateResponse>(result.data);
    if (
        !parsed ||
        typeof parsed.proposedText !== "string" ||
        parsed.proposedText.trim().length === 0
    ) {
        return null;
    }

    return {
        title: parsed.title?.trim() || defaultTitle(group),
        extendsSection: coerceExtendsSection(parsed.extendsSection, group),
        mechanism: group.mechanism,
        guidelineHook: group.guidelineHook,
        proposedText: parsed.proposedText.trim(),
        evidence: {
            winnerCount: group.winners.length,
            distinctNeighborhoods,
            samplePaths: samples.map((s) => s.evaluationPath),
        },
    };
}

function pickSamples(winners: PatternRow[], cap: number): PatternRow[] {
    // Sort by net-delta desc (the "best" wins first), de-dup by
    // neighborhoodId so we don't sample the same case repeatedly.
    const sorted = [...winners].sort((a, b) => b.netDelta - a.netDelta);

    // Prefer rows whose evaluation dir still exists on disk (filters
    // stale references after a workdir move). But fall back to all
    // winners when none have a valid path — the LLM still benefits from
    // the row metadata, and the operator can resolve stale paths
    // manually from the markdown.
    const hasAnyValidPath = sorted.some(
        (w) => w.evaluationPath && fs.existsSync(w.evaluationPath),
    );
    const filterByPath = hasAnyValidPath;

    const out: PatternRow[] = [];
    const seenNeighborhoods = new Set<string>();
    for (const w of sorted) {
        if (out.length >= cap) break;
        if (seenNeighborhoods.has(w.neighborhoodId)) continue;
        if (
            filterByPath &&
            w.evaluationPath &&
            !fs.existsSync(w.evaluationPath)
        ) {
            continue;
        }
        out.push(w);
        seenNeighborhoods.add(w.neighborhoodId);
    }
    return out;
}

function readProposal(attemptPath: string): unknown | undefined {
    if (!attemptPath) return undefined;
    const proposalFile = path.join(attemptPath, "proposal.json");
    if (!fs.existsSync(proposalFile)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(proposalFile, "utf-8"));
    } catch {
        return undefined;
    }
}

function defaultTitle(group: WinnerGroup): string {
    const hook = group.guidelineHook ?? "no-hook";
    return `${group.mechanism} pattern (${hook})`;
}

function coerceExtendsSection(raw: unknown, group: WinnerGroup): string {
    if (typeof raw === "string" && raw.length > 0) {
        if (ALL_GUIDELINE_HOOKS.includes(raw as any) || raw === "new-section") {
            return raw;
        }
    }
    return group.guidelineHook ?? "new-section";
}

// =============================================================================
// Prompt
// =============================================================================

interface BuildDistillPromptOpts {
    group: WinnerGroup;
    enriched: {
        row: PatternRow;
        proposal: unknown | undefined;
    }[];
    distinctNeighborhoods: number;
    schemaGuidelines: string;
}

function buildDistillPrompt(opts: BuildDistillPromptOpts): string {
    const sampleBlocks = opts.enriched
        .map((e, i) => formatSampleBlock(i + 1, e.row, e.proposal))
        .join("\n\n");

    return `You are mining successful translator-collision fixes for candidate additions to a shared schema-authoring guidelines document.

CURRENT schemaGuidelines (do NOT duplicate any text already covered here):
"""
${opts.schemaGuidelines}
"""

This pattern fired across ${opts.group.winners.length} winning attempts in ${opts.distinctNeighborhoods} distinct neighborhood(s). Each winner used:

  mechanism: ${opts.group.mechanism}
  guidelineHook: ${opts.group.guidelineHook ?? "(none)"}

Sample winning attempts (lever, target, rationale where available):

${sampleBlocks}

Task: write a NEW guideline entry that captures the pattern these winners share. The text should be:

1. PRESCRIPTIVE — tell future schema authors what to do, not what these particular winners did. Generalize.
2. CONCRETE — include a concrete example (use generic placeholders like SalesData, playTrack, sendEmail — never real user phrases).
3. ALIGNED with the "WORK WITH THE LLM'S INTENT" principle in the existing schemaGuidelines. Avoid anti-examples; channel positive intent.
4. NON-DUPLICATIVE — do not repeat anything already in the current schemaGuidelines above.
5. SHORT — 2-4 sentences plus optionally one example code block.

Return JSON only:

{
  "title": "<6-10 word title>",
  "extendsSection": "<one of: schema-shape-work-with-llm-intent, critical-constraint-format, identity-line-closest, property-comment-ordering, enum-like-properties, new-section>",
  "proposedText": "<the new guideline text, plain markdown>"
}`;
}

function formatSampleBlock(
    idx: number,
    row: PatternRow,
    proposal: unknown | undefined,
): string {
    const header = `Sample ${idx}: lever=${row.lever} target=${row.schemaName}.${row.actionName} rescues=${row.rescues} regressions=${row.regressions}`;
    let rationale = "";
    if (
        proposal &&
        typeof proposal === "object" &&
        proposal !== null &&
        "rationale" in proposal
    ) {
        const r = (proposal as any).rationale;
        if (r && typeof r === "object" && typeof r.free === "string") {
            rationale = `\n  rationale: ${r.free}`;
        }
    }
    let payloadHint = "";
    if (
        proposal &&
        typeof proposal === "object" &&
        proposal !== null &&
        "payload" in proposal
    ) {
        const p = (proposal as any).payload;
        // Surface only the user-visible field if it's a short string —
        // skip large embedded structures (we don't want to flood the
        // prompt with full schema texts).
        if (p && typeof p === "object") {
            const interesting = ["newText", "newDescription"];
            for (const k of interesting) {
                const v = p[k];
                if (typeof v === "string" && v.length < 400) {
                    payloadHint = `\n  edit: ${v.replace(/\s+/g, " ").trim().slice(0, 200)}`;
                    break;
                }
            }
        }
    }
    return `${header}${rationale}${payloadHint}`;
}
