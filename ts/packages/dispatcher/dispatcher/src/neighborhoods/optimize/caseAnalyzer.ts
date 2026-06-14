// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Convert one `Neighborhood` plus the surrounding translation/probe data
// into a fully-populated `CaseDescription` that the case loop hands to each
// lever's `proposeHypotheses`.
//
// `FailurePattern` classification is two-stage:
//   1. Heuristic: lexical/structural rules over action and schema names.
//      Cheap, deterministic, recorded as `failurePatternHeuristic`.
//   2. LLM refinement: the heuristic label + the case description + the
//      shared `schemaGuidelines` are sent to a chat model, which returns
//      a final label. Recorded as `failurePattern`. The pattern miner
//      (Phase 6) surfaces heuristic-vs-LLM disagreement as a separate
//      grid.
//
// Both labels persist so the miner can attribute classifier drift over
// time.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ChatModel } from "@typeagent/aiclient";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import { getSchemaContent } from "../../translation/actionConfig.js";
import type { Neighborhood, NeighborhoodMember } from "../types.js";
import type {
    TranslationProbeFile,
    TranslationProbeRow,
} from "../../translation/translationProbeRunner.js";
import type { CaseDescription, FailurePattern, PhraseRecord } from "./types.js";
import { extractJSON } from "./util.js";

const ALL_FAILURE_PATTERNS: FailurePattern[] = [
    "singular-plural",
    "similar-verb",
    "cross-agent-verb",
    "synonymous-actions",
    "parameter-vs-action",
    "unclassified",
];

export interface AnalyzeCaseOpts {
    neighborhood: Neighborhood;
    translationResults: TranslationProbeFile;
    provider: ActionConfigProvider;
    /** Severity tier from gravity analysis. Defaults to "leaky" when
     *  unspecified — the case loop typically passes it through after
     *  computing gravity. */
    severityTier?: CaseDescription["severityTier"];
    /** LLM model factory. Tests pass a mock. */
    createModel: (name: string) => ChatModel;
    /** Canonical schema guidelines. Injected so tests can vary the text
     *  without touching shared state. */
    schemaGuidelines: string;
    /** Skip the LLM refinement step. Used by tests that only exercise the
     *  heuristic path. */
    skipLLM?: boolean;
    /** Skip the post-analyze "every member has a checksum" validation.
     *  Production callers leave this off so missing-schema cases fail
     *  loud. Tests with stubbed providers pass `true`. */
    skipChecksumValidation?: boolean;
    /** When set, the analyzer reads the sandbox's `.original/` snapshot
     *  to compute schema and manifest checksums. The manifest checksum
     *  in particular MUST come from the sandbox — the sandbox manifest
     *  is synthetic (constructed by sandboxBuilder) and bytewise differs
     *  from the live manifest file. */
    sandboxDir?: string;
    /** Limit on misroute / clean samples kept in the case description.
     *  Default 40 each. */
    sampleCap?: number;
}

/**
 * Build a `CaseDescription` for one neighborhood. Synchronous wrt the
 * heuristic stage; awaits one LLM call for the refinement stage unless
 * `skipLLM` is set.
 */
