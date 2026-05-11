// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision neighborhoods …` — Phase 0 (preview only). Reads the existing
// similarity engine + an optional corpus probe results file, runs the merge
// in-memory, writes a one-shot HTML visualization. NO PERSISTENCE; NO
// RUNTIME HOOKS. The plan calls for stopping here, eyeballing the output,
// and refining before committing to Phase 1's persisted index + runtime
// resolver.

import * as fs from "node:fs";
import * as path from "node:path";

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    ActionSimilarityScanInput,
    applyStrategy,
    computeActionSimilarity,
    getStrategy,
} from "../../../translation/actionSimilarity.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import { buildNeighborhoodPreview } from "../../../neighborhoods/merge.js";
import {
    mergeTranslatorEvidence,
    type TranslatorProbeRecord,
} from "../../../neighborhoods/translatorMerge.js";
import {
    buildNeighborhoodPreviewHTML,
    type ViewPairScore,
} from "../../../neighborhoods/previewViz.js";
import type { MisrouteEdge, NeighborhoodMember } from "../../../neighborhoods/types.js";

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_SIMILARITY_STRATEGY = "balanced";
const DEFAULT_SIMILARITY_THRESHOLD = 0.78;
const DEFAULT_MIN_MISROUTE_COUNT = 2;
const DEFAULT_PREVIEW_FILENAME = "neighborhoods-preview.html";
const DEFAULT_CORPUS_FILENAME = "probe-results-reclassified.json";
const DEFAULT_TRANSLATOR_CORPUS_FILENAME = "translation-results.json";
const DEFAULT_SAMPLES_PER_CATEGORY = 5;

// =============================================================================
// Workdir resolution (mirrors collisionCorpusHandlers.ts pattern)
// =============================================================================

function defaultWorkdir(systemContext: CommandHandlerContext): string {
    const root = systemContext.instanceDir ?? process.cwd();
    return path.join(root, "collisions");
}

function ensureDir(p: string) {
    fs.mkdirSync(p, { recursive: true });
}

function resolveWorkdir(
    systemContext: CommandHandlerContext,
    flag: string | undefined,
): string {
    const dir = flag ? path.resolve(flag) : defaultWorkdir(systemContext);
    ensureDir(dir);
    return dir;
}

function defaultPath(
    systemContext: CommandHandlerContext,
    flag: string | undefined,
    workdir: string | undefined,
    filename: string,
): string {
    if (flag) return path.resolve(flag);
    const dir = workdir ?? defaultWorkdir(systemContext);
    return path.join(dir, filename);
}

const SIMILARITY_CACHE_RELATIVE = path.join(
    "agentCache",
    "actionSimilarity",
    "embeddings.json",
);

function resolveSimilarityCachePath(
    ctx: CommandHandlerContext,
): string | undefined {
    const root = ctx.instanceDir;
    if (!root) return undefined;
    return path.join(root, SIMILARITY_CACHE_RELATIVE);
}

// =============================================================================
// Corpus probe → MisrouteEdge[]
// =============================================================================

/**
 * Pull (expected → actual top-1) edges from a reclassified probe-results
 * JSON. Same shape produced by `@collision corpus reanalyze`. Duck-typed
 * read (we don't import ProbeFile from collisionCorpusHandlers to avoid
 * a handler-to-handler dep). Captures up to MAX_SAMPLES_PER_EDGE example
 * phrases per edge so the preview can show what users actually said.
 */
interface ProbeResultLike {
    schemaName: string;
    actionName: string;
    verdict: string;
    top1?: { schemaName: string; actionName: string };
    phraseText?: string;
    phraseSources?: { model?: string; style?: string }[];
}
interface ProbeFileLike {
    results: ProbeResultLike[];
}

const MAX_SAMPLES_PER_EDGE = 5;

