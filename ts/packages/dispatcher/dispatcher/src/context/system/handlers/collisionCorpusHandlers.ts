// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision corpus …` — phrase-corpus generation, probe replay, and the
// hotspot visualization, all running inside the live dispatcher session.
//
// These commands are the in-shell surface for the same pipeline that the
// standalone `packages/cli/scripts/*-runner.mjs` scripts implement: they
// (a) ask LLM(s) to write example user utterances for every action, then
// (b) replay those utterances through `semanticSearchActionSchema` (the
// embedding ranker that drives the `llmSelect` detection point), then
// (c) classify each phrase as CLEAN / TIGHT / MISROUTE, and finally
// (d) emit an interactive HTML visualization of the misroute hotspots.
//
// SAFETY: every step is read-only against TypeAgent state.  The dispatcher
// already runs `@collision probe` and `@collision similar` against the
// same APIs in the live session today — these commands just batch them.
// As an extra belt-and-suspenders measure, every step disables the
// construction cache for the duration of its work and restores the prior
// setting on exit (`withReadOnlySession`).
//
// The cost: corpus generation is the slow stage (one chat-completion per
// action × model — ~12 minutes for the full ~65-schema set).  The shell
// shows a `displayStatus` line that updates as work completes.  No async
// task / cancellation support yet — if you start a run, you wait for it.

import * as fs from "node:fs";
import * as path from "node:path";

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

import { openai } from "aiclient";

import {
    CommandHandlerContext,
    changeContextConfig,
} from "../../commandHandlerContext.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";

// =============================================================================
// Types
// =============================================================================

interface CorpusPhraseSource {
    model: string;
    style: string;
}

interface CorpusPhrase {
    text: string;
    sources: CorpusPhraseSource[];
}

interface CorpusAction {
    schemaName: string;
    actionName: string;
    description?: string | undefined;
    phrases: CorpusPhrase[];
}

interface Corpus {
    scannedAt: string;
    models: string[];
    sampledSchemas: string[];
    actionCount: number;
    actions: CorpusAction[];
}

type Verdict = "CLEAN" | "TIGHT" | "MISROUTE" | "ERROR";

interface ProbeRow {
    schemaName: string;
    actionName: string;
    score: number;
    deltaToNext?: number | undefined;
    matchesExpected?: boolean | undefined;
}

interface ProbeResult {
    schemaName: string;
    actionName: string;
    phraseText: string;
    phraseSources: CorpusPhraseSource[];
    rows: ProbeRow[];
    top1?: ProbeRow | undefined;
    verdict: Verdict;
    error?: string | undefined;
}

interface PerActionRow {
    schemaName: string;
    actionName: string;
    CLEAN: number;
    TIGHT: number;
    MISROUTE: number;
    ERROR: number;
    total: number;
}

interface PerSourceRow {
    CLEAN: number;
    TIGHT: number;
    MISROUTE: number;
    ERROR: number;
    total: number;
    model?: string | undefined;
    style?: string | undefined;
}

interface ProbeSummary {
    scannedAt: string;
    corpus: string;
    elapsedMs: number;
    delta: number;
    top: number;
    totalPhrases: number;
    counts: Record<Verdict, number>;
    perAction: PerActionRow[];
    perModel: PerSourceRow[];
    perStyle: PerSourceRow[];
    misrouteEdges: { edge: string; count: number }[];
    reclassifiedAt?: string | undefined;
}

interface ProbeFile {
    summary: ProbeSummary;
    results: ProbeResult[];
}

// =============================================================================
// Defaults / constants
// =============================================================================

const PHRASE_STYLES = ["imperative", "conversational", "casual"] as const;
type PhraseStyle = (typeof PHRASE_STYLES)[number];

// Mirror corpus-runner.mjs: only OpenAI-family endpoints currently working
// in this checkout. Override with --models on the command line.
const DEFAULT_MODELS = ["GPT_4_1", "GPT_5", "GPT_5_NANO"];
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_DELTA = 0.05;
const DEFAULT_PROBE_TOP = 5;
const DEFAULT_SANKEY_TOP = 60;

const DEFAULT_FILES = {
    corpus: "corpus.json",
    probe: "probe-results.json",
    reclassified: "probe-results-reclassified.json",
    html: "collisions-viz.html",
} as const;

// =============================================================================
// withReadOnlySession — disable cache for the duration of `fn`, restore after
// =============================================================================

async function withReadOnlySession<T>(
    context: ActionContext<CommandHandlerContext>,
    fn: () => Promise<T>,
): Promise<T> {
    const session = context.sessionContext.agentContext.session;
    const wasCacheEnabled = session.getConfig().cache.enabled;
    if (wasCacheEnabled) {
        await changeContextConfig({ cache: { enabled: false } }, context);
    }
    try {
        return await fn();
    } finally {
        if (wasCacheEnabled) {
            await changeContextConfig({ cache: { enabled: true } }, context);
        }
    }
}

// =============================================================================
// Default workdir resolution
// =============================================================================

function defaultWorkdir(systemContext: CommandHandlerContext): string {
    // Profile-scoped, survives profile switches; mirrors the
    // `actionSimilarity` cache convention from the similar handler.
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

// =============================================================================
// pmap — bounded-concurrency async map with progress callback
// =============================================================================

async function pmap<T, R>(
    items: T[],
    concurrency: number,
    runOne: (item: T, index: number) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let done = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await runOne(items[i], i);
            done++;
            onProgress?.(done, items.length);
        }
    }
    const workers = Array.from(
        { length: Math.max(1, concurrency) },
        worker,
    );
    await Promise.all(workers);
    return results;
}

// =============================================================================
// Action enumeration
// =============================================================================

interface CorpusActionInfo {
    agentName: string;
    agentDescription?: string | undefined;
    schemaName: string;
    actionName: string;
    actionDescription?: string | undefined;
    paramSummary?: string | undefined;
}

function describeParameters(definition: any): string | undefined {
    const params = definition?.type?.fields?.parameters;
    if (!params) return undefined;
    const paramType = params.type;
    if (!paramType || paramType.type !== "object") return undefined;
    const lines: string[] = [];
    for (const [propName, propField] of Object.entries(
        paramType.fields,
    ) as [string, any][]) {
        const propDoc = (propField.comments ?? [])
            .map((c: string) => c.trim())
            .filter(Boolean)
            .join(" ");
        lines.push(propDoc ? `${propName}: ${propDoc}` : propName);
    }
    return lines.length > 0 ? lines.join("\n") : undefined;
}