export async function analyzeCase(
    opts: AnalyzeCaseOpts,
): Promise<CaseDescription> {
    const { neighborhood, translationResults, provider } = opts;
    const cap = opts.sampleCap ?? 40;

    const memberKeys = new Set(
        neighborhood.members.map((m) => `${m.schemaName}.${m.actionName}`),
    );

    // ---- Phrase classification ----
    const misroute: PhraseRecord[] = [];
    const clean: PhraseRecord[] = [];
    const reverse: PhraseRecord[] = [];
    for (const row of translationResults.results) {
        const expectedKey = `${row.expectedSchema}.${row.expectedAction}`;
        const chosenKey =
            row.chosenSchema && row.chosenAction
                ? `${row.chosenSchema}.${row.chosenAction}`
                : undefined;

        if (memberKeys.has(expectedKey)) {
            // Expectation-side phrase.
            if (row.outcome === "MISROUTE") {
                if (misroute.length < cap) misroute.push(phraseRecord(row));
            } else if (row.outcome === "CLEAN") {
                if (clean.length < cap) clean.push(phraseRecord(row));
            }
            continue;
        }
        if (
            chosenKey &&
            memberKeys.has(chosenKey) &&
            row.outcome === "MISROUTE"
        ) {
            // Result-side reverse-direction phrase. Catches the case where
            // a lever widening one member action absorbs phrases that
            // should have gone to a neighbor.
            if (reverse.length < cap) reverse.push(phraseRecord(row));
        }
    }

    // ---- Current descriptions + checksums ----
    const currentJSDoc: Record<string, string> = {};
    const currentPasDescriptions: Record<string, string> = {};
    const currentManifestDescriptions: Record<string, string> = {};
    const originalChecksum: Record<string, string> = {};
    const schemasSeen = new Set<string>();
    for (const m of neighborhood.members) {
        if (schemasSeen.has(m.schemaName)) continue;
        schemasSeen.add(m.schemaName);
        const config = provider.tryGetActionConfig(m.schemaName);
        if (!config) continue;
        try {
            const schemaContent = getSchemaContent(config);
            // Whole-file SHA-1 keyed by `${schemaName}:schema`.
            originalChecksum[`${m.schemaName}:schema`] = sha1(
                schemaContent.content,
            );
            // Pull descriptions per action.
            if (schemaContent.format === "ts") {
                extractTsDescriptions(
                    schemaContent.content,
                    neighborhood.members,
                    m.schemaName,
                    currentJSDoc,
                );
            } else {
                extractPasDescriptions(
                    schemaContent.content,
                    neighborhood.members,
                    m.schemaName,
                    currentPasDescriptions,
                );
            }
        } catch {
            // Skip schemas that fail to load — surfaced as missing entries
            // in currentJSDoc/currentPasDescriptions. The optimize run
            // logs a coverage warning.
        }
        // Manifest description: ActionConfig.description carries the
        // top-level schema description.
        if (config.description) {
            currentManifestDescriptions[m.schemaName] = config.description;
        }
        // Manifest checksum — read from the sandbox's `.original/`
        // snapshot when sandboxDir is supplied. The manifest lever
        // writes to the SANDBOX manifest (which is synthetic, built by
        // sandboxBuilder), so the checksum must match what the lever's
        // verifyChecksum will see at apply time.
        if (opts.sandboxDir) {
            const manifestPath = path.join(
                opts.sandboxDir,
                ".original",
                "agents",
                m.schemaName,
                "manifest.json",
            );
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifestContent = fs.readFileSync(
                        manifestPath,
                        "utf-8",
                    );
                    originalChecksum[`${m.schemaName}:manifest`] =
                        sha1(manifestContent);
                } catch {
                    // skip — validation below will flag it
                }
            }
        }
    }

    // ---- Validate checksum coverage ----
    // Every member's schema must have produced a checksum. A member
    // without a checksum is unusable downstream — levers can't apply
    // against it. Fail loud so the case loop can skip the whole case
    // rather than letting the lever crash mid-run. Common cause:
    // dynamic sub-actions (e.g. taskflow flows registered at runtime)
    // appear as neighborhood members but lack a static schemaFile.
    if (!opts.skipChecksumValidation) {
        const missing: string[] = [];
        for (const m of neighborhood.members) {
            if (!originalChecksum[`${m.schemaName}:schema`]) {
                missing.push(`${m.schemaName}.${m.actionName} (schema)`);
            }
            // Manifest checksums are only required when the sandbox is
            // in play. Without a sandbox the manifest lever can't run
            // anyway, so don't fail on a missing manifest checksum.
            if (
                opts.sandboxDir &&
                !originalChecksum[`${m.schemaName}:manifest`]
            ) {
                missing.push(`${m.schemaName}.${m.actionName} (manifest)`);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `analyzeCase: ${missing.length} member checksum(s) missing: ${missing.join(", ")}`,
            );
        }
    }

    // ---- Heuristic FailurePattern ----
    const heuristic = classifyHeuristic(neighborhood.members);

    // ---- LLM refinement ----
    let refined: FailurePattern = heuristic;
    if (!opts.skipLLM) {
        try {
            refined = await refineWithLLM({
                heuristic,
                members: neighborhood.members,
                misrouteSamples: misroute.slice(0, 8),
                cleanSamples: clean.slice(0, 4),
                createModel: opts.createModel,
                schemaGuidelines: opts.schemaGuidelines,
            });
        } catch {
            // LLM refinement is best-effort. On failure, the heuristic
            // label stands.
            refined = heuristic;
        }
    }

    return {
        schemaVersion: 1,
        neighborhoodId: neighborhood.id,
        members: neighborhood.members,
        severityTier: opts.severityTier ?? "leaky",
        failurePattern: refined,
        failurePatternHeuristic: heuristic,
        misroutePhrases: misroute,
        cleanPhrases: clean,
        reverseDirectionPhrases: reverse,
        currentJSDoc,
        currentManifestDescriptions,
        currentPasDescriptions,
        originalChecksum,
    };
}