function readMisrouteEdges(corpusPath: string): MisrouteEdge[] {
    const data = JSON.parse(
        fs.readFileSync(corpusPath, "utf8"),
    ) as ProbeFileLike;
    if (!data.results || !Array.isArray(data.results)) return [];

    // Aggregate by (expected, actual) tuple.
    const edgeMap = new Map<
        string,
        {
            expected: NeighborhoodMember;
            actual: NeighborhoodMember;
            count: number;
            verdicts: { CLEAN: number; TIGHT: number; MISROUTE: number; ERROR: number };
            samples: { phrase: string; model?: string | undefined; style?: string | undefined }[];
            countsByStyle: Map<string, number>;
        }
    >();
    for (const r of data.results) {
        if (!r.top1) continue;
        if (r.verdict !== "MISROUTE") continue;
        const expected: NeighborhoodMember = {
            schemaName: r.schemaName,
            actionName: r.actionName,
        };
        const actual: NeighborhoodMember = {
            schemaName: r.top1.schemaName,
            actionName: r.top1.actionName,
        };
        const key = `${expected.schemaName}.${expected.actionName}->${actual.schemaName}.${actual.actionName}`;
        let row = edgeMap.get(key);
        if (!row) {
            row = {
                expected,
                actual,
                count: 0,
                verdicts: { CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0 },
                samples: [],
                countsByStyle: new Map(),
            };
            edgeMap.set(key, row);
        }
        row.count++;
        const v = r.verdict as keyof typeof row.verdicts;
        if (v in row.verdicts) row.verdicts[v]++;
        const src = r.phraseSources?.[0];
        const style = src?.style;
        if (style) {
            row.countsByStyle.set(
                style,
                (row.countsByStyle.get(style) ?? 0) + 1,
            );
        }
        if (r.phraseText && row.samples.length < MAX_SAMPLES_PER_EDGE) {
            row.samples.push({
                phrase: r.phraseText,
                model: src?.model,
                style,
            });
        }
    }
    return [...edgeMap.values()].map((row) => {
        // Convert the style-keyed count map into the shape used downstream
        // (count + optional translator counts). Translator counts get
        // populated later by translatorMerge.
        const countsByStyle: NonNullable<MisrouteEdge["countsByStyle"]> = {};
        for (const [style, count] of row.countsByStyle) {
            countsByStyle[style] = { count };
        }
        return {
            expected: row.expected,
            actual: row.actual,
            count: row.count,
            sourceVerdicts: row.verdicts,
            samples: row.samples.length > 0 ? row.samples : undefined,
            ...(row.countsByStyle.size > 0 && { countsByStyle }),
        };
    });
}

// =============================================================================
// Translator-probe join → TranslatorProbeRecord[]
// =============================================================================

/**
 * Join the embedding-probe corpus with the translation-probe corpus by
 * `(expectedSchema, expectedAction, phraseText)`. Returns one record per
 * phrase that has both a ranker top-1 and a translator chosen action; rows
 * with translator outcome CLARIFY/INVALID/ERROR are skipped (no clean
 * cross-tab signal). Both files are loaded lazily and only the fields
 * needed for the join are extracted.
 */
interface ProbeFileLikeForJoin {
    results: {
        schemaName: string;
        actionName: string;
        phraseText?: string;
        phraseSources?: { model?: string; style?: string }[];
        top1?: { schemaName: string; actionName: string };
    }[];
}
interface TranslationFileLike {
    results: {
        expectedSchema: string;
        expectedAction: string;
        phraseText: string;
        chosenSchema?: string;
        chosenAction?: string;
        outcome: string;
    }[];
}

function loadTranslatorProbeRecords(
    corpusPath: string,
    translationPath: string,
): TranslatorProbeRecord[] {
    const probe = JSON.parse(
        fs.readFileSync(corpusPath, "utf8"),
    ) as ProbeFileLikeForJoin;
    const translation = JSON.parse(
        fs.readFileSync(translationPath, "utf8"),
    ) as TranslationFileLike;
    if (!probe.results || !translation.results) return [];

    // Index translation rows by (expectedSchema, expectedAction, phraseText).
    // Multiple rows with the same key shouldn't happen but if they do we
    // keep the first (deterministic given the input ordering).
    const transIndex = new Map<string, TranslationFileLike["results"][number]>();
    for (const r of translation.results) {
        const key = `${r.expectedSchema}\0${r.expectedAction}\0${r.phraseText}`;
        if (!transIndex.has(key)) transIndex.set(key, r);
    }

    const out: TranslatorProbeRecord[] = [];
    for (const r of probe.results) {
        if (!r.top1 || !r.phraseText) continue;
        const key = `${r.schemaName}\0${r.actionName}\0${r.phraseText}`;
        const t = transIndex.get(key);
        if (!t) continue;
        if (!t.chosenSchema || !t.chosenAction) continue;
        // Only CLEAN/MISROUTE outcomes contribute to the cross-tab; others
        // (CLARIFY, INVALID, ERROR) are excluded so they don't muddy
        // bookkeeping. See translatorMerge.ts header.
        if (t.outcome !== "CLEAN" && t.outcome !== "MISROUTE") continue;

        const src = r.phraseSources?.[0];
        out.push({
            phrase: r.phraseText,
            expectedSchema: r.schemaName,
            expectedAction: r.actionName,
            rankerTop1Schema: r.top1.schemaName,
            rankerTop1Action: r.top1.actionName,
            translatorSchema: t.chosenSchema,
            translatorAction: t.chosenAction,
            sourceModel: src?.model,
            sourceStyle: src?.style,
        });
    }
    return out;
}