function enumerateActions(
    systemContext: CommandHandlerContext,
    schemaFilter: string[],
): {
    actions: CorpusActionInfo[];
    failedSchemas: { schemaName: string; error: string }[];
    totalSchemas: number;
} {
    const configs = systemContext.agents.getActionConfigs();
    const sampled =
        schemaFilter.length === 0
            ? configs
            : configs.filter((c) => schemaFilter.includes(c.schemaName));
    const actions: CorpusActionInfo[] = [];
    const failedSchemas: { schemaName: string; error: string }[] = [];
    for (const cfg of sampled) {
        let schemaFile;
        try {
            schemaFile =
                systemContext.agents.getActionSchemaFileForConfig(cfg);
        } catch (err) {
            failedSchemas.push({
                schemaName: cfg.schemaName,
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        const agentName = getAppAgentName(cfg.schemaName);
        let agentDescription: string | undefined;
        try {
            agentDescription =
                systemContext.agents.getAppAgentDescription(agentName);
        } catch {
            agentDescription = undefined;
        }
        for (const [actionName, definition] of schemaFile.parsedActionSchema
            .actionSchemas) {
            actions.push({
                agentName,
                agentDescription,
                schemaName: cfg.schemaName,
                actionName,
                actionDescription:
                    (definition as any).comments?.[0]?.trim() || undefined,
                paramSummary: describeParameters(definition),
            });
        }
    }
    return { actions, failedSchemas, totalSchemas: sampled.length };
}

// =============================================================================
// Corpus generation
// =============================================================================

function buildCorpusPrompt(action: CorpusActionInfo): string {
    return [
        "You are helping calibrate a natural-language action-routing system.",
        "Given an action that an AI agent can perform, generate three example",
        "user utterances that a real person might say to trigger this action.",
        "",
        `Agent: ${action.agentName}`,
        `Agent purpose: ${action.agentDescription || "(no description)"}`,
        `Schema: ${action.schemaName}`,
        `Action: ${action.actionName}`,
        `Action description: ${action.actionDescription || "(none provided)"}`,
        `Parameters: ${action.paramSummary || "(none)"}`,
        "",
        "Generate three example utterances in distinct phrasing styles:",
        "  1. IMPERATIVE  — terse, command-like.",
        "  2. CONVERSATIONAL — polite or full-sentence.",
        "  3. CASUAL — short, idiomatic, may abbreviate or omit articles.",
        "",
        "If the action takes parameters with concrete values (a song name,",
        "a list name, etc.), invent plausible specific values rather than",
        "leaving placeholders.",
        "",
        'Return ONLY a JSON object: {"imperative":"…","conversational":"…","casual":"…"}.',
        "No commentary, no markdown fences, no preamble.",
    ].join("\n");
}

function extractJSON(raw: string): string {
    let s = raw.trim();
    if (s.startsWith("```")) {
        s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    return s.trim();
}

interface GenerateCorpusOpts {
    schemas: string[];
    models: string[];
    concurrency: number;
}

async function generateCorpus(
    systemContext: CommandHandlerContext,
    opts: GenerateCorpusOpts,
    onProgress?: (
        phase: "loading" | "generating" | "merging",
        done?: number,
        total?: number,
    ) => void,
): Promise<{
    corpus: Corpus;
    errorCount: number;
    failedSchemas: { schemaName: string; error: string }[];
    perCallErrors: { schemaName: string; actionName: string; model: string; error: string }[];
}> {
    onProgress?.("loading");
    const { actions, failedSchemas } = enumerateActions(
        systemContext,
        opts.schemas,
    );
    if (actions.length === 0) {
        throw new Error(
            opts.schemas.length === 0
                ? "No action schemas available to scan."
                : `No matching schemas for: ${opts.schemas.join(", ")}.`,
        );
    }

    const models = opts.models.map((name) => ({
        name,
        model: openai.createChatModel(name, undefined, undefined, [
            "@collision corpus generate",
        ]),
    }));

    interface Task {
        action: CorpusActionInfo;
        modelName: string;
        model: { complete: (prompt: string) => Promise<{ success: boolean; data?: string; message?: string }> };
    }
    const tasks: Task[] = [];
    for (const action of actions) {
        for (const m of models) {
            tasks.push({
                action,
                modelName: m.name,
                model: m.model as any,
            });
        }
    }

    const perCallErrors: {
        schemaName: string;
        actionName: string;
        model: string;
        error: string;
    }[] = [];

    onProgress?.("generating", 0, tasks.length);
    interface CallResult {
        task: Task;
        phrases: { text: string; style: PhraseStyle; model: string }[];
        error?: string;
    }
    const results = await pmap<Task, CallResult>(
        tasks,
        opts.concurrency,
        async (task) => {
            const prompt = buildCorpusPrompt(task.action);
            try {
                const result = await task.model.complete(prompt);
                if (!result.success) {
                    return {
                        task,
                        error: result.message ?? "unknown failure",
                        phrases: [],
                    };
                }
                let parsed: any;
                try {
                    parsed = JSON.parse(extractJSON(result.data ?? ""));
                } catch (err) {
                    return {
                        task,
                        error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
                        phrases: [],
                    };
                }
                const phrases: {
                    text: string;
                    style: PhraseStyle;
                    model: string;
                }[] = [];
                for (const style of PHRASE_STYLES) {
                    const text =
                        typeof parsed[style] === "string"
                            ? parsed[style].trim()
                            : "";
                    if (text)
                        phrases.push({
                            text,
                            style,
                            model: task.modelName,
                        });
                }
                return { task, phrases };
            } catch (err) {
                return {
                    task,
                    error: err instanceof Error ? err.message : String(err),
                    phrases: [],
                };
            }
        },
        (done, total) => onProgress?.("generating", done, total),
    );

    onProgress?.("merging");
    const byAction = new Map<string, CorpusAction>();
    for (const r of results) {
        if (r.error) {
            perCallErrors.push({
                schemaName: r.task.action.schemaName,
                actionName: r.task.action.actionName,
                model: r.task.modelName,
                error: r.error,
            });
            continue;
        }
        const key = `${r.task.action.schemaName}.${r.task.action.actionName}`;
        let slot = byAction.get(key);
        if (!slot) {
            slot = {
                schemaName: r.task.action.schemaName,
                actionName: r.task.action.actionName,
                description: r.task.action.actionDescription,
                phrases: [],
            };
            byAction.set(key, slot);
        }
        for (const p of r.phrases) {
            const existing = slot.phrases.find(
                (x) => x.text.toLowerCase() === p.text.toLowerCase(),
            );
            if (existing) {
                if (
                    !existing.sources.some(
                        (s) => s.model === p.model && s.style === p.style,
                    )
                ) {
                    existing.sources.push({
                        model: p.model,
                        style: p.style,
                    });
                }
            } else {
                slot.phrases.push({
                    text: p.text,
                    sources: [{ model: p.model, style: p.style }],
                });
            }
        }
    }
    const corpus: Corpus = {
        scannedAt: new Date().toISOString(),
        models: opts.models,
        sampledSchemas: opts.schemas,
        actionCount: byAction.size,
        actions: Array.from(byAction.values()).sort((a, b) =>
            `${a.schemaName}.${a.actionName}`.localeCompare(
                `${b.schemaName}.${b.actionName}`,
            ),
        ),
    };
    return {
        corpus,
        errorCount: perCallErrors.length,
        failedSchemas,
        perCallErrors,
    };
}

// =============================================================================
// Probe replay
// =============================================================================

function normalizeAction(s: string): string {
    let n = String(s).toLowerCase();
    if (n.endsWith("action")) n = n.slice(0, -"action".length);
    return n;
}

function strictActionsMatch(
    s1: string,
    a1: string,
    s2: string,
    a2: string,
): boolean {
    return s1 === s2 && normalizeAction(a1) === normalizeAction(a2);
}

function prefixActionsMatch(
    s1: string,
    a1: string,
    s2: string,
    a2: string,
): boolean {
    if (s1 !== s2) return false;
    const n1 = normalizeAction(a1);
    const n2 = normalizeAction(a2);
    if (n1 === n2) return true;
    if (n1.length === 0 || n2.length === 0) return false;
    return n1.startsWith(n2) || n2.startsWith(n1);
}

function classify(
    top1Match: boolean,
    deltaToNext: number | undefined,
    threshold: number,
): Verdict {
    if (!top1Match) return "MISROUTE";
    if (deltaToNext === undefined || deltaToNext < threshold) return "TIGHT";
    return "CLEAN";
}

interface ProbeOpts {
    delta: number;
    top: number;
}

async function probeCorpus(
    systemContext: CommandHandlerContext,
    corpus: Corpus,
    corpusPath: string,
    opts: ProbeOpts,
    onProgress?: (done: number, total: number) => void,
): Promise<ProbeFile> {
    interface Task {
        schemaName: string;
        actionName: string;
        description?: string | undefined;
        phraseText: string;
        phraseSources: CorpusPhraseSource[];
    }
    const tasks: Task[] = [];
    for (const action of corpus.actions) {
        for (const phrase of action.phrases) {
            tasks.push({
                schemaName: action.schemaName,
                actionName: action.actionName,
                description: action.description,
                phraseText: phrase.text,
                phraseSources: phrase.sources,
            });
        }
    }

    const results: ProbeResult[] = [];
    const t0 = Date.now();
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        try {
            // Filter `() => true` so we score every loaded schema, even
            // ones that aren't currently active in this session — the
            // user's session is typically a subset, but the corpus was
            // generated against the full set.
            const ranking =
                await systemContext.agents.semanticSearchActionSchema(
                    t.phraseText,
                    opts.top,
                    () => true,
                );
            const rows: ProbeRow[] = (ranking ?? []).map((r: any) => ({
                schemaName: r.item.actionSchemaFile.schemaName,
                actionName: r.item.definition.name,
                score: r.score,
            }));
            for (let k = 0; k < rows.length - 1; k++) {
                rows[k].deltaToNext = rows[k].score - rows[k + 1].score;
            }
            const top1 = rows[0];
            const top1MatchesExpected =
                top1 !== undefined &&
                strictActionsMatch(
                    top1.schemaName,
                    top1.actionName,
                    t.schemaName,
                    t.actionName,
                );
            const verdict = classify(
                top1MatchesExpected,
                top1?.deltaToNext,
                opts.delta,
            );
            results.push({
                schemaName: t.schemaName,
                actionName: t.actionName,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                rows,
                top1: top1
                    ? { ...top1, matchesExpected: top1MatchesExpected }
                    : undefined,
                verdict,
            });
        } catch (err) {
            results.push({
                schemaName: t.schemaName,
                actionName: t.actionName,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                rows: [],
                error: err instanceof Error ? err.message : String(err),
                verdict: "ERROR",
            });
        }
        onProgress?.(i + 1, tasks.length);
    }
    const elapsedMs = Date.now() - t0;
    return aggregateProbeResults(results, opts, elapsedMs, corpusPath);
}

function aggregateProbeResults(
    results: ProbeResult[],
    opts: ProbeOpts,
    elapsedMs: number,
    corpusPath: string,
    extra?: Partial<ProbeSummary>,
): ProbeFile {
    const counts: Record<Verdict, number> = {
        CLEAN: 0,
        TIGHT: 0,
        MISROUTE: 0,
        ERROR: 0,
    };
    const perAction = new Map<string, PerActionRow>();
    const perModel = new Map<string, PerSourceRow>();
    const perStyle = new Map<string, PerSourceRow>();
    const misrouteEdges = new Map<string, number>();

    for (const r of results) {
        counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
        const aKey = `${r.schemaName}.${r.actionName}`;
        let aRow = perAction.get(aKey);
        if (!aRow) {
            aRow = {
                schemaName: r.schemaName,
                actionName: r.actionName,
                CLEAN: 0,
                TIGHT: 0,
                MISROUTE: 0,
                ERROR: 0,
                total: 0,
            };
            perAction.set(aKey, aRow);
        }
        aRow[r.verdict] = (aRow[r.verdict] ?? 0) + 1;
        aRow.total++;
        for (const src of r.phraseSources ?? []) {
            let mRow = perModel.get(src.model);
            if (!mRow) {
                mRow = {
                    model: src.model,
                    CLEAN: 0,
                    TIGHT: 0,
                    MISROUTE: 0,
                    ERROR: 0,
                    total: 0,
                };
                perModel.set(src.model, mRow);
            }
            mRow[r.verdict] = (mRow[r.verdict] ?? 0) + 1;
            mRow.total++;
            let sRow = perStyle.get(src.style);
            if (!sRow) {
                sRow = {
                    style: src.style,
                    CLEAN: 0,
                    TIGHT: 0,
                    MISROUTE: 0,
                    ERROR: 0,
                    total: 0,
                };
                perStyle.set(src.style, sRow);
            }
            sRow[r.verdict] = (sRow[r.verdict] ?? 0) + 1;
            sRow.total++;
        }
        if (r.verdict === "MISROUTE" && r.top1) {
            const key = `${r.schemaName}.${r.actionName} → ${r.top1.schemaName}.${r.top1.actionName}`;
            misrouteEdges.set(key, (misrouteEdges.get(key) ?? 0) + 1);
        }
    }

    const summary: ProbeSummary = {
        scannedAt: new Date().toISOString(),
        corpus: corpusPath,
        elapsedMs,
        delta: opts.delta,
        top: opts.top,
        totalPhrases: results.length,
        counts,
        perAction: Array.from(perAction.values()).sort(
            (a, b) =>
                b.MISROUTE + b.TIGHT - (a.MISROUTE + a.TIGHT) ||
                a.actionName.localeCompare(b.actionName),
        ),
        perModel: Array.from(perModel.values()),
        perStyle: Array.from(perStyle.values()),
        misrouteEdges: Array.from(misrouteEdges.entries())
            .map(([edge, count]) => ({ edge, count }))
            .sort((a, b) => b.count - a.count),
        ...extra,
    };
    return { summary, results };
}

// =============================================================================
// Reanalyze (prefix-aware reclassification)
// =============================================================================

function reanalyzeProbeResults(
    probeFile: ProbeFile,
    delta: number,
): ProbeFile {
    for (const r of probeFile.results) {
        if (r.error || !r.top1) continue;
        const top1 = r.rows[0] ?? r.top1;
        const matches = prefixActionsMatch(
            top1.schemaName,
            top1.actionName,
            r.schemaName,
            r.actionName,
        );
        const deltaToNext = top1.deltaToNext;
        r.top1.matchesExpected = matches;
        r.verdict = classify(matches, deltaToNext, delta);
    }
    return aggregateProbeResults(
        probeFile.results,
        { delta, top: probeFile.summary.top },
        probeFile.summary.elapsedMs,
        probeFile.summary.corpus,
        { reclassifiedAt: new Date().toISOString() },
    );
}

// =============================================================================
// Visualization payload
// =============================================================================

interface VizCellEdge {
    exp: string;
    act: string;
    count: number;
}
interface VizCell {
    row: string;
    col: string;
    misroute: number;
    tight: number;
    clean: number;
    total: number;
    sameAgent: boolean;
    topActionEdges: VizCellEdge[];
}
interface VizSankeyEdge {
    expected: string;
    actual: string;
    count: number;
    samples: { phrase: string; model?: string; style?: string }[];
}
interface VizPayload {
    summary: {
        totalPhrases: number;
        counts: Record<Verdict, number>;
        scannedAt?: string;
        corpus?: string;
        delta?: number;
    };
    matrix: { rows: string[]; cols: string[]; cells: VizCell[] };
    sankey: VizSankeyEdge[];
    edges: VizSankeyEdge[];
    perAction: PerActionRow[];
}

function buildVisualizationPayload(
    probeFile: ProbeFile,
    sankeyTop: number,
): VizPayload {
    const results = probeFile.results;

    interface Cell {
        CLEAN: number;
        TIGHT: number;
        MISROUTE: number;
        total: number;
        edges: Map<string, number>;
    }
    const schemaMatrix = new Map<string, Map<string, Cell>>();
    function bumpMatrix(
        rowSchema: string,
        colSchema: string,
        verdict: Verdict,
    ): Cell {
        let row = schemaMatrix.get(rowSchema);
        if (!row) {
            row = new Map();
            schemaMatrix.set(rowSchema, row);
        }
        let cell = row.get(colSchema);
        if (!cell) {
            cell = {
                CLEAN: 0,
                TIGHT: 0,
                MISROUTE: 0,
                total: 0,
                edges: new Map(),
            };
            row.set(colSchema, cell);
        }
        cell[verdict as "CLEAN" | "TIGHT" | "MISROUTE"]++;
        cell.total++;
        return cell;
    }

    const edgeCounts = new Map<string, number>();
    const edgeSamples = new Map<
        string,
        { phrase: string; model?: string; style?: string }[]
    >();
    const totals: Record<Verdict, number> = {
        CLEAN: 0,
        TIGHT: 0,
        MISROUTE: 0,
        ERROR: 0,
    };

    const SEP = "";

    for (const r of results) {
        totals[r.verdict] = (totals[r.verdict] ?? 0) + 1;
        if (r.verdict === "ERROR" || !r.top1) continue;

        const expSchema = r.schemaName;
        const expAction = r.actionName;
        const actSchema = r.top1.schemaName;
        const actAction = r.top1.actionName;
        const cell = bumpMatrix(expSchema, actSchema, r.verdict);

        if (r.verdict === "MISROUTE") {
            const edgeK = `${expSchema}.${expAction}${SEP}${actSchema}.${actAction}`;
            edgeCounts.set(edgeK, (edgeCounts.get(edgeK) ?? 0) + 1);
            let samples = edgeSamples.get(edgeK);
            if (!samples) {
                samples = [];
                edgeSamples.set(edgeK, samples);
            }
            if (samples.length < 5) {
                samples.push({
                    phrase: r.phraseText,
                    model: r.phraseSources?.[0]?.model,
                    style: r.phraseSources?.[0]?.style,
                });
            }
            const inCellKey = `${expAction}${SEP}${actAction}`;
            cell.edges.set(inCellKey, (cell.edges.get(inCellKey) ?? 0) + 1);
        }
    }

    // Order rows / cols by misroute volume descending for compact heatmap.
    const rowSchemas: { schema: string; mis: number }[] = [];
    for (const [s, row] of schemaMatrix.entries()) {
        let mis = 0;
        for (const cell of row.values()) mis += cell.MISROUTE;
        if (mis > 0) rowSchemas.push({ schema: s, mis });
    }
    rowSchemas.sort(
        (a, b) => b.mis - a.mis || a.schema.localeCompare(b.schema),
    );

    const colSchemaCounts = new Map<string, number>();
    for (const row of schemaMatrix.values()) {
        for (const [colSchema, cell] of row.entries()) {
            colSchemaCounts.set(
                colSchema,
                (colSchemaCounts.get(colSchema) ?? 0) + cell.MISROUTE,
            );
        }
    }
    const colSchemas: { schema: string; mis: number }[] = [
        ...colSchemaCounts.entries(),
    ]
        .filter(([, m]) => m > 0)
        .map(([schema, mis]) => ({ schema, mis }))
        .sort((a, b) => b.mis - a.mis || a.schema.localeCompare(b.schema));

    const matrixCells: VizCell[] = [];
    for (const r of rowSchemas) {
        const row = schemaMatrix.get(r.schema)!;
        for (const c of colSchemas) {
            const cell = row.get(c.schema);
            if (!cell || cell.MISROUTE === 0) continue;
            const topActionEdges: VizCellEdge[] = [...cell.edges.entries()]
                .map(([k, v]) => {
                    const [exp, act] = k.split(SEP);
                    return { exp, act, count: v };
                })
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
            matrixCells.push({
                row: r.schema,
                col: c.schema,
                misroute: cell.MISROUTE,
                tight: cell.TIGHT,
                clean: cell.CLEAN,
                total: cell.total,
                sameAgent: r.schema === c.schema,
                topActionEdges,
            });
        }
    }

    const allEdgesSorted = [...edgeCounts.entries()]
        .map(([k, v]) => {
            const [exp, act] = k.split(SEP);
            return {
                expected: exp,
                actual: act,
                count: v,
                samples: edgeSamples.get(k) ?? [],
            };
        })
        .sort((a, b) => b.count - a.count);
    const sankeyEdges = allEdgesSorted.slice(0, sankeyTop);

    return {
        summary: {
            totalPhrases: results.length,
            counts: totals,
            scannedAt: probeFile.summary.scannedAt,
            corpus: probeFile.summary.corpus,
            delta: probeFile.summary.delta,
        },
        matrix: {
            rows: rowSchemas.map((r) => r.schema),
            cols: colSchemas.map((c) => c.schema),
            cells: matrixCells,
        },
        sankey: sankeyEdges,
        edges: allEdgesSorted,
        perAction: probeFile.summary.perAction.slice(0, 100),
    };
}

// =============================================================================
// Visualization HTML — self-contained, D3 from CDN
// =============================================================================

function buildVisualizationHTML(payload: VizPayload): string {
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    return VIZ_HTML_PREFIX + json + VIZ_HTML_SUFFIX;
}

const VIZ_HTML_PREFIX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TypeAgent collision hotspots</title>
<style>
  :root {
    --bg: #0f1217; --panel: #161a22; --ink: #e8ecf3; --muted: #8a93a3;
    --line: #242a36; --accent: #7aa2f7; --warm: #ff7a90; --warm2: #f7768e;
    --good: #9ece6a; --tight: #e0af68; --link: #7dcfff;
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  header { padding: 22px 32px 10px 32px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  header .stats { color: var(--muted); font-size: 13px; }
  header .stats b { color: var(--ink); font-weight: 600; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 12px; margin-right: 6px; border: 1px solid var(--line); }
  .pill.clean { color: var(--good); border-color: rgba(158,206,106,0.4); }
  .pill.tight { color: var(--tight); border-color: rgba(224,175,104,0.4); }
  .pill.misroute { color: var(--warm); border-color: rgba(255,122,144,0.4); }
  main { padding: 22px 32px; display: grid; grid-template-columns: 1fr; gap: 24px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 22px; }
  section h2 { margin: 0 0 6px 0; font-size: 16px; font-weight: 600; }
  section .sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  .controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .controls input, .controls select { background: #0a0d12; border: 1px solid var(--line); color: var(--ink); border-radius: 5px; padding: 5px 8px; font: inherit; }
  .controls label { color: var(--muted); font-size: 12px; }
  svg { display: block; }
  .heatmap text { fill: var(--ink); font-size: 11px; }
  .heatmap .axis-label-row { text-anchor: end; }
  .heatmap .axis-label-col { text-anchor: start; }
  .heatmap .cell { cursor: pointer; stroke: var(--bg); stroke-width: 1px; }
  .heatmap .cell.same-agent { stroke: var(--accent); stroke-width: 1.2px; }
  .heatmap .cell:hover { stroke: var(--ink); stroke-width: 1.5px; }
  .legend text { fill: var(--muted); font-size: 11px; }
  .tooltip { position: absolute; background: #0a0d12; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; pointer-events: none; font-size: 12px; max-width: 360px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); color: var(--ink); z-index: 9999; opacity: 0; transition: opacity 0.08s; }
  .tooltip b { color: var(--ink); }
  .tooltip .muted { color: var(--muted); }
  .tooltip ul { margin: 4px 0 0 0; padding-left: 16px; }
  .tooltip li { margin-bottom: 1px; }
  .sankey .link { fill: none; stroke-opacity: 0.45; transition: stroke-opacity 0.08s; }
  .sankey .link:hover { stroke-opacity: 0.95; }
  .sankey-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 10px; font-size: 12px; color: var(--ink); }
  .sankey-legend .swatch { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 12px; background: #11141b; border: 1px solid var(--line); cursor: pointer; user-select: none; transition: opacity 0.08s, border-color 0.08s, background 0.08s; }
  .sankey-legend .swatch:hover { border-color: var(--ink); }
  .sankey-legend .swatch.active { background: #1c2230; border-color: var(--ink); }
  .sankey-legend .swatch.dim { opacity: 0.35; }
  .sankey-legend .swatch i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
  .sankey-legend .swatch .muted { color: var(--muted); font-size: 11px; }
  #sankey .empty { color: var(--muted); font-size: 13px; padding: 30px 0; text-align: center; }
  .sankey .node rect { stroke: var(--bg); stroke-width: 1px; }
  .sankey .node text { fill: var(--ink); font-size: 11px; pointer-events: none; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; cursor: pointer; user-select: none; }
  th:hover { color: var(--ink); }
  td.count { text-align: right; font-variant-numeric: tabular-nums; color: var(--warm); }
  td.action { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  tr.expandable { cursor: pointer; }
  tr.expandable:hover td { background: #1c212c; }
  tr.samples td { color: var(--muted); font-size: 12px; background: #11141b; }
  tr.samples ul { margin: 0; padding-left: 18px; }
  tr.samples .style { display: inline-block; color: var(--accent); font-size: 11px; margin-right: 6px; }
  .legend-bar { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; margin-top: 8px; }
  .legend-bar .swatch { width: 220px; height: 8px; border-radius: 4px; background: linear-gradient(to right, #1a1f29, #b14f60, #ff5470); }
</style>
</head>
<body>
<header>
  <h1>TypeAgent collision hotspots</h1>
  <div class="stats" id="stats"></div>
</header>
<main>
  <section>
    <h2>Cross-agent hotspot heatmap</h2>
    <div class="sub">Each cell is the MISROUTE count for phrases generated for the row schema that the embedding ranker top-1'd to the column schema. Cells outlined in blue are within-agent (row = column). Hover for the top action pairs.</div>
    <div class="controls">
      <label><input type="checkbox" id="hideSelf" checked> Hide within-agent (diagonal)</label>
      <label>Min misroutes <input type="number" id="minMis" value="1" min="0" max="50" style="width:60px"></label>
    </div>
    <div id="heatmap"></div>
    <div class="legend-bar"><div class="swatch"></div><span>0</span><span style="flex:1"></span><span id="maxMis">max</span></div>
  </section>
  <section>
    <h2>Top action-level misroute flows</h2>
    <div class="sub">Sankey of the top <span id="topN"></span> expected → actual action edges. Width = number of phrases. Hover an edge for sample phrases. Click a legend chip to filter to one source agent.</div>
    <div id="sankey"></div>
  </section>
  <section>
    <h2>All misroute edges</h2>
    <div class="sub">Searchable. Click a row to reveal up to 5 sample phrases and the LLM model/style that generated them.</div>
    <div class="controls">
      <input type="text" id="filter" placeholder="filter by schema / action / phrase…" style="width:340px">
      <span class="pill" id="filterCount"></span>
    </div>
    <table id="edges">
      <thead>
        <tr>
          <th data-key="count">#</th>
          <th data-key="expected">expected</th>
          <th>→</th>
          <th data-key="actual">actual (top-1)</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>
</main>
<div class="tooltip" id="tt"></div>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-sankey@0.12"></script>
<script id="payload" type="application/json">`;

const VIZ_HTML_SUFFIX = `</script>
<script>
const PAYLOAD = JSON.parse(document.getElementById("payload").textContent);
const tt = document.getElementById("tt");
function showTip(html, evt) { tt.innerHTML = html; tt.style.opacity = "1"; moveTip(evt); }
function moveTip(evt) {
    const pad = 14, w = tt.offsetWidth, h = tt.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    tt.style.left = (x + window.scrollX) + "px";
    tt.style.top  = (y + window.scrollY) + "px";
}
function hideTip() { tt.style.opacity = "0"; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// Header
const c = PAYLOAD.summary.counts;
const total = PAYLOAD.summary.totalPhrases;
const pct = (n) => ((n / total) * 100).toFixed(1) + "%";
document.getElementById("stats").innerHTML =
    \`<b>\${total}</b> probe phrases · \` +
    \`<span class="pill clean">CLEAN \${c.CLEAN ?? 0} (\${pct(c.CLEAN ?? 0)})</span>\` +
    \`<span class="pill tight">TIGHT \${c.TIGHT ?? 0} (\${pct(c.TIGHT ?? 0)})</span>\` +
    \`<span class="pill misroute">MISROUTE \${c.MISROUTE ?? 0} (\${pct(c.MISROUTE ?? 0)})</span>\` +
    \` · corpus <span class="muted">\${PAYLOAD.summary.corpus ?? ""}</span>\`;

// Heatmap
function renderHeatmap() {
    const hideSelf = document.getElementById("hideSelf").checked;
    const minMis = Number(document.getElementById("minMis").value) || 0;
    const cells = PAYLOAD.matrix.cells.filter(c => (!hideSelf || !c.sameAgent) && c.misroute >= minMis);
    const rows = [...new Set(cells.map(c => c.row))].sort((a,b)=>{
        const ma = d3.sum(cells.filter(x=>x.row===a),x=>x.misroute);
        const mb = d3.sum(cells.filter(x=>x.row===b),x=>x.misroute);
        return mb - ma || a.localeCompare(b);
    });
    const cols = [...new Set(cells.map(c => c.col))].sort((a,b)=>{
        const ma = d3.sum(cells.filter(x=>x.col===a),x=>x.misroute);
        const mb = d3.sum(cells.filter(x=>x.col===b),x=>x.misroute);
        return mb - ma || a.localeCompare(b);
    });
    const cellSize = 18, labelW = 240, labelH = 180;
    const W = labelW + cols.length * cellSize + 40;
    const H = labelH + rows.length * cellSize + 40;
    const maxMis = d3.max(cells, c => c.misroute) ?? 1;
    document.getElementById("maxMis").textContent = maxMis;
    const color = d3.scaleSequential(d3.interpolateRgb("#1a1f29", "#ff5470")).domain([0, maxMis]);
    const wrap = d3.select("#heatmap").html("");
    const svg = wrap.append("svg").attr("class","heatmap").attr("width",W).attr("height",H);
    const g = svg.append("g").attr("transform", \`translate(\${labelW},\${labelH})\`);
    const x = d3.scaleBand().domain(cols).range([0, cols.length * cellSize]);
    const y = d3.scaleBand().domain(rows).range([0, rows.length * cellSize]);
    g.append("g").selectAll("text").data(rows).join("text")
        .attr("class","axis-label-row").attr("x",-8)
        .attr("y", d => y(d) + cellSize / 2 + 3).text(d => d);
    g.append("g").selectAll("text").data(cols).join("text")
        .attr("class","axis-label-col").attr("x",0).attr("y",0)
        .attr("transform", d => \`translate(\${x(d) + cellSize / 2},-8) rotate(-50)\`).text(d => d);
    g.selectAll("rect.cell").data(cells).join("rect")
        .attr("class", c => "cell" + (c.sameAgent ? " same-agent" : ""))
        .attr("x", c => x(c.col)).attr("y", c => y(c.row))
        .attr("width", cellSize - 1).attr("height", cellSize - 1)
        .attr("fill", c => color(c.misroute))
        .on("mouseenter",(evt,c)=>{
            const top = c.topActionEdges.map(e =>
                \`<li><b>\${c.row}.\${e.exp}</b> → <b>\${c.col}.\${e.act}</b> · <span class="muted">\${e.count}</span></li>\`).join("");
            showTip(\`<b>\${c.row}</b> → <b>\${c.col}</b><br><span class="muted">misroutes: \${c.misroute} / total \${c.total}</span>\` + (top?\`<ul>\${top}</ul>\`:""), evt);
        })
        .on("mousemove", moveTip).on("mouseleave", hideTip)
        .on("click",(evt,c)=>{
            document.getElementById("filter").value = c.row + " " + c.col;
            renderTable();
            document.getElementById("edges").scrollIntoView({behavior:"smooth"});
        });
}
document.getElementById("hideSelf").addEventListener("change", renderHeatmap);
document.getElementById("minMis").addEventListener("input", renderHeatmap);

// Sankey
function agentOf(qa) { return String(qa).split(".")[0]; }
let selectedAgent = null;
let SANKEY_COLOR = null, SANKEY_AGENTS = null, SANKEY_AGENT_TOTALS = null;
function ensureSankeyColor() {
    if (SANKEY_COLOR) return;
    const totals = new Map();
    for (const e of PAYLOAD.sankey) {
        const a = agentOf(e.expected);
        totals.set(a, (totals.get(a) ?? 0) + e.count);
    }
    SANKEY_AGENT_TOTALS = totals;
    SANKEY_AGENTS = [...totals.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([a])=>a);
    const palette = [...d3.schemeTableau10,"#9b59b6","#1abc9c","#e67e22","#34495e","#c0392b","#16a085","#f39c12","#8e44ad","#27ae60","#d35400"];
    SANKEY_COLOR = d3.scaleOrdinal().domain(SANKEY_AGENTS).range(palette);
}
function renderSankey() {
    ensureSankeyColor();
    const all = PAYLOAD.sankey;
    const edges = selectedAgent ? all.filter(e => agentOf(e.expected) === selectedAgent) : all;
    document.getElementById("topN").textContent = selectedAgent ? \`\${edges.length} of \${all.length}\` : edges.length;
    const color = SANKEY_COLOR, agents = SANKEY_AGENTS, agentTotals = SANKEY_AGENT_TOTALS;
    const W = 1000, H = Math.max(420, edges.length * 14);
    const wrap = d3.select("#sankey").html("");
    const legend = wrap.append("div").attr("class","sankey-legend");
    legend.append("span").attr("class","swatch all" + (selectedAgent === null ? " active" : ""))
        .html(\`<i style="background:#5a6273"></i>all <span class="muted">\${all.length} edge(s)</span>\`)
        .on("click",()=>{selectedAgent = null; renderSankey();});
    legend.selectAll("span.swatch.agent").data(agents).join("span")
        .attr("class", a => "swatch agent" + (selectedAgent === a ? " active" : "") + (selectedAgent && selectedAgent !== a ? " dim" : ""))
        .style("--c", a => color(a))
        .html(a => \`<i style="background:\${color(a)}"></i>\${a} <span class="muted">\${agentTotals.get(a)}</span>\`)
        .on("click",(evt,a)=>{ selectedAgent = (selectedAgent === a) ? null : a; renderSankey(); });
    if (edges.length === 0) { wrap.append("div").attr("class","empty").text("No edges for this agent."); return; }
    const svg = wrap.append("svg").attr("class","sankey").attr("width",W).attr("height",H);
    const nodeMap = new Map();
    function getNode(name, side) {
        const k = side + ":" + name;
        let n = nodeMap.get(k);
        if (!n) { n = { name, side, key: k }; nodeMap.set(k, n); }
        return n;
    }
    const links = edges.map(e => {
        const s = getNode(e.expected, "L"), t = getNode(e.actual, "R");
        return { source: s, target: t, value: e.count, samples: e.samples, agent: agentOf(e.expected) };
    });
    const nodes = [...nodeMap.values()];
    const sankey = d3.sankey().nodeId(n => n.key).nodeWidth(8).nodePadding(4).extent([[180,8],[W-180,H-8]]);
    const graph = sankey({
        nodes: nodes.map(n => ({...n})),
        links: links.map(l => ({...l, source: l.source.key, target: l.target.key})),
    });
    svg.append("g").selectAll("path.link").data(graph.links).join("path")
        .attr("class","link").attr("d", d3.sankeyLinkHorizontal())
        .attr("stroke", d => color(d.agent))
        .attr("stroke-width", d => Math.max(1, d.width))
        .on("mouseenter",(evt,d)=>{
            const samples = (d.samples || []).map(s => \`<li><span class="muted">[\${s.style ?? ""}]</span> \${escapeHtml(s.phrase)}</li>\`).join("");
            showTip(\`<b>\${d.source.name}</b> → <b>\${d.target.name}</b><br><span class="muted">\${d.value} phrase(s) · agent \${d.agent}</span>\` + (samples?\`<ul>\${samples}</ul>\`:""), evt);
        })
        .on("mousemove", moveTip).on("mouseleave", hideTip);
    const node = svg.append("g").selectAll("g.node").data(graph.nodes).join("g").attr("class","node");
    node.append("rect").attr("x",d=>d.x0).attr("y",d=>d.y0)
        .attr("width",d=>d.x1-d.x0).attr("height",d=>Math.max(1,d.y1-d.y0))
        .attr("fill", d => d.side === "L" ? color(agentOf(d.name)) : "#5a6273");
    node.append("text").attr("x", d => d.side === "L" ? d.x0 - 6 : d.x1 + 6)
        .attr("y", d => (d.y0 + d.y1) / 2 + 3)
        .attr("text-anchor", d => d.side === "L" ? "end" : "start").text(d => d.name);
}

// Table
let sortKey = "count", sortDir = -1;
function renderTable() {
    const q = document.getElementById("filter").value.trim().toLowerCase();
    const tokens = q.split(/\\s+/).filter(Boolean);
    const filtered = PAYLOAD.edges.filter(e => {
        if (tokens.length === 0) return true;
        const blob = [e.expected, e.actual, ...(e.samples || []).map(s => s.phrase)].join(" ").toLowerCase();
        return tokens.every(t => blob.includes(t));
    });
    filtered.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === "string") return sortDir * av.localeCompare(bv);
        return sortDir * (av - bv);
    });
    document.getElementById("filterCount").textContent = \`\${filtered.length} edges · \${d3.sum(filtered, e => e.count)} phrases\`;
    const tbody = document.querySelector("#edges tbody");
    tbody.innerHTML = "";
    for (const e of filtered.slice(0, 500)) {
        const tr = document.createElement("tr");
        tr.className = "expandable";
        tr.innerHTML = \`<td class="count">\${e.count}</td><td class="action">\${escapeHtml(e.expected)}</td><td class="muted">→</td><td class="action">\${escapeHtml(e.actual)}</td>\`;
        tbody.appendChild(tr);
        const sampleTr = document.createElement("tr");
        sampleTr.className = "samples";
        sampleTr.style.display = "none";
        sampleTr.innerHTML = \`<td colspan="4"><ul>\${(e.samples || []).map(s => \`<li><span class="style">[\${s.model ?? ""} · \${s.style ?? ""}]</span> \${escapeHtml(s.phrase)}</li>\`).join("")}</ul></td>\`;
        tbody.appendChild(sampleTr);
        tr.addEventListener("click", () => { sampleTr.style.display = sampleTr.style.display === "none" ? "" : "none"; });
    }
}
document.getElementById("filter").addEventListener("input", renderTable);
document.querySelectorAll("#edges th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
        const k = th.dataset.key;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = k === "count" ? -1 : 1; }
        renderTable();
    });
});
renderHeatmap(); renderSankey(); renderTable();
</script>
</body>
</html>`;

// =============================================================================
// In-shell summary rendering
// =============================================================================

function escapeShellHtml(s: unknown): string {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function fmtPct(n: number, total: number): string {
    if (total === 0) return "0.0%";
    return ((n / total) * 100).toFixed(1) + "%";
}

function renderProbeSummaryHTML(probeFile: ProbeFile, label: string): string {
    const c = probeFile.summary.counts;
    const total = probeFile.summary.totalPhrases;
    const elapsedSec = (probeFile.summary.elapsedMs / 1000).toFixed(1);
    const cellStyle =
        "padding:6px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;font-family:monospace;";
    const headStyle =
        "padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;font-weight:600;color:#555;";
    let topMisrouteRows = "";
    for (const e of probeFile.summary.misrouteEdges.slice(0, 10)) {
        topMisrouteRows += `<tr><td style="${cellStyle}text-align:right;color:#c44;">${e.count}</td><td style="${cellStyle}">${escapeShellHtml(e.edge)}</td></tr>`;
    }
    const topMisrouteTable = topMisrouteRows
        ? `<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:12px;color:#777;">Top 10 misroute edges</summary>
            <table style="border-collapse:collapse;font-size:12px;margin-top:4px;">
            <thead><tr><th style="${headStyle}">#</th><th style="${headStyle}">expected → actual</th></tr></thead>
            <tbody>${topMisrouteRows}</tbody></table></details>`
        : "";

    return (
        `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
        `<h3 style="margin:0 0 6px;font-size:14px;">${escapeShellHtml(label)}</h3>` +
        `<div style="font-size:12px;color:#777;margin-bottom:8px;"><b>${total}</b> phrase(s) · ${elapsedSec}s · delta=${probeFile.summary.delta}</div>` +
        `<div style="margin-bottom:8px;">` +
        `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:#080;margin-right:6px;">CLEAN ${c.CLEAN} (${fmtPct(c.CLEAN, total)})</span>` +
        `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:#c80;margin-right:6px;">TIGHT ${c.TIGHT} (${fmtPct(c.TIGHT, total)})</span>` +
        `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:#c44;margin-right:6px;">MISROUTE ${c.MISROUTE} (${fmtPct(c.MISROUTE, total)})</span>` +
        (c.ERROR > 0
            ? `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:#666;">ERROR ${c.ERROR}</span>`
            : "") +
        `</div>` +
        topMisrouteTable +
        `</div>`
    );
}

function renderProbeSummaryText(
    probeFile: ProbeFile,
    label: string,
): string[] {
    const c = probeFile.summary.counts;
    const total = probeFile.summary.totalPhrases;
    const elapsedSec = (probeFile.summary.elapsedMs / 1000).toFixed(1);
    const lines = [
        `${label}: ${total} phrase(s) in ${elapsedSec}s (delta=${probeFile.summary.delta})`,
        `  CLEAN    ${c.CLEAN} (${fmtPct(c.CLEAN, total)})`,
        `  TIGHT    ${c.TIGHT} (${fmtPct(c.TIGHT, total)})  — top-1 correct but llmSelect would flag`,
        `  MISROUTE ${c.MISROUTE} (${fmtPct(c.MISROUTE, total)})  — top-1 wrong`,
    ];
    if (c.ERROR > 0) lines.push(`  ERROR    ${c.ERROR}`);
    if (probeFile.summary.misrouteEdges.length > 0) {
        lines.push("");
        lines.push("Top misroute edges:");
        for (const e of probeFile.summary.misrouteEdges.slice(0, 10)) {
            lines.push(`  ${String(e.count).padStart(4)} ${e.edge}`);
        }
    }
    return lines;
}

// =============================================================================
// Handler: @collision corpus generate
// =============================================================================

class CollisionCorpusGenerateCommandHandler implements CommandHandler {
    public readonly description =
        "Generate an LLM-authored phrase corpus for every action in this dispatcher's loaded schemas (slow: ~12 min for the full set)";
    public readonly parameters = {
        flags: {
            schemas: {
                description:
                    "Comma-separated schemas to scan. Empty = all loaded schemas.",
                type: "string",
                optional: true,
            },
            models: {
                description: `Comma-separated chat-model names from ts/.env. Default: ${DEFAULT_MODELS.join(",")}`,
                type: "string",
                optional: true,
            },
            concurrency: {
                description: `Concurrent LLM calls (default ${DEFAULT_CONCURRENCY})`,
                type: "number",
                default: DEFAULT_CONCURRENCY,
            },
            out: {
                description:
                    "Output corpus JSON path. Default: <instanceDir>/collisions/corpus.json",
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory for default-named output files. Default: <instanceDir>/collisions",
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
        const schemas = (params.flags.schemas ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const models = params.flags.models
            ? params.flags.models
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
            : DEFAULT_MODELS;
        const concurrency = Math.max(
            1,
            params.flags.concurrency ?? DEFAULT_CONCURRENCY,
        );
        const workdir = params.flags.workdir
            ? resolveWorkdir(systemContext, params.flags.workdir)
            : undefined;
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_FILES.corpus,
        );
        ensureDir(path.dirname(outPath));

        await withReadOnlySession(context, async () => {
            displayStatus(
                `Corpus generation\nLoading action schemas…`,
                context,
            );
            const t0 = Date.now();
            const { corpus, errorCount, failedSchemas, perCallErrors } =
                await generateCorpus(
                    systemContext,
                    { schemas, models, concurrency },
                    (phase, done, total) => {
                        if (phase === "loading") {
                            displayStatus(
                                `Corpus generation\nLoading action schemas…`,
                                context,
                            );
                        } else if (phase === "generating") {
                            const eta =
                                done && total && done > 0
                                    ? `, ETA ~${Math.round(
                                          ((Date.now() - t0) / done) *
                                              (total - done) /
                                              1000,
                                      )}s`
                                    : "";
                            displayStatus(
                                `Corpus generation\n[${done}/${total}] generating phrases (${models.length} model(s), concurrency ${concurrency}${eta})`,
                                context,
                            );
                        } else {
                            displayStatus(
                                `Corpus generation\nMerging results…`,
                                context,
                            );
                        }
                    },
                );

            fs.writeFileSync(outPath, JSON.stringify(corpus, null, 2));
            const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
            const totalPhrases = corpus.actions.reduce(
                (n, a) => n + a.phrases.length,
                0,
            );

            const skippedNote = failedSchemas.length
                ? `<div style="color:#c80;font-size:11px;margin-top:6px;">Skipped ${failedSchemas.length} schema(s) that failed to load: ${failedSchemas.map((f) => `<code>${escapeShellHtml(f.schemaName)}</code>`).join(", ")}</div>`
                : "";
            const errorNote = errorCount
                ? `<div style="color:#c80;font-size:11px;margin-top:4px;">${errorCount} per-call error(s) — see ${outPath}.errors.json</div>`
                : "";
            if (perCallErrors.length > 0) {
                fs.writeFileSync(
                    outPath + ".errors.json",
                    JSON.stringify(perCallErrors, null, 2),
                );
            }
            const html =
                `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
                `<h3 style="margin:0 0 6px;font-size:14px;">Corpus generated</h3>` +
                `<div style="font-size:12px;color:#777;margin-bottom:6px;"><b>${corpus.actionCount}</b> action(s) · <b>${totalPhrases}</b> unique phrase(s) · ${elapsedSec}s · models <code>${escapeShellHtml(models.join(", "))}</code></div>` +
                `<div style="font-size:12px;">→ <code>${escapeShellHtml(outPath)}</code></div>` +
                skippedNote +
                errorNote +
                `</div>`;
            const text = [
                `Corpus generated: ${corpus.actionCount} actions, ${totalPhrases} phrases in ${elapsedSec}s`,
                `  → ${outPath}`,
            ];
            if (failedSchemas.length)
                text.push(
                    `  Skipped: ${failedSchemas.map((f) => f.schemaName).join(", ")}`,
                );
            if (errorCount)
                text.push(
                    `  ${errorCount} per-call error(s) → ${outPath}.errors.json`,
                );
            context.actionIO.appendDisplay({
                type: "html",
                content: html,
                alternates: [{ type: "text", content: text }],
            });
        });
    }
}

// =============================================================================
// Handler: @collision corpus probe
// =============================================================================

class CollisionCorpusProbeCommandHandler implements CommandHandler {
    public readonly description =
        "Replay a phrase corpus through the embedding ranker and classify each phrase as CLEAN / TIGHT / MISROUTE";
    public readonly parameters = {
        flags: {
            in: {
                description:
                    "Input corpus JSON path. Default: <workdir>/corpus.json",
                type: "string",
                optional: true,
            },
            out: {
                description:
                    "Output probe-results JSON path. Default: <workdir>/probe-results.json",
                type: "string",
                optional: true,
            },
            top: {
                description: `Candidate rows kept per probe (default ${DEFAULT_PROBE_TOP})`,
                type: "number",
                default: DEFAULT_PROBE_TOP,
            },
            delta: {
                description: `Tight-vs-clean threshold (default ${DEFAULT_DELTA})`,
                type: "number",
                default: DEFAULT_DELTA,
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
        const inPath = defaultPath(
            systemContext,
            params.flags.in,
            workdir,
            DEFAULT_FILES.corpus,
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_FILES.probe,
        );
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Corpus file not found: ${inPath}. Generate one with \`@collision corpus generate\`.`,
                context,
            );
            return;
        }
        const top = Math.max(1, params.flags.top ?? DEFAULT_PROBE_TOP);
        const delta = Math.max(0, params.flags.delta ?? DEFAULT_DELTA);

        ensureDir(path.dirname(outPath));

        await withReadOnlySession(context, async () => {
            displayStatus(`Probe replay\nLoading ${inPath}…`, context);
            const corpus = JSON.parse(
                fs.readFileSync(inPath, "utf8"),
            ) as Corpus;
            const totalPhrases = corpus.actions.reduce(
                (n, a) => n + a.phrases.length,
                0,
            );
            displayStatus(
                `Probe replay\n[0/${totalPhrases}] starting…`,
                context,
            );
            const probeFile = await probeCorpus(
                systemContext,
                corpus,
                inPath,
                { top, delta },
                (done, total) => {
                    if (done % 25 === 0 || done === total) {
                        displayStatus(
                            `Probe replay\n[${done}/${total}]`,
                            context,
                        );
                    }
                },
            );
            fs.writeFileSync(outPath, JSON.stringify(probeFile, null, 2));
            const html =
                renderProbeSummaryHTML(probeFile, "Probe replay complete") +
                `<div style="font-family:system-ui,sans-serif;font-size:12px;padding:0 8px 8px;color:#777;">→ <code>${escapeShellHtml(outPath)}</code></div>`;
            const text = renderProbeSummaryText(
                probeFile,
                "Probe replay complete",
            );
            text.push(`  → ${outPath}`);
            context.actionIO.appendDisplay({
                type: "html",
                content: html,
                alternates: [{ type: "text", content: text }],
            });
        });
    }
}

// =============================================================================
// Handler: @collision corpus reanalyze
// =============================================================================

class CollisionCorpusReanalyzeCommandHandler implements CommandHandler {
    public readonly description =
        "Re-classify saved probe results with prefix-aware action matching (recovers misroutes that were just naming differences)";
    public readonly parameters = {
        flags: {
            in: {
                description:
                    "Input probe-results JSON. Default: <workdir>/probe-results.json",
                type: "string",
                optional: true,
            },
            out: {
                description:
                    "Output reclassified JSON. Default: <workdir>/probe-results-reclassified.json",
                type: "string",
                optional: true,
            },
            delta: {
                description: `Tight-vs-clean threshold (default ${DEFAULT_DELTA})`,
                type: "number",
                default: DEFAULT_DELTA,
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
        const inPath = defaultPath(
            systemContext,
            params.flags.in,
            workdir,
            DEFAULT_FILES.probe,
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_FILES.reclassified,
        );
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Probe results file not found: ${inPath}. Run \`@collision corpus probe\` first.`,
                context,
            );
            return;
        }
        const delta = Math.max(0, params.flags.delta ?? DEFAULT_DELTA);
        ensureDir(path.dirname(outPath));

        const probeFile = JSON.parse(
            fs.readFileSync(inPath, "utf8"),
        ) as ProbeFile;
        const oldCounts = { ...probeFile.summary.counts };
        const reanalyzed = reanalyzeProbeResults(probeFile, delta);
        fs.writeFileSync(outPath, JSON.stringify(reanalyzed, null, 2));

        const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
        const c = reanalyzed.summary.counts;
        const dCLEAN = sign(c.CLEAN - (oldCounts.CLEAN ?? 0));
        const dTIGHT = sign(c.TIGHT - (oldCounts.TIGHT ?? 0));
        const dMIS = sign(c.MISROUTE - (oldCounts.MISROUTE ?? 0));
        const html =
            renderProbeSummaryHTML(reanalyzed, "Reclassified") +
            `<div style="font-family:system-ui,sans-serif;font-size:12px;padding:0 8px;color:#777;">Δ from original: CLEAN ${dCLEAN} · TIGHT ${dTIGHT} · MISROUTE ${dMIS}</div>` +
            `<div style="font-family:system-ui,sans-serif;font-size:12px;padding:0 8px 8px;color:#777;">→ <code>${escapeShellHtml(outPath)}</code></div>`;
        const text = renderProbeSummaryText(reanalyzed, "Reclassified");
        text.push(
            `  Δ from original: CLEAN ${dCLEAN} · TIGHT ${dTIGHT} · MISROUTE ${dMIS}`,
        );
        text.push(`  → ${outPath}`);
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

// =============================================================================
// Handler: @collision corpus visualize
// =============================================================================

class CollisionCorpusVisualizeCommandHandler implements CommandHandler {
    public readonly description =
        "Build an interactive HTML visualization of misroute hotspots from reclassified probe results";
    public readonly parameters = {
        flags: {
            in: {
                description:
                    "Input reclassified probe-results JSON. Default: <workdir>/probe-results-reclassified.json",
                type: "string",
                optional: true,
            },
            out: {
                description:
                    "Output HTML path. Default: <workdir>/collisions-viz.html",
                type: "string",
                optional: true,
            },
            top: {
                description: `Sankey edge count (default ${DEFAULT_SANKEY_TOP})`,
                type: "number",
                default: DEFAULT_SANKEY_TOP,
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
        const inPath = defaultPath(
            systemContext,
            params.flags.in,
            workdir,
            DEFAULT_FILES.reclassified,
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_FILES.html,
        );
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Reclassified probe results not found: ${inPath}. Run \`@collision corpus reanalyze\` first.`,
                context,
            );
            return;
        }
        const sankeyTop = Math.max(1, params.flags.top ?? DEFAULT_SANKEY_TOP);
        ensureDir(path.dirname(outPath));

        const probeFile = JSON.parse(
            fs.readFileSync(inPath, "utf8"),
        ) as ProbeFile;
        const payload = buildVisualizationPayload(probeFile, sankeyTop);
        const html = buildVisualizationHTML(payload);
        fs.writeFileSync(outPath, html);

        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
        const summary =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Visualization written</h3>` +
            `<div style="font-size:12px;color:#777;margin-bottom:6px;">${probeFile.results.length} probe(s) · ${payload.matrix.cells.length} schema-pair cells · ${payload.sankey.length} sankey edges · ${payload.edges.length} table edges · ${sizeKB} KB</div>` +
            `<div style="font-size:12px;">→ <code>${escapeShellHtml(outPath)}</code></div>` +
            `<div style="font-size:11px;color:#777;margin-top:4px;">Open in any browser.</div>` +
            `</div>`;
        const text = [
            `Visualization written: ${outPath} (${sizeKB} KB)`,
            `  ${probeFile.results.length} probes · ${payload.matrix.cells.length} schema-pair cells · ${payload.sankey.length} sankey edges · ${payload.edges.length} table edges`,
            `  Open in any browser.`,
        ];
        context.actionIO.appendDisplay({
            type: "html",
            content: summary,
            alternates: [{ type: "text", content: text }],
        });
    }
}

// =============================================================================
// Handler: @collision corpus run — orchestrator
// =============================================================================

const RUN_STEPS = ["generate", "probe", "reanalyze", "visualize"] as const;
type RunStep = (typeof RUN_STEPS)[number];

class CollisionCorpusRunCommandHandler implements CommandHandler {
    public readonly description =
        "Run the full corpus pipeline (generate → probe → reanalyze → visualize) with consistent file naming";
    public readonly parameters = {
        flags: {
            from: {
                description: `Resume from a step: ${RUN_STEPS.join(" | ")} (default generate)`,
                type: "string",
                default: "generate",
            },
            workdir: {
                description:
                    "Directory for intermediate files. Default: <instanceDir>/collisions",
                type: "string",
                optional: true,
            },
            schemas: {
                description: "Comma-separated schemas (corpus only)",
                type: "string",
                optional: true,
            },
            models: {
                description: "Comma-separated model names (corpus only)",
                type: "string",
                optional: true,
            },
            concurrency: {
                description: `LLM concurrency (corpus only, default ${DEFAULT_CONCURRENCY})`,
                type: "number",
                default: DEFAULT_CONCURRENCY,
            },
            delta: {
                description: `Tight-vs-clean threshold (probe + reanalyze, default ${DEFAULT_DELTA})`,
                type: "number",
                default: DEFAULT_DELTA,
            },
            top: {
                description: `Probe candidate rows (default ${DEFAULT_PROBE_TOP})`,
                type: "number",
                default: DEFAULT_PROBE_TOP,
            },
            "sankey-top": {
                description: `Sankey edge count (default ${DEFAULT_SANKEY_TOP})`,
                type: "number",
                default: DEFAULT_SANKEY_TOP,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const fromRaw = (params.flags.from ?? "generate") as string;
        if (!(RUN_STEPS as readonly string[]).includes(fromRaw)) {
            displayWarn(
                `Invalid --from "${fromRaw}". Use one of: ${RUN_STEPS.join(", ")}.`,
                context,
            );
            return;
        }
        const from = fromRaw as RunStep;
        const startIndex = RUN_STEPS.indexOf(from);
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);
        const files = {
            corpus: path.join(workdir, DEFAULT_FILES.corpus),
            probe: path.join(workdir, DEFAULT_FILES.probe),
            reclassified: path.join(workdir, DEFAULT_FILES.reclassified),
            html: path.join(workdir, DEFAULT_FILES.html),
        };

        // Verify the immediate predecessor's output exists when resuming.
        const requiredPredecessor: Record<RunStep, string | null> = {
            generate: null,
            probe: files.corpus,
            reanalyze: files.probe,
            visualize: files.reclassified,
        };
        const required = requiredPredecessor[from];
        if (required && !fs.existsSync(required)) {
            displayWarn(
                `--from ${from} requires ${required} to exist (run an earlier step first).`,
                context,
            );
            return;
        }

        const schemas = (params.flags.schemas ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const models = params.flags.models
            ? params.flags.models
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
            : DEFAULT_MODELS;
        const concurrency = Math.max(
            1,
            params.flags.concurrency ?? DEFAULT_CONCURRENCY,
        );
        const delta = Math.max(0, params.flags.delta ?? DEFAULT_DELTA);
        const top = Math.max(1, params.flags.top ?? DEFAULT_PROBE_TOP);
        const sankeyTop = Math.max(
            1,
            params.flags["sankey-top"] ?? DEFAULT_SANKEY_TOP,
        );

        await withReadOnlySession(context, async () => {
            // 1. Generate
            if (startIndex <= 0) {
                displayStatus(`Pipeline 1/4 · generate\nLoading…`, context);
                const tStep = Date.now();
                const { corpus, errorCount, failedSchemas } =
                    await generateCorpus(
                        systemContext,
                        { schemas, models, concurrency },
                        (phase, done, total) => {
                            if (phase === "generating") {
                                displayStatus(
                                    `Pipeline 1/4 · generate\n[${done}/${total}] LLM calls`,
                                    context,
                                );
                            } else if (phase === "merging") {
                                displayStatus(
                                    `Pipeline 1/4 · generate\nmerging…`,
                                    context,
                                );
                            }
                        },
                    );
                fs.writeFileSync(
                    files.corpus,
                    JSON.stringify(corpus, null, 2),
                );
                const sec = ((Date.now() - tStep) / 1000).toFixed(1);
                displayResult(
                    `Step 1/4 generate: ${corpus.actionCount} actions in ${sec}s${errorCount ? ` (${errorCount} call errors)` : ""}${failedSchemas.length ? ` (${failedSchemas.length} schemas skipped)` : ""}`,
                    context,
                );
            }
            // 2. Probe
            if (startIndex <= 1) {
                displayStatus(`Pipeline 2/4 · probe\nloading…`, context);
                const tStep = Date.now();
                const corpus = JSON.parse(
                    fs.readFileSync(files.corpus, "utf8"),
                ) as Corpus;
                const probeFile = await probeCorpus(
                    systemContext,
                    corpus,
                    files.corpus,
                    { top, delta },
                    (done, total) => {
                        if (done % 50 === 0 || done === total) {
                            displayStatus(
                                `Pipeline 2/4 · probe\n[${done}/${total}]`,
                                context,
                            );
                        }
                    },
                );
                fs.writeFileSync(
                    files.probe,
                    JSON.stringify(probeFile, null, 2),
                );
                const sec = ((Date.now() - tStep) / 1000).toFixed(1);
                const c = probeFile.summary.counts;
                displayResult(
                    `Step 2/4 probe: ${probeFile.summary.totalPhrases} phrases in ${sec}s — CLEAN ${c.CLEAN} · TIGHT ${c.TIGHT} · MISROUTE ${c.MISROUTE}`,
                    context,
                );
            }
            // 3. Reanalyze
            if (startIndex <= 2) {
                displayStatus(`Pipeline 3/4 · reanalyze\n…`, context);
                const probeFile = JSON.parse(
                    fs.readFileSync(files.probe, "utf8"),
                ) as ProbeFile;
                const oldCounts = { ...probeFile.summary.counts };
                const reanalyzed = reanalyzeProbeResults(probeFile, delta);
                fs.writeFileSync(
                    files.reclassified,
                    JSON.stringify(reanalyzed, null, 2),
                );
                const c = reanalyzed.summary.counts;
                const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
                displayResult(
                    `Step 3/4 reanalyze: CLEAN ${c.CLEAN} (${sign(c.CLEAN - (oldCounts.CLEAN ?? 0))}) · TIGHT ${c.TIGHT} (${sign(c.TIGHT - (oldCounts.TIGHT ?? 0))}) · MISROUTE ${c.MISROUTE} (${sign(c.MISROUTE - (oldCounts.MISROUTE ?? 0))})`,
                    context,
                );
            }
            // 4. Visualize
            if (startIndex <= 3) {
                displayStatus(`Pipeline 4/4 · visualize\n…`, context);
                const probeFile = JSON.parse(
                    fs.readFileSync(files.reclassified, "utf8"),
                ) as ProbeFile;
                const payload = buildVisualizationPayload(
                    probeFile,
                    sankeyTop,
                );
                const html = buildVisualizationHTML(payload);
                fs.writeFileSync(files.html, html);
                const sizeKB = (
                    fs.statSync(files.html).size / 1024
                ).toFixed(0);
                displaySuccess(
                    `Step 4/4 visualize: ${files.html} (${sizeKB} KB) — open in browser.`,
                    context,
                );
            }
        });
    }
}

// =============================================================================
// Subcommand table
// =============================================================================

export function getCollisionCorpusCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Generate phrase corpora, probe through the embedding ranker, and build the collision-hotspot visualization",
        defaultSubCommand: "run",
        commands: {
            generate: new CollisionCorpusGenerateCommandHandler(),
            probe: new CollisionCorpusProbeCommandHandler(),
            reanalyze: new CollisionCorpusReanalyzeCommandHandler(),
            visualize: new CollisionCorpusVisualizeCommandHandler(),
            run: new CollisionCorpusRunCommandHandler(),
        },
    };
}