// =============================================================================
// Heuristic classification
// =============================================================================

/** Lexical / structural rules over action and schema names. Cheap, runs
 *  before the LLM refinement step. Exported for unit tests. */
export function classifyHeuristic(
    members: NeighborhoodMember[],
): FailurePattern {
    if (members.length < 2) return "unclassified";

    const schemas = new Set(members.map((m) => m.schemaName));
    const sameSchema = schemas.size === 1;
    const allDifferentSchemas = schemas.size === members.length;

    // singular-plural: same schema, action names differ only by trailing 's'.
    if (sameSchema && members.length === 2) {
        const [a, b] = members;
        if (
            isSingularPluralPair(a!.actionName, b!.actionName) ||
            isSingularPluralPair(b!.actionName, a!.actionName)
        ) {
            return "singular-plural";
        }
    }

    const verbs = members.map((m) => extractVerb(m.actionName));
    const allSameVerb =
        verbs.every((v) => v.length > 0 && v === verbs[0]) &&
        verbs[0]!.length > 0;

    // cross-agent-verb: actions from different schemas share base verb.
    if (allSameVerb && allDifferentSchemas) {
        return "cross-agent-verb";
    }
    // similar-verb: same schema, actions share base verb.
    if (allSameVerb && sameSchema) {
        return "similar-verb";
    }

    return "unclassified";
}

function isSingularPluralPair(a: string, b: string): boolean {
    // a is the singular, b is the plural — strict +s rule.
    return b === `${a}s` && a.length > 0;
}

/** Extract the leading lowercase run from a camelCase identifier. Returns
 *  "" when the identifier starts with a non-letter or uppercase letter. */
export function extractVerb(actionName: string): string {
    const m = actionName.match(/^[a-z]+/);
    return m ? m[0] : "";
}

// =============================================================================
// LLM refinement
// =============================================================================

interface RefineOpts {
    heuristic: FailurePattern;
    members: NeighborhoodMember[];
    misrouteSamples: PhraseRecord[];
    cleanSamples: PhraseRecord[];
    createModel: (name: string) => ChatModel;
    schemaGuidelines: string;
}

interface RefineResponse {
    failurePattern: string;
    rationale?: string;
}