// =============================================================================
// Handler: @collision neighborhoods preview
// =============================================================================

class CollisionNeighborhoodsPreviewCommandHandler implements CommandHandler {
    public readonly description =
        "PREVIEW: build neighborhoods in-memory from current similarity + corpus data and write an interactive HTML visualization (no persistence)";
    public readonly parameters = {
        flags: {
            strategy: {
                description: `Similarity strategy (default ${DEFAULT_SIMILARITY_STRATEGY})`,
                type: "string",
                default: DEFAULT_SIMILARITY_STRATEGY,
            },
            threshold: {
                description: `Similarity threshold, decimal in [0, 1] (default ${DEFAULT_SIMILARITY_THRESHOLD})`,
                type: "string",
                optional: true,
            },
            corpus: {
                description:
                    "Corpus probe-results JSON to include as misroute evidence. Default: <workdir>/probe-results-reclassified.json (skipped if missing)",
                type: "string",
                optional: true,
            },
            "translator-corpus": {
                description:
                    "Translator-probe corpus JSON for ground-truth user-impact misroutes. Default: <workdir>/probe-results-translated.json (skipped if missing). Currently a forward-compatible no-op until the translator-probe pipeline ships.",
                type: "string",
                optional: true,
            },
            "samples-per-category": {
                description: `Per-category cap on edge sample phrases (default ${DEFAULT_SAMPLES_PER_CATEGORY}). With translator data tagged by category, the worst-case grows to ~4× this value per edge.`,
                type: "number",
                default: DEFAULT_SAMPLES_PER_CATEGORY,
            },
            "min-misroute": {
                description: `Drop corpus edges below this count (default ${DEFAULT_MIN_MISROUTE_COUNT})`,
                type: "number",
                default: DEFAULT_MIN_MISROUTE_COUNT,
            },
            "include-same-schema": {
                description:
                    "Include same-schema misroute edges (e.g. email.send + email.reply). Default: true",
                type: "boolean",
                default: true,
            },
            "no-cache": {
                description: "Skip the on-disk embedding cache (forces re-embed)",
                type: "boolean",
                default: false,
            },
            out: {
                description: `Output HTML path. Default: <workdir>/${DEFAULT_PREVIEW_FILENAME}`,
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory for default-named files. Default: <instanceDir>/collisions",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const workdir = params.flags.workdir
            ? resolveWorkdir(systemContext, params.flags.workdir)
            : undefined;
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_PREVIEW_FILENAME,
        );
        ensureDir(path.dirname(outPath));

        // ---- 1. Build similarity inputs (same loop as @collision similar) ----
        const configs = systemContext.agents.getActionConfigs();
        const inputs: ActionSimilarityScanInput[] = [];
        const skipped: { schemaName: string; reason: string }[] = [];
        for (const config of configs) {
            try {
                const actionSchemaFile =
                    systemContext.agents.getActionSchemaFileForConfig(config);
                const agentName = getAppAgentName(config.schemaName);
                let agentDescription: string | undefined;
                try {
                    agentDescription =
                        systemContext.agents.getAppAgentDescription(agentName);
                } catch {
                    agentDescription = undefined;
                }
                inputs.push({
                    schemaName: config.schemaName,
                    agentName,
                    agentDescription,
                    actionSchemaFile,
                });
            } catch (err) {
                skipped.push({
                    schemaName: config.schemaName,
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }
        if (inputs.length === 0) {
            displayWarn(
                "No agent action schemas available to scan.",
                context,
            );
            return;
        }

        // ---- 2. Run the similarity scan ----
        const cachePath = params.flags["no-cache"]
            ? undefined
            : resolveSimilarityCachePath(systemContext);
        const compileHeader = "Neighborhood preview · embedding action vectors";
        const scoreHeader = "Neighborhood preview · pairwise similarity";
        displayStatus(
            `${compileHeader}\n[0/${inputs.length}] preparing…`,
            context,
        );
        const scan = await computeActionSimilarity(inputs, {
            cachePath,
            onProgress: (phase, index, total, label) => {
                const header =
                    phase === "embedding" ? compileHeader : scoreHeader;
                displayStatus(
                    `${header}\n[${index}/${total}]${label ? ` ${label}` : ""}`,
                    context,
                );
            },
        });

        // ---- 3. Apply strategy → clusters ----
        // The framework's number flag is integer-only (parseInt), so we
        // accept threshold as a string and parseFloat ourselves.
        let threshold = DEFAULT_SIMILARITY_THRESHOLD;
        if (params.flags.threshold !== undefined) {
            const parsed = parseFloat(params.flags.threshold);
            if (Number.isNaN(parsed)) {
                displayWarn(
                    `Invalid --threshold "${params.flags.threshold}" — must be a decimal in [0, 1].`,
                    context,
                );
                return;
            }
            threshold = Math.max(0, Math.min(1, parsed));
        }
        const strategyName =
            params.flags.strategy ?? DEFAULT_SIMILARITY_STRATEGY;
        const strategy = getStrategy(strategyName);
        if (!strategy) {
            displayWarn(
                `Unknown strategy "${strategyName}". Run \`@collision similar list-strategies\` to see all.`,
                context,
            );
            return;
        }
        const applied = applyStrategy(scan, strategy, threshold);

        // ---- 4. Optionally read corpus misroute edges ----
        const corpusPath = defaultPath(
            systemContext,
            params.flags.corpus,
            workdir,
            DEFAULT_CORPUS_FILENAME,
        );
        let misrouteEdges: MisrouteEdge[] = [];
        let corpusFileUsed: string | undefined;
        if (fs.existsSync(corpusPath)) {
            displayStatus(
                `Neighborhood preview · loading corpus ${corpusPath}…`,
                context,
            );
            try {
                misrouteEdges = readMisrouteEdges(corpusPath);
                corpusFileUsed = corpusPath;
            } catch (err) {
                displayWarn(
                    `Failed to read corpus ${corpusPath}: ${err instanceof Error ? err.message : String(err)} — continuing without corpus evidence`,
                    context,
                );
            }
        }

        // ---- 4b. Optional translator-probe corpus (cross-tab join) ----
        // Pairs `translation-results.json` with the embedding probe-results
        // file by (expectedSchema, expectedAction, phraseText) so each
        // phrase has both a ranker top-1 and a translator chosen action.
        // The merge below decorates ranker edges with translator counts and
        // adds NEW_FAILURE edges for translator-only misroutes. Without a
        // matching corpus probe-results file, no records are emitted.
        const translatorCorpusPath = defaultPath(
            systemContext,
            params.flags["translator-corpus"],
            workdir,
            DEFAULT_TRANSLATOR_CORPUS_FILENAME,
        );
        let translatorCorpusUsed: string | undefined;
        let translatorRecords: TranslatorProbeRecord[] | undefined;
        if (fs.existsSync(translatorCorpusPath)) {
            translatorCorpusUsed = translatorCorpusPath;
            if (corpusFileUsed) {
                try {
                    translatorRecords = loadTranslatorProbeRecords(
                        corpusFileUsed,
                        translatorCorpusPath,
                    );
                } catch (err) {
                    displayWarn(
                        `Failed to join translator corpus ${translatorCorpusPath}: ${err instanceof Error ? err.message : String(err)} — continuing without translator evidence`,
                        context,
                    );
                }
            } else {
                displayWarn(
                    `Translator corpus found at ${translatorCorpusPath} but no embedding probe-results to join against — skipping translator evidence`,
                    context,
                );
            }
        }

        // ---- 5. Merge → preview ----
        const minMisrouteCount = Math.max(
            1,
            params.flags["min-misroute"] ?? DEFAULT_MIN_MISROUTE_COUNT,
        );
        const includeSameSchema = params.flags["include-same-schema"] ?? true;
        const samplesPerCategoryCap = Math.max(
            1,
            params.flags["samples-per-category"] ?? DEFAULT_SAMPLES_PER_CATEGORY,
        );
        const preview = buildNeighborhoodPreview({
            similarityClusters: applied.clusters,
            similarityStrategy: strategy.name,
            similarityThreshold: threshold,
            misrouteEdges,
            corpusFile: corpusFileUsed,
            translatorCorpusFile: translatorCorpusUsed,
            minMisrouteCount,
            includeSameSchema,
            samplesPerCategoryCap,
            // Server-side: don't pre-tag corpus pairs as similarity. The HTML
            // slider does that dynamically using the embedded pairScores.
        });
        // Layer translator-probe evidence on top: cross-tabulates ranker ×
        // translator outcomes per phrase, decorates ranker edges with
        // translator counts, and adds NEW_FAILURE edges. No-op when no
        // translator records were loaded.
        preview.neighborhoods = mergeTranslatorEvidence(
            preview.neighborhoods,
            {
                ...(translatorRecords && { records: translatorRecords }),
                samplesPerCategoryCap,
            },
        );

        // ---- 6. Compute scored pair list for the slider ----
        // We only need scores for pairs that the slider could possibly retag —
        // i.e. the 2-member corpus-only cross-schema neighborhoods. Embedding
        // every cross-schema pair the engine kept (~119K at keepThreshold 0.5)
        // bloats the HTML to >10 MB; this filter keeps it to a few hundred.
        const interestingKeys = new Set<string>();
        for (const n of preview.neighborhoods) {
            if (n.kind !== "cross-schema") continue;
            if (n.members.length !== 2) continue;
            if (n.sources.includes("similarity")) continue; // already tagged
            const a = `${n.members[0].schemaName}.${n.members[0].actionName}`;
            const b = `${n.members[1].schemaName}.${n.members[1].actionName}`;
            interestingKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
        }
        const pairScores: ViewPairScore[] = [];
        for (const pair of scan.pairs) {
            const score = strategy.score(pair.scores);
            if (score === undefined) continue;
            const a = `${pair.keyA.schemaName}.${pair.keyA.actionName}`;
            const b = `${pair.keyB.schemaName}.${pair.keyB.actionName}`;
            const sortedA = a < b ? a : b;
            const sortedB = a < b ? b : a;
            if (!interestingKeys.has(`${sortedA}|${sortedB}`)) continue;
            pairScores.push({ a: sortedA, b: sortedB, score });
        }

        // ---- 7. Render HTML, write file ----
        const html = buildNeighborhoodPreviewHTML(preview, {
            pairScores,
            // Default the slider to the cluster threshold so the page boots
            // showing the same baseline as the server-side merge.
            initialConfirmThreshold: threshold,
        });
        fs.writeFileSync(outPath, html);

        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
        const total = preview.neighborhoods.length;
        const cross = preview.neighborhoods.filter(
            (n) => n.kind === "cross-schema",
        ).length;
        const same = preview.neighborhoods.filter(
            (n) => n.kind === "same-schema",
        ).length;
        const both = preview.neighborhoods.filter(
            (n) =>
                n.sources.includes("similarity") &&
                n.sources.includes("corpus"),
        ).length;
        const skipNote =
            skipped.length > 0
                ? `<div style="color:#c80;font-size:11px;margin-top:6px;">${skipped.length} schema(s) failed to load: ${skipped
                      .map((s) => `<code>${s.schemaName}</code>`)
                      .join(", ")}</div>`
                : "";
        const corpusNote = corpusFileUsed
            ? `<div style="font-size:11px;color:#777;margin-top:4px;">corpus: ${corpusFileUsed} · ${misrouteEdges.length} edge(s)</div>`
            : `<div style="font-size:11px;color:#c80;margin-top:4px;">corpus: not found at ${corpusPath} — preview shows similarity-only neighborhoods</div>`;
        const summaryHtml =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Neighborhood preview written</h3>` +
            `<div style="font-size:12px;color:#777;margin-bottom:6px;"><b>${total}</b> neighborhood(s) · ${cross} cross-schema · ${same} same-schema · ${both} confirmed (both sources) · ${sizeKB} KB</div>` +
            `<div style="font-size:12px;">→ <code>${outPath}</code></div>` +
            corpusNote +
            skipNote +
            `<div style="font-size:11px;color:#777;margin-top:8px;">Preview only — nothing persisted. Open in any browser.</div>` +
            `</div>`;
        const summaryText = [
            `Neighborhood preview written: ${outPath} (${sizeKB} KB)`,
            `  ${total} neighborhood(s) · ${cross} cross-schema · ${same} same-schema · ${both} confirmed (both sources)`,
            corpusFileUsed
                ? `  corpus: ${corpusFileUsed} · ${misrouteEdges.length} edge(s)`
                : `  corpus: not found at ${corpusPath} — similarity-only`,
            `  Preview only — nothing persisted.`,
        ];
        if (skipped.length > 0) {
            summaryText.push(
                `  Skipped: ${skipped.map((s) => s.schemaName).join(", ")}`,
            );
        }
        context.actionIO.appendDisplay({
            type: "html",
            content: summaryHtml,
            alternates: [{ type: "text", content: summaryText }],
        });
    }
}

// =============================================================================
// Subcommand table
// =============================================================================

export function getCollisionNeighborhoodCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Pre-identify ambiguity action neighborhoods (Phase 0: preview only)",
        defaultSubCommand: "preview",
        commands: {
            preview: new CollisionNeighborhoodsPreviewCommandHandler(),
        },
    };
}