async function refineWithLLM(opts: RefineOpts): Promise<FailurePattern> {
    const memberLines = opts.members
        .map((m) => `  - ${m.schemaName}.${m.actionName}`)
        .join("\n");
    const misroute = opts.misrouteSamples
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction} chose=${p.chosenSchema ?? "?"}.${p.chosenAction ?? "?"}`,
        )
        .join("\n");
    const clean = opts.cleanSamples
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction}`,
        )
        .join("\n");

    const prompt = `${opts.schemaGuidelines}

A translator-collision case needs classification. Pick the SINGLE failurePattern that best describes the case.

Allowed labels: ${ALL_FAILURE_PATTERNS.join(", ")}

Heuristic classification (lexical-only): ${opts.heuristic}

Members:
${memberLines}

Misroute samples (expected vs. chose):
${misroute}

Clean samples that already work:
${clean}

Return JSON only:

{
  "failurePattern": "<one of the labels above>",
  "rationale": "<1-2 sentence reason>"
}`;

    const model = opts.createModel("classify");
    const result = await model.complete(prompt);
    if (!result.success) {
        throw new Error(`caseAnalyzer LLM failure: ${result.message}`);
    }
    const parsed = extractJSON<RefineResponse>(result.data);
    if (!parsed) return opts.heuristic;
    return coerceFailurePattern(parsed.failurePattern, opts.heuristic);
}

function coerceFailurePattern(
    raw: unknown,
    fallback: FailurePattern,
): FailurePattern {
    if (typeof raw !== "string") return fallback;
    if ((ALL_FAILURE_PATTERNS as string[]).includes(raw)) {
        return raw as FailurePattern;
    }
    return fallback;
}

// =============================================================================
// Description extraction
// =============================================================================

function extractTsDescriptions(
    content: string,
    members: NeighborhoodMember[],
    schemaName: string,
    out: Record<string, string>,
): void {
    const lines = content.split(/\r?\n/);
    for (const m of members) {
        if (m.schemaName !== schemaName) continue;
        const typeName = `${capitalize(m.actionName)}Action`;
        const idx = lines.findIndex((l) =>
            new RegExp(
                `^\\s*(?:export\\s+)?interface\\s+${escapeRegex(typeName)}\\b`,
            ).test(l),
        );
        if (idx < 0) continue;
        const block: string[] = [];
        for (let i = idx - 1; i >= 0; i--) {
            const t = lines[i]!.trim();
            if (t === "") break;
            if (
                t.startsWith("//") ||
                t.startsWith("/**") ||
                t.startsWith("/*") ||
                t.startsWith("*") ||
                t === "*/"
            ) {
                block.unshift(lines[i]!);
                continue;
            }
            break;
        }
        out[`${m.schemaName}.${m.actionName}`] = block.join("\n");
    }
}

function extractPasDescriptions(
    content: string,
    members: NeighborhoodMember[],
    schemaName: string,
    out: Record<string, string>,
): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return;
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("types" in parsed) ||
        typeof (parsed as any).types !== "object"
    ) {
        return;
    }
    const types = (parsed as any).types as Record<string, any>;
    for (const m of members) {
        if (m.schemaName !== schemaName) continue;
        const typeName = `${capitalize(m.actionName)}Action`;
        const def = types[typeName];
        if (!def) continue;
        const comments = (def.comments ?? []) as string[];
        out[`${m.schemaName}.${m.actionName}`] = comments.join("\n");
    }
}

// =============================================================================
// Helpers
// =============================================================================

function phraseRecord(row: TranslationProbeRow): PhraseRecord {
    const rec: PhraseRecord = {
        phraseText: row.phraseText,
        expectedSchema: row.expectedSchema,
        expectedAction: row.expectedAction,
        outcome: row.outcome,
    };
    if (row.chosenSchema) rec.chosenSchema = row.chosenSchema;
    if (row.chosenAction) rec.chosenAction = row.chosenAction;
    if (row.phraseSources && row.phraseSources.length > 0) {
        rec.sources = row.phraseSources.map((s) => ({
            phrase: row.phraseText,
            model: s.model,
            style: s.style,
        }));
    }
    return rec;
}

function sha1(content: string): string {
    return crypto.createHash("sha1").update(content).digest("hex");
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
