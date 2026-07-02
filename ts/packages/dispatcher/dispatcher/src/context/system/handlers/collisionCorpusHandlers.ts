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

import { openai } from "@typeagent/aiclient";

import {
    CommandHandlerContext,
    changeContextConfig,
} from "../../commandHandlerContext.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import {
    ActionSimilarityScanInput,
    applyStrategy,
    computeActionSimilarity,
    getStrategy,
} from "../../../translation/actionSimilarity.js";
import {
    runTranslationProbe,
    type TranslationCorpus,
    type TranslationProbeFile,
    type TranslationProbeRow,
    type UserContextMode,
} from "../../../translation/translationProbeRunner.js";
import type { UserContext } from "../../../translation/userContext.js";
import type { CollisionStrategy } from "../../session.js";

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

// Phrase-style registry for corpus generation. The first three are the
// historical default set ("base"); the remaining four are opt-in via
// `--styles` and stress-test less-common surface forms (formal politeness,
// curt commands, slang, typos). Each style produces one phrase per action
// per model when included in a generation run.
const PHRASE_STYLE_DEFS: ReadonlyArray<{
    key: string;
    label: string;
    description: string;
}> = [
    {
        key: "imperative",
        label: "IMPERATIVE",
        description: "terse, command-like.",
    },
    {
        key: "conversational",
        label: "CONVERSATIONAL",
        description: "polite or full-sentence.",
    },
    {
        key: "casual",
        label: "CASUAL",
        description: "short, idiomatic, may abbreviate or omit articles.",
    },
    {
        key: "polite",
        label: "POLITE",
        description:
            "formal and effusively polite, with hedges and pleasantries (e.g. 'Could you kindly help me with…').",
    },
    {
        key: "curt",
        label: "CURT",
        description:
            "rude, impatient, or terse to the point of brusqueness (e.g. 'Just do it', 'Stop messing around and…').",
    },
    {
        key: "slang",
        label: "SLANG",
        description:
            "casual slang or colloquial idioms (e.g. 'Yo, hit up the…', 'Fire up the…').",
    },
    {
        key: "typos",
        label: "TYPOS",
        description:
            "natural typing errors — dropped letters, transposed keys, missing spaces, etc. (e.g. 'lst tabs', 'opn the fil'). The intent must still be recoverable.",
    },
];
type PhraseStyle = string;
const PHRASE_STYLE_KEYS: readonly string[] = PHRASE_STYLE_DEFS.map(
    (d) => d.key,
);
const DEFAULT_PHRASE_STYLES: readonly string[] = [
    "imperative",
    "conversational",
    "casual",
];
const PHRASE_STYLES_BY_KEY: Map<string, (typeof PHRASE_STYLE_DEFS)[number]> =
    new Map(PHRASE_STYLE_DEFS.map((d) => [d.key, d]));

/** Parse the `--styles` flag into a deduped, validated list. Empty / unset
 *  → DEFAULT_PHRASE_STYLES. Unknown keys are surfaced as user-facing
 *  warnings; the caller bails out without running generation in that case. */
function resolveStyles(flag: string | undefined): {
    styles: string[];
    errors: string[];
} {
    if (!flag || !flag.trim()) {
        return { styles: [...DEFAULT_PHRASE_STYLES], errors: [] };
    }
    const requested = flag
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const errors: string[] = [];
    const seen = new Set<string>();
    const styles: string[] = [];
    for (const r of requested) {
        if (!PHRASE_STYLES_BY_KEY.has(r)) {
            errors.push(
                `Unknown phrase style '${r}'. Available: ${PHRASE_STYLE_KEYS.join(", ")}.`,
            );
            continue;
        }
        if (!seen.has(r)) {
            seen.add(r);
            styles.push(r);
        }
    }
    if (styles.length === 0 && errors.length === 0) {
        // Whitespace-only flag fell through.
        return { styles: [...DEFAULT_PHRASE_STYLES], errors: [] };
    }
    return { styles, errors };
}

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
    translator: "translation-results.json",
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

// Resolve and validate a `--out` value (or fall through to the default path).
// Catches the common mistake of passing a directory where a file is expected
// (e.g. `--out d:\collisions2`) and emits a clear, actionable warning before
// the underlying `mkdir` fails with a cryptic `EPERM` on the parent.
// Returns `null` when the flag is rejected; callers should bail out.
function resolveOutFilePath(
    systemContext: CommandHandlerContext,
    flag: string | undefined,
    flagName: string,
    workdir: string | undefined,
    defaultFilename: string,
    context: ActionContext<CommandHandlerContext>,
): string | null {
    if (flag === undefined) {
        const dir = workdir ?? defaultWorkdir(systemContext);
        const out = path.join(dir, defaultFilename);
        ensureDir(path.dirname(out));
        return out;
    }
    const resolved = path.resolve(flag);
    const suggestPath = path.join(
        resolved && path.dirname(resolved) !== resolved ? resolved : flag,
        defaultFilename,
    );
    // Trailing path separator → user meant a directory.
    if (/[\\/]$/.test(flag)) {
        displayWarn(
            `--${flagName} expects a file path, not a directory (${flag}). Use --workdir to set the directory, or pass a file name (e.g. --${flagName} ${suggestPath}).`,
            context,
        );
        return null;
    }
    // Drive root (e.g. "d:\") or filesystem root — `path.dirname` returns
    // the same string, so we'd fail to create any parent.
    if (path.dirname(resolved) === resolved) {
        displayWarn(
            `--${flagName} expects a file path, not a drive root (${flag}). Use --workdir to set the directory, or pass a file name (e.g. --${flagName} ${suggestPath}).`,
            context,
        );
        return null;
    }
    // Path resolves to an existing directory → user meant the directory.
    try {
        if (fs.statSync(resolved).isDirectory()) {
            displayWarn(
                `--${flagName} expects a file path, but ${flag} is an existing directory. Use --workdir ${flag} for the default file name, or pass an explicit file name (e.g. --${flagName} ${suggestPath}).`,
                context,
            );
            return null;
        }
    } catch {
        // ENOENT — fine, we'll create the parent below.
    }
    try {
        ensureDir(path.dirname(resolved));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        displayWarn(
            `Could not create parent directory for --${flagName} (${path.dirname(resolved)}): ${msg}. Did you mean to pass a file path (e.g. --${flagName} ${suggestPath}) or use --workdir for the directory?`,
            context,
        );
        return null;
    }
    return resolved;
}

// Throttled, atomic partial-results writer. Long-running pipelines call
// `snapshot(getData)` after each unit of work; this serializes writes so
// only one is in flight at a time, throttles them, and lands them via
// rename so a partially-written file is never visible to anyone reading
// it. On `finalize(data)`, the final result lands at `finalPath` (sync,
// for crash safety on the closing write) and the `.partial` file is
// removed. If the process dies mid-run, the partial file is what the
// user has to inspect or resume from.
function createThrottledFileWriter(finalPath: string, throttleMs: number) {
    const partialPath = finalPath + ".partial";
    const tmpPath = partialPath + ".tmp";
    let lastWriteAt = 0;
    let writing = false;
    let dirty = false;

    async function maybeWrite(getData: () => unknown): Promise<void> {
        if (writing) {
            dirty = true;
            return;
        }
        if (Date.now() - lastWriteAt < throttleMs) {
            dirty = true;
            return;
        }
        writing = true;
        try {
            do {
                dirty = false;
                const json = JSON.stringify(getData(), null, 2);
                await fs.promises.writeFile(tmpPath, json);
                await fs.promises.rename(tmpPath, partialPath);
                lastWriteAt = Date.now();
            } while (dirty && Date.now() - lastWriteAt >= throttleMs);
        } catch {
            // Best-effort — failures here aren't fatal; finalize will retry.
        } finally {
            writing = false;
        }
    }

    function snapshot(getData: () => unknown) {
        void maybeWrite(getData);
    }

    function finalize(data: unknown) {
        // Land the canonical file synchronously so it's guaranteed on disk
        // before we declare success. Then remove the partial.
        fs.writeFileSync(finalPath, JSON.stringify(data, null, 2));
        try {
            fs.unlinkSync(partialPath);
        } catch {
            // Already gone — fine.
        }
        try {
            fs.unlinkSync(tmpPath);
        } catch {
            // Already gone — fine.
        }
    }

    return { snapshot, finalize, partialPath };
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
    const workers = Array.from({ length: Math.max(1, concurrency) }, worker);
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
    for (const [propName, propField] of Object.entries(paramType.fields) as [
        string,
        any,
    ][]) {
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
            schemaFile = systemContext.agents.getActionSchemaFileForConfig(cfg);
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

function buildCorpusPrompt(
    action: CorpusActionInfo,
    styles: readonly string[],
): string {
    const styleDefs = styles
        .map((k) => PHRASE_STYLES_BY_KEY.get(k))
        .filter(
            (d): d is (typeof PHRASE_STYLE_DEFS)[number] => d !== undefined,
        );
    const styleLines = styleDefs.map(
        (d, i) => `  ${i + 1}. ${d.label} — ${d.description}`,
    );
    const jsonShape =
        "{" + styleDefs.map((d) => `"${d.key}":"…"`).join(",") + "}";
    const word = styles.length === 3 ? "three" : `${styles.length}`;
    return [
        "You are helping calibrate a natural-language action-routing system.",
        `Given an action that an AI agent can perform, generate ${word} example`,
        "user utterances that a real person might say to trigger this action.",
        "",
        `Agent: ${action.agentName}`,
        `Agent purpose: ${action.agentDescription || "(no description)"}`,
        `Schema: ${action.schemaName}`,
        `Action: ${action.actionName}`,
        `Action description: ${action.actionDescription || "(none provided)"}`,
        `Parameters: ${action.paramSummary || "(none)"}`,
        "",
        `Generate ${word} example utterances in distinct phrasing styles:`,
        ...styleLines,
        "",
        "If the action takes parameters with concrete values (a song name,",
        "a list name, etc.), invent plausible specific values rather than",
        "leaving placeholders.",
        "",
        `Return ONLY a JSON object: ${jsonShape}.`,
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
    /** Phrase styles to generate. Default: DEFAULT_PHRASE_STYLES (the
     *  historical "imperative / conversational / casual" set). Pass a
     *  subset or expanded set via the `--styles` flag. */
    styles: readonly string[];
}

async function generateCorpus(
    systemContext: CommandHandlerContext,
    opts: GenerateCorpusOpts,
    onProgress?: (
        phase: "loading" | "generating" | "merging",
        done?: number,
        total?: number,
    ) => void,
    onPartial?: (getCorpus: () => Corpus) => void,
): Promise<{
    corpus: Corpus;
    errorCount: number;
    failedSchemas: { schemaName: string; error: string }[];
    perCallErrors: {
        schemaName: string;
        actionName: string;
        model: string;
        error: string;
    }[];
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
        model: {
            complete: (
                prompt: string,
            ) => Promise<{ success: boolean; data?: string; message?: string }>;
        };
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

    // The merge state lives outside `pmap` so we can publish partial corpora
    // as each task completes — previously we accumulated raw results and
    // merged at the end, which meant nothing landed on disk until the whole
    // ~12-minute run finished.
    const byAction = new Map<string, CorpusAction>();

    function snapshotCorpus(): Corpus {
        return {
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
    }

    // Synchronous: invoked inside `pmap`'s runOne after the LLM call resolves.
    // Safe under concurrency because JS gives us run-to-completion semantics
    // between awaits — no two merges interleave.
    function mergeTaskResult(
        task: Task,
        phrases: { text: string; style: PhraseStyle; model: string }[],
    ) {
        const key = `${task.action.schemaName}.${task.action.actionName}`;
        let slot = byAction.get(key);
        if (!slot) {
            slot = {
                schemaName: task.action.schemaName,
                actionName: task.action.actionName,
                description: task.action.actionDescription,
                phrases: [],
            };
            byAction.set(key, slot);
        }
        for (const p of phrases) {
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

    onProgress?.("generating", 0, tasks.length);
    await pmap<Task, void>(
        tasks,
        opts.concurrency,
        async (task) => {
            const prompt = buildCorpusPrompt(task.action, opts.styles);
            try {
                const result = await task.model.complete(prompt);
                if (!result.success) {
                    perCallErrors.push({
                        schemaName: task.action.schemaName,
                        actionName: task.action.actionName,
                        model: task.modelName,
                        error: result.message ?? "unknown failure",
                    });
                    return;
                }
                let parsed: any;
                try {
                    parsed = JSON.parse(extractJSON(result.data ?? ""));
                } catch (err) {
                    perCallErrors.push({
                        schemaName: task.action.schemaName,
                        actionName: task.action.actionName,
                        model: task.modelName,
                        error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
                    });
                    return;
                }
                const phrases: {
                    text: string;
                    style: PhraseStyle;
                    model: string;
                }[] = [];
                for (const style of opts.styles) {
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
                mergeTaskResult(task, phrases);
                onPartial?.(snapshotCorpus);
            } catch (err) {
                perCallErrors.push({
                    schemaName: task.action.schemaName,
                    actionName: task.action.actionName,
                    model: task.modelName,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        },
        (done, total) => onProgress?.("generating", done, total),
    );

    onProgress?.("merging");
    const corpus = snapshotCorpus();
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

interface ProbeOptsWithConcurrency extends ProbeOpts {
    concurrency: number;
}

async function probeCorpus(
    systemContext: CommandHandlerContext,
    corpus: Corpus,
    corpusPath: string,
    opts: ProbeOptsWithConcurrency,
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

    // `semanticSearchActionSchema` is a pure embedding lookup (one HTTP call
    // for the request embedding, then in-memory cosine similarity vs a cached
    // matrix). It's safely parallelizable — running N at a time scales close
    // to linearly until the embedding API is rate-limited. Default
    // concurrency 8 brings full-corpus probes down from ~12 min serial to
    // under 2 min on the existing data.
    const t0 = Date.now();
    const results: ProbeResult[] = await pmap(
        tasks,
        opts.concurrency,
        async (t) => {
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
                return {
                    schemaName: t.schemaName,
                    actionName: t.actionName,
                    phraseText: t.phraseText,
                    phraseSources: t.phraseSources,
                    rows,
                    top1: top1
                        ? { ...top1, matchesExpected: top1MatchesExpected }
                        : undefined,
                    verdict,
                };
            } catch (err) {
                return {
                    schemaName: t.schemaName,
                    actionName: t.actionName,
                    phraseText: t.phraseText,
                    phraseSources: t.phraseSources,
                    rows: [],
                    error: err instanceof Error ? err.message : String(err),
                    verdict: "ERROR" as Verdict,
                };
            }
        },
        onProgress,
    );
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

function reanalyzeProbeResults(probeFile: ProbeFile, delta: number): ProbeFile {
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
// Recovery-rank analysis (runtime-aware)
//
// At runtime, `llmSelect` is the *schema* selector — it picks a single schema
// based on the embedding ranker's top-1 result, then the LLM translates the
// request against that schema's full action list (plus "switch" stubs to
// other schemas). The strategy choice (`first-match` / `score-rank` /
// `priority` / `user-clarify`) operates on the cluster of candidates within
// `scoreDeltaThreshold` of top-1, but only ever returns a *schema name*.
//
// This means a "MISROUTE" in our probe data — where the embedding's top-1
// action is wrong — splits into very different runtime risks depending on
// whether the *schema* was right:
//
//   sameSchema        — top-1 schema matches the expected schema. The
//                       embedding's "wrong action" is a sibling within the
//                       right schema. At runtime the LLM gets the full action
//                       list and picks; this slice is probably benign and
//                       not a real dispatch problem.
//   crossInCluster    — top-1 schema differs, but the expected schema also
//                       has a candidate within `scoreDeltaThreshold` of
//                       top-1.  llmSelect would build a multi-schema cluster;
//                       a non-default strategy (score-rank / priority /
//                       user-clarify) could pick the right schema.  This is
//                       the slice the E2.x rollout experiments target.
//   crossOutOfCluster — top-1 schema differs, expected schema appears in the
//                       top-K but no candidate from it is within delta of
//                       top-1.  llmSelect doesn't flag a collision, so
//                       strategy choice is irrelevant.  Would need a wider
//                       threshold.
//   crossOffList      — top-1 schema differs and the expected schema doesn't
//                       appear in the top-K at all.  The embedding ranker is
//                       genuinely losing the right *agent*.  Only rescue is
//                       a switch-stub from the LLM during translation, or
//                       upstream fixes (schema tightening, embedding scorer).
//
// The action-level rank-of-correct (where the *exact* expected action sits
// in the top-K) is preserved as a secondary chart — it's the embedding
// ranker's internal calibration view, not the runtime story.
// =============================================================================

type RuntimeBucket =
    | "sameSchema"
    | "crossInCluster"
    | "crossOutOfCluster"
    | "crossOffList";

interface PerActionRecovery {
    schemaName: string;
    actionName: string;
    misrouteCount: number;
    sameSchema: number;
    crossInCluster: number;
    crossOutOfCluster: number;
    crossOffList: number;
}

interface RecoveryAnalysis {
    delta: number;
    topK: number;
    totalMisroutes: number;
    buckets: Record<RuntimeBucket, number>;
    perAction: PerActionRecovery[];
}

/** 1-based rank of the first row whose schemaName equals `expectedSchema`,
 * or -1 if no row matches. Returns the row too so callers can inspect the
 * score gap to top-1. */
function findExpectedSchemaInRows(
    rows: ProbeRow[],
    expectedSchema: string,
): { rank: number; row: ProbeRow | undefined } {
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].schemaName === expectedSchema) {
            return { rank: i + 1, row: rows[i] };
        }
    }
    return { rank: -1, row: undefined };
}

/** 1-based rank of the (prefix-matched) expected *action* in `rows`, or -1
 * if not present. Used for the secondary "where does the action rank?"
 * histogram — informative as embedding-ranker calibration. */
function findExpectedActionRank(
    rows: ProbeRow[],
    expectedSchema: string,
    expectedAction: string,
): number {
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (
            prefixActionsMatch(
                r.schemaName,
                r.actionName,
                expectedSchema,
                expectedAction,
            )
        ) {
            return i + 1;
        }
    }
    return -1;
}

function bucketizeRuntime(
    rows: ProbeRow[],
    expectedSchema: string,
    threshold: number,
): RuntimeBucket {
    if (rows.length === 0) return "crossOffList";
    const top1 = rows[0];
    if (top1.schemaName === expectedSchema) return "sameSchema";
    const found = findExpectedSchemaInRows(rows, expectedSchema);
    if (found.rank < 0 || !found.row) return "crossOffList";
    if (top1.score - found.row.score < threshold) return "crossInCluster";
    return "crossOutOfCluster";
}

function analyzeRecoveryRank(
    probeFile: ProbeFile,
    delta: number,
): RecoveryAnalysis {
    const buckets: Record<RuntimeBucket, number> = {
        sameSchema: 0,
        crossInCluster: 0,
        crossOutOfCluster: 0,
        crossOffList: 0,
    };
    const perAction = new Map<string, PerActionRecovery>();
    let totalMisroutes = 0;

    for (const r of probeFile.results) {
        if (r.verdict !== "MISROUTE") continue;
        totalMisroutes++;
        const bucket = bucketizeRuntime(r.rows, r.schemaName, delta);
        buckets[bucket]++;

        const key = `${r.schemaName}.${r.actionName}`;
        let row = perAction.get(key);
        if (!row) {
            row = {
                schemaName: r.schemaName,
                actionName: r.actionName,
                misrouteCount: 0,
                sameSchema: 0,
                crossInCluster: 0,
                crossOutOfCluster: 0,
                crossOffList: 0,
            };
            perAction.set(key, row);
        }
        row.misrouteCount++;
        row[bucket]++;
    }

    return {
        delta,
        topK: probeFile.summary.top,
        totalMisroutes,
        buckets,
        perAction: [...perAction.values()].sort(
            (a, b) =>
                b.misrouteCount - a.misrouteCount ||
                a.actionName.localeCompare(b.actionName),
        ),
    };
}

// =============================================================================
// Recovery visualization payload + HTML
// =============================================================================

interface RecoveryVizPhrase {
    expected: string;
    actualTop1: string;
    phrase: string;
    bucket: RuntimeBucket;
    /** Rank of the expected *action* in the top-K (1-based; -1 = off-list).
     *  Independent of the bucket — informative for the embedding-rank
     *  histogram only. */
    actionRank: number;
    /** Rank of the expected *schema* in the top-K (1-based; -1 = not present). */
    schemaRank: number;
    top1Score: number;
    /** Score of the highest-scoring candidate in the expected schema (if any). */
    expectedSchemaTopScore?: number | undefined;
    deltaTop1ToExpectedSchema?: number | undefined;
    model?: string | undefined;
    style?: string | undefined;
}

interface RecoveryVizPerAction extends PerActionRecovery {
    /** Anything *not* sameSchema or crossOffList — the slice that runtime
     *  llmSelect strategy / threshold tuning could potentially reach. */
    crossRescuable: number;
    /** Fraction (0-100) of misroutes that are likely-benign (sameSchema). */
    benignPct: number;
}

interface RecoveryVizPayload {
    summary: {
        totalMisroutes: number;
        topK: number;
        delta: number;
        buckets: Record<RuntimeBucket, number>;
    };
    perAction: RecoveryVizPerAction[];
    perAgent: Array<{
        agent: string;
        misrouteCount: number;
        sameSchema: number;
        crossInCluster: number;
        crossOutOfCluster: number;
        crossOffList: number;
        crossRescuable: number;
        benignPct: number;
    }>;
    /** Embedding-side calibration: at what rank does the expected *action*
     *  appear in the top-K? Secondary chart (the schema-aware buckets are
     *  the primary runtime story). */
    actionRankHistogram: Array<{ rank: string; count: number }>;
    phrases: RecoveryVizPhrase[];
}

function buildRecoveryPayload(
    probeFile: ProbeFile,
    delta: number,
): RecoveryVizPayload {
    const analysis = analyzeRecoveryRank(probeFile, delta);

    const phrases: RecoveryVizPhrase[] = [];
    const rankCounts: Record<string, number> = {};

    for (const r of probeFile.results) {
        if (r.verdict !== "MISROUTE") continue;
        const top1 = r.rows[0];
        const bucket = bucketizeRuntime(r.rows, r.schemaName, delta);
        const actionRank = findExpectedActionRank(
            r.rows,
            r.schemaName,
            r.actionName,
        );
        const expectedSchema = findExpectedSchemaInRows(r.rows, r.schemaName);
        const rankKey = actionRank > 0 ? String(actionRank) : "off-list";
        rankCounts[rankKey] = (rankCounts[rankKey] ?? 0) + 1;
        phrases.push({
            expected: `${r.schemaName}.${r.actionName}`,
            actualTop1: r.top1
                ? `${r.top1.schemaName}.${r.top1.actionName}`
                : "—",
            phrase: r.phraseText,
            bucket,
            actionRank,
            schemaRank: expectedSchema.rank,
            top1Score: top1?.score ?? 0,
            expectedSchemaTopScore: expectedSchema.row?.score,
            deltaTop1ToExpectedSchema:
                top1 && expectedSchema.row
                    ? top1.score - expectedSchema.row.score
                    : undefined,
            model: r.phraseSources?.[0]?.model,
            style: r.phraseSources?.[0]?.style,
        });
    }

    const actionRankHistogram: { rank: string; count: number }[] = [];
    for (let r = 1; r <= analysis.topK; r++) {
        actionRankHistogram.push({
            rank: String(r),
            count: rankCounts[String(r)] ?? 0,
        });
    }
    actionRankHistogram.push({
        rank: "off-list",
        count: rankCounts["off-list"] ?? 0,
    });

    // Per-agent rollup (first segment of schema name).
    const perAgentMap = new Map<
        string,
        {
            agent: string;
            misrouteCount: number;
            sameSchema: number;
            crossInCluster: number;
            crossOutOfCluster: number;
            crossOffList: number;
        }
    >();
    for (const a of analysis.perAction) {
        const agent = a.schemaName.split(".")[0];
        let row = perAgentMap.get(agent);
        if (!row) {
            row = {
                agent,
                misrouteCount: 0,
                sameSchema: 0,
                crossInCluster: 0,
                crossOutOfCluster: 0,
                crossOffList: 0,
            };
            perAgentMap.set(agent, row);
        }
        row.misrouteCount += a.misrouteCount;
        row.sameSchema += a.sameSchema;
        row.crossInCluster += a.crossInCluster;
        row.crossOutOfCluster += a.crossOutOfCluster;
        row.crossOffList += a.crossOffList;
    }
    const perAgent = [...perAgentMap.values()]
        .map((r) => ({
            ...r,
            crossRescuable: r.crossInCluster + r.crossOutOfCluster,
            benignPct:
                r.misrouteCount > 0
                    ? (r.sameSchema / r.misrouteCount) * 100
                    : 0,
        }))
        .sort((a, b) => b.misrouteCount - a.misrouteCount);

    return {
        summary: {
            totalMisroutes: analysis.totalMisroutes,
            topK: analysis.topK,
            delta: analysis.delta,
            buckets: analysis.buckets,
        },
        perAction: analysis.perAction.map((a) => ({
            ...a,
            crossRescuable: a.crossInCluster + a.crossOutOfCluster,
            benignPct:
                a.misrouteCount > 0
                    ? (a.sameSchema / a.misrouteCount) * 100
                    : 0,
        })),
        perAgent,
        actionRankHistogram,
        phrases,
    };
}

function buildRecoveryHTML(payload: RecoveryVizPayload): string {
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    return RECOVERY_HTML_PREFIX + json + RECOVERY_HTML_SUFFIX;
}

const RECOVERY_HTML_PREFIX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TypeAgent collision recovery analysis</title>
<style>
  :root {
    --bg: #0f1217; --panel: #161a22; --ink: #e8ecf3; --muted: #8a93a3;
    --line: #242a36; --accent: #7aa2f7;
    /* Bucket colors, ordered by severity:
     *   sameSchema      — embedding picked the right schema; LLM rescues
     *   crossInCluster  — wrong schema, but right schema in runtime cluster (strategy can save)
     *   crossOutOfCluster — wrong schema, right schema in top-K but outside cluster (wider window needed)
     *   crossOffList    — wrong schema, right schema not in top-K (structural / switch-stub only) */
    --b-same:  #a3e635;
    --b-in:    #60a5fa;
    --b-out:   #f59e0b;
    --b-off:   #f87171;
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  header { padding: 22px 32px 10px 32px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  header .stats { color: var(--muted); font-size: 13px; }
  header .stats b { color: var(--ink); font-weight: 600; }
  main { padding: 22px 32px; display: grid; grid-template-columns: 1fr; gap: 24px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 22px; }
  section h2 { margin: 0 0 6px 0; font-size: 16px; font-weight: 600; }
  section .sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  .controls { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .controls input, .controls select {
    background: #0a0d12; border: 1px solid var(--line); color: var(--ink);
    border-radius: 5px; padding: 5px 8px; font: inherit;
  }
  .controls label { color: var(--muted); font-size: 12px; }

  /* Per-phrase-style chips — global filter in the page header. Click to
     toggle which styles count toward EVERY chart on the page (headline
     buckets, per-agent / per-action breakdowns, rank histogram). Hidden
     when the corpus carries no per-style data. */
  header .style-chips {
    margin-top: 8px;
    padding: 6px 10px;
    background: rgba(122, 162, 247, 0.05);
    border-left: 3px solid var(--accent);
    border-radius: 0 4px 4px 0;
  }
  .style-chips { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .style-chips .label { color: var(--muted); font-size: 12px; margin-right: 4px; }
  .style-chips .chip {
    font-size: 11px; padding: 2px 9px; border-radius: 11px;
    border: 1px solid var(--line); background: #0a0d12;
    color: var(--ink); cursor: pointer; user-select: none;
    transition: background 0.08s, border-color 0.08s, opacity 0.08s;
    font-family: ui-monospace, monospace;
  }
  .style-chips .chip:hover { border-color: var(--accent); }
  .style-chips .chip.off { opacity: 0.35; background: transparent; }
  .style-chips .chip .count { color: var(--muted); margin-left: 4px; font-size: 10px; }
  .style-chips .quick { font-size: 11px; color: var(--muted); cursor: pointer; text-decoration: underline; margin-left: 8px; }
  .style-chips .quick:hover { color: var(--accent); }

  /* Headline stacked bar */
  .headline-bar {
    display: flex; height: 36px; border-radius: 4px; overflow: hidden;
    margin-bottom: 12px; cursor: pointer; user-select: none;
  }
  .headline-bar .seg {
    display: flex; align-items: center; justify-content: center;
    color: #0f1217; font-weight: 600; font-size: 13px;
    transition: filter 0.1s, opacity 0.1s;
  }
  .headline-bar .seg:hover { filter: brightness(1.15); }
  .headline-bar .seg.dim { opacity: 0.35; }
  .legend-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .legend-chips .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 14px; background: #11141b;
    border: 1px solid var(--line); cursor: pointer; user-select: none;
    font-size: 12px;
    transition: opacity 0.08s, border-color 0.08s, background 0.08s;
  }
  .legend-chips .chip:hover { border-color: var(--ink); }
  .legend-chips .chip.active { background: #1c2230; border-color: var(--ink); }
  .legend-chips .chip.dim { opacity: 0.35; }
  .legend-chips .chip i {
    display: inline-block; width: 10px; height: 10px; border-radius: 2px;
  }

  .verdict {
    margin-top: 10px; padding: 10px 12px;
    border-left: 3px solid var(--b-off); background: rgba(248, 113, 113, 0.08);
    font-size: 13px; border-radius: 0 4px 4px 0;
  }
  .verdict.tunable {
    border-left-color: var(--b-same); background: rgba(163, 230, 53, 0.08);
  }
  .verdict b { color: var(--ink); }

  /* Per-action profile */
  .action-list { display: grid; grid-template-columns: 1fr; gap: 2px; }
  .action-row {
    display: grid;
    grid-template-columns: 32ch 60px 1fr;
    align-items: center; gap: 12px;
    padding: 4px 8px;
    border-radius: 4px; cursor: pointer;
    transition: background 0.08s;
  }
  .action-row:hover { background: #1c212c; }
  .action-row.expanded { background: #1c212c; }
  .action-row .name {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px; color: var(--ink); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .action-row .total {
    font-family: ui-monospace, monospace; font-size: 12px;
    color: var(--muted); text-align: right;
  }
  .action-row .stack {
    display: flex; height: 14px; border-radius: 2px; overflow: hidden;
    background: #0a0d12;
  }
  .action-row .stack .seg { transition: filter 0.08s; }

  .action-detail {
    padding: 8px 16px 10px 44px;
    background: #11141b; border-radius: 4px;
    margin: 2px 0 6px 0;
    font-size: 12px;
  }
  .action-detail .ph {
    display: grid;
    grid-template-columns: 56px 1fr 18ch;
    gap: 10px; padding: 3px 0;
    border-bottom: 1px solid var(--line);
  }
  .action-detail .ph:last-child { border-bottom: none; }
  .action-detail .ph .rank {
    font-family: ui-monospace, monospace; font-size: 11px;
    text-align: right;
  }
  .action-detail .ph .text {
    color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .action-detail .ph .actual {
    font-family: ui-monospace, monospace; font-size: 11px;
    color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Progressive-disclosure "load more" link, shared across recovery viz. */
  .load-more {
    color: var(--accent); cursor: pointer; text-decoration: underline;
    font-size: 11px; display: inline-block; margin: 4px 0 0 8px;
  }
  .load-more:hover { color: var(--ink); }
  .more-samples-hidden { display: none; }

  /* Rank histogram */
  .rank-hist {
    display: grid; grid-template-columns: 64px 1fr 64px;
    gap: 8px; align-items: center;
    margin: 4px 0;
  }
  .rank-hist .label { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); text-align: right; }
  .rank-hist .bar { height: 14px; background: var(--accent); border-radius: 2px; }
  .rank-hist .count { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ink); }

  /* Tooltip */
  .tooltip {
    position: absolute; background: #0a0d12; border: 1px solid var(--line);
    border-radius: 6px; padding: 8px 10px; pointer-events: none; font-size: 12px;
    max-width: 380px; box-shadow: 0 6px 20px rgba(0,0,0,0.5);
    color: var(--ink); z-index: 9999; opacity: 0; transition: opacity 0.08s;
  }
  .tooltip b { color: var(--ink); }
  .tooltip .muted { color: var(--muted); }
  .tooltip ul { margin: 4px 0 0; padding-left: 16px; }

  .empty-state {
    color: var(--muted); font-style: italic;
    padding: 12px 0; font-size: 13px; text-align: center;
  }

  /* Collapsible "how to read" panel */
  details.help {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 12px 18px;
  }
  details.help > summary {
    cursor: pointer; user-select: none;
    font-weight: 600; font-size: 14px;
    list-style: none; outline: none;
    display: flex; align-items: center; gap: 8px;
  }
  details.help > summary::-webkit-details-marker { display: none; }
  details.help > summary::before {
    content: "▸"; color: var(--muted);
    font-size: 11px; transition: transform 0.1s;
    display: inline-block; width: 10px;
  }
  details.help[open] > summary::before { transform: rotate(90deg); }
  details.help[open] > summary {
    margin-bottom: 12px; padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  details.help .help-body { font-size: 13px; color: var(--ink); }
  details.help .help-body h3 {
    margin: 14px 0 6px; font-size: 13px; font-weight: 600;
    color: var(--ink);
  }
  details.help .help-body h3:first-child { margin-top: 0; }
  details.help .help-body p { margin: 4px 0 8px; }
  details.help .help-body ul { margin: 4px 0 8px; padding-left: 20px; }
  details.help .help-body li { margin: 3px 0; }
  details.help .help-body code {
    background: #11141b; padding: 1px 5px; border-radius: 2px;
    font-size: 12px; font-family: ui-monospace, monospace;
  }
  details.help .help-body .swatch {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 2px; vertical-align: middle;
    margin-right: 4px;
  }
  details.help .help-body .muted { color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Collision recovery analysis</h1>
  <div class="stats" id="stats"></div>
  <div class="style-chips" id="styleChips" style="display:none;">
    <span class="label">Phrase styles (applies to every chart on this page):</span>
    <span id="styleChipsList"></span>
    <span class="quick" data-style-all>all</span>
    <span class="quick" data-style-none>none</span>
  </div>
</header>
<main>
  <details class="help" open>
    <summary>How to read these charts</summary>
    <div class="help-body">
      <h3>What's being measured</h3>
      <p>Each input row is one phrase generated by an LLM for a specific intended action, replayed through the embedding ranker. A <b>MISROUTE</b> means the ranker's top-1 candidate wasn't the intended action. But what runtime <code>llmSelect</code> actually consumes from that ranking is the top-1 candidate's <i>schema</i> (the agent namespace), not the action — so this page splits misroutes by whether the embedding picked the right schema (likely benign — LLM rescues within the schema) versus the wrong schema (real runtime risk).</p>

      <h3>How the runtime works</h3>
      <p>At dispatch time, <code>llmSelect</code> calls <code>semanticSearchActionSchema</code> to rank actions, takes the top-1 result's schema name, and sends the LLM that schema's full action list (plus "switch" stubs to other schemas). The strategy choice (<code>first-match</code> / <code>score-rank</code> / <code>priority</code> / <code>user-clarify</code>) only fires when multiple <i>schemas</i> have candidates within <code>scoreDeltaThreshold</code> of top-1 — and it returns a schema name, not an action. So action-level disagreement within the same schema isn't a runtime collision; only cross-schema disagreement is.</p>

      <h3>The four buckets</h3>
      <ul>
        <li><span class="swatch" style="background:var(--b-same)"></span><b>same-schema</b> — top-1 candidate is in the right schema, just not the right action. <span class="muted">Probably benign at runtime: the LLM gets the correct schema's full action list and disambiguates. Counted as a probe-level "misroute" but unlikely to be a dispatch error.</span></li>
        <li><span class="swatch" style="background:var(--b-in)"></span><b>cross-schema, in cluster</b> — top-1 is in a different schema, but the expected schema has a candidate within <code>scoreDeltaThreshold</code> of top-1. <span class="muted">This is the slice <code>llmSelect</code> strategies act on — <code>first-match</code> picks wrong, but <code>score-rank</code> / <code>priority</code> / <code>user-clarify</code> can rescue. The <code>E2.x</code> rollout experiments target exactly this.</span></li>
        <li><span class="swatch" style="background:var(--b-out)"></span><b>cross-schema, out of cluster</b> — wrong schema at top-1, expected schema appears in top-K but its best candidate is outside the threshold. <span class="muted"><code>llmSelect</code> doesn't even flag a collision here. Lever: widen the threshold. Strategy choice is irrelevant.</span></li>
        <li><span class="swatch" style="background:var(--b-off)"></span><b>cross-schema, off-list</b> — wrong schema at top-1 and the expected schema doesn't appear in top-K at all. <span class="muted">The embedding ranker is genuinely losing the right agent. Rescue paths are limited to (a) the LLM picking a switch-stub during translation, or (b) upstream fixes (schema descriptions, grammar, embedding scorer).</span></li>
      </ul>
      <p>The first bucket is the embedding ranker being "wrong but not in a way that breaks dispatch." The middle two are <b>tunable inside <code>llmSelect</code></b>. The fourth is the irreducible structural slice. The verdict callout flips green when same-schema dominates, red when off-list dominates.</p>

      <h3>Reading the headline bar</h3>
      <p>The big horizontal bar is the four buckets stacked, sized by share. Click a segment (or any chip in the row below) to filter the per-action list and the action drill-downs to that bucket. Click again — or click <b>all</b> — to clear. The chips also act as a legend.</p>

      <h3>Reading the per-action profile</h3>
      <p>Each row is one action. The number is its total misroute count; the bar is its bucket mix scaled against the heaviest action so you can compare profiles at a glance.</p>
      <ul>
        <li><b>Mostly-green rows</b> are likely benign at runtime — embedding picked the right schema, LLM will sort it out.</li>
        <li><b>Sea-of-red rows</b> are structural — embedding loses the right agent entirely.</li>
        <li><b>Blue/amber rows</b> are <code>llmSelect</code>-tunable — strategy or threshold experiments would move the needle.</li>
        <li><b>Click a row</b> to expand the actual phrases that misrouted. Hovering shows full bucket counts.</li>
      </ul>
      <p>Use the <b>sort</b> dropdown to reorder. Toggle the <b>view</b> dropdown to roll up to <b>per-agent</b> — useful for spotting agents that are wholly structural by design (e.g. the <code>vampire</code> test agent) versus agents whose misroutes are mostly same-schema noise.</p>

      <h3>Reading the action-rank histogram</h3>
      <p>Secondary view: of all MISROUTE phrases, where in the top-K does the correct <i>action</i> rank? This is embedding-ranker calibration, not the runtime story. A high rank-1 bar (yes, it can happen — same-schema phrases where the action match is via prefix-rule normalization) plus a long tail tells you how often the embedding has the action somewhere in its candidate set even when it's not picking right.</p>
    </div>
  </details>

  <section>
    <h2>Same-schema vs cross-schema breakdown</h2>
    <div class="sub">Each MISROUTE phrase, bucketed by what runtime <code>llmSelect</code> would actually do. Click a bucket below or any chip in the row to filter the views beneath. Click again — or click <b>all</b> — to clear.</div>
    <div class="headline-bar" id="headline"></div>
    <div class="legend-chips" id="legend"></div>
    <div id="verdict" class="verdict"></div>
  </section>

  <section>
    <h2>Per-action profile</h2>
    <div class="sub">Each row is one action; the bar shows that action's bucket mix scaled against the heaviest action. Mostly-green rows are likely benign; blue/amber are <code>llmSelect</code>-tunable; sea-of-red is structural. Click a row to see the actual misrouted phrases.</div>
    <div class="controls">
      <input type="text" id="actionSearch" placeholder="filter by schema or action…" style="width:340px">
      <label>Sort by
        <select id="actionSort">
          <option value="total">total misroutes</option>
          <option value="crossRescuable">cross-schema tunable</option>
          <option value="crossOffList">structural (off-list)</option>
          <option value="benignPct">% same-schema (benign)</option>
          <option value="alpha">alphabetic</option>
        </select>
      </label>
      <label>View
        <select id="actionView">
          <option value="action">per action</option>
          <option value="agent">per agent</option>
        </select>
      </label>
      <span class="muted" id="actionCount" style="color:var(--muted);font-size:12px;"></span>
    </div>
    <div class="action-list" id="actionList"></div>
  </section>

  <section>
    <h2>Action-rank histogram (embedding calibration)</h2>
    <div class="sub">Secondary view: where in the top-K does the expected <i>action</i> appear? This is the embedding ranker's behavior independent of the schema picker. Heavy rank-1 mass with same-schema misroutes happens when the action match is via prefix normalization; off-list mass means the action isn't even an embedding neighbor.</div>
    <div id="rankHist"></div>
  </section>
</main>
<div class="tooltip" id="tt"></div>
<script id="payload" type="application/json">`;

const RECOVERY_HTML_SUFFIX = `</script>
<script>
const PAYLOAD = JSON.parse(document.getElementById("payload").textContent);

// =========================================================================
// Per-phrase-style filter — discovers all styles from PAYLOAD.phrases and
// re-aggregates the summary/perAction/perAgent/rankHist views client-side
// whenever the user toggles a chip. Aggregates are exposed via VIEW so
// renderers can stay simple.
// =========================================================================
const ALL_STYLES = (() => {
    const s = new Set();
    for (const p of (PAYLOAD.phrases || [])) if (p.style) s.add(p.style);
    const order = ["imperative","conversational","casual","polite","curt","slang","typos"];
    return [...s].sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== bi) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        }
        return a.localeCompare(b);
    });
})();
const HAS_STYLE_DATA = ALL_STYLES.length > 0;
const enabledStyles = new Set(ALL_STYLES);
let VIEW = recomputeView();

function phraseEnabled(p) {
    if (!HAS_STYLE_DATA) return true;
    if (!p.style) return true;
    return enabledStyles.has(p.style);
}
function recomputeView() {
    const filtered = PAYLOAD.phrases.filter(phraseEnabled);
    const buckets = { sameSchema: 0, crossInCluster: 0, crossOutOfCluster: 0, crossOffList: 0 };
    const perActionMap = new Map();
    const perAgentMap = new Map();
    const rankCounts = {};
    for (const p of filtered) {
        buckets[p.bucket] = (buckets[p.bucket] ?? 0) + 1;
        // per-action
        let ra = perActionMap.get(p.expected);
        if (!ra) {
            ra = {
                action: p.expected,
                sameSchema: 0, crossInCluster: 0,
                crossOutOfCluster: 0, crossOffList: 0,
                total: 0,
            };
            perActionMap.set(p.expected, ra);
        }
        ra[p.bucket] = (ra[p.bucket] ?? 0) + 1;
        ra.total++;
        // per-agent
        const agent = p.expected.split(".")[0];
        let rg = perAgentMap.get(agent);
        if (!rg) {
            rg = {
                agent,
                misrouteCount: 0,
                sameSchema: 0, crossInCluster: 0,
                crossOutOfCluster: 0, crossOffList: 0,
            };
            perAgentMap.set(agent, rg);
        }
        rg[p.bucket] = (rg[p.bucket] ?? 0) + 1;
        rg.misrouteCount++;
        // rank histogram
        const rk = p.actionRank > 0 ? String(p.actionRank) : "off-list";
        rankCounts[rk] = (rankCounts[rk] ?? 0) + 1;
    }
    // Derive composite columns + sort.
    for (const row of perActionMap.values()) {
        row.crossRescuable = row.crossInCluster + row.crossOutOfCluster;
        row.benignPct = row.total > 0 ? (row.sameSchema / row.total) * 100 : 0;
    }
    for (const row of perAgentMap.values()) {
        row.crossRescuable = row.crossInCluster + row.crossOutOfCluster;
        row.benignPct = row.misrouteCount > 0 ? (row.sameSchema / row.misrouteCount) * 100 : 0;
    }
    // Match the server's bin order: 1..topK then "off-list".
    const topK = PAYLOAD.summary.topK;
    const actionRankHistogram = [];
    for (let r = 1; r <= topK; r++) {
        actionRankHistogram.push({ rank: String(r), count: rankCounts[String(r)] ?? 0 });
    }
    actionRankHistogram.push({ rank: "off-list", count: rankCounts["off-list"] ?? 0 });
    return {
        summary: {
            totalMisroutes: filtered.length,
            topK: PAYLOAD.summary.topK,
            delta: PAYLOAD.summary.delta,
            buckets,
        },
        perAction: [...perActionMap.values()].sort((a, b) => b.total - a.total),
        perAgent: [...perAgentMap.values()].sort((a, b) => b.misrouteCount - a.misrouteCount),
        actionRankHistogram,
        phrases: filtered,
    };
}
function renderStyleChips() {
    if (!HAS_STYLE_DATA) return;
    const row = document.getElementById("styleChips");
    const list = document.getElementById("styleChipsList");
    row.style.display = "flex";
    const totals = {};
    for (const s of ALL_STYLES) totals[s] = 0;
    for (const p of PAYLOAD.phrases) {
        if (p.style) totals[p.style] = (totals[p.style] ?? 0) + 1;
    }
    list.innerHTML = ALL_STYLES.map(s => {
        const on = enabledStyles.has(s);
        return \`<span class="chip\${on ? "" : " off"}" data-style="\${escapeHtml(s)}">\${escapeHtml(s)}<span class="count">\${totals[s] || 0}</span></span>\`;
    }).join("");
    function refreshAll() {
        VIEW = recomputeView();
        renderStyleChips();
        renderAll();
    }
    list.querySelectorAll("[data-style]").forEach(el => {
        el.onclick = () => {
            const s = el.getAttribute("data-style");
            if (enabledStyles.has(s)) enabledStyles.delete(s);
            else enabledStyles.add(s);
            refreshAll();
        };
    });
    row.querySelectorAll("[data-style-all]").forEach(el => {
        el.onclick = () => { for (const s of ALL_STYLES) enabledStyles.add(s); refreshAll(); };
    });
    row.querySelectorAll("[data-style-none]").forEach(el => {
        el.onclick = () => { enabledStyles.clear(); refreshAll(); };
    });
}

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

const BUCKETS = [
    { key: "sameSchema",        label: "same-schema",         color: "var(--b-same)", desc: "embedding picked the right schema; LLM rescues within it (likely benign)" },
    { key: "crossInCluster",    label: "cross, in cluster",   color: "var(--b-in)",   desc: "wrong schema, but right schema in runtime cluster — llmSelect strategy can save" },
    { key: "crossOutOfCluster", label: "cross, out of cluster", color: "var(--b-out)", desc: "wrong schema, right schema in top-K but outside cluster — wider threshold needed" },
    { key: "crossOffList",      label: "cross, off-list",     color: "var(--b-off)",  desc: "wrong schema, right schema not in top-K — structural / switch-stub only" },
];
const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map(b => [b.key, b]));

let activeBucket = null; // null = all

// Header
function renderStats() {
    const summary = VIEW.summary;
    document.getElementById("stats").innerHTML =
        \`<b>\${summary.totalMisroutes}</b> MISROUTE phrase(s) · top-K=\${summary.topK} · llmSelect threshold=\${summary.delta}\`;
}
renderStats();

// Headline stacked bar
function renderHeadline() {
    const summary = VIEW.summary;
    const total = summary.totalMisroutes || 1;
    const bar = document.getElementById("headline");
    bar.innerHTML = "";
    for (const b of BUCKETS) {
        const n = summary.buckets[b.key];
        const seg = document.createElement("div");
        seg.className = "seg" + (activeBucket && activeBucket !== b.key ? " dim" : "");
        seg.style.width = ((n / total) * 100) + "%";
        seg.style.background = b.color;
        seg.style.flex = "0 0 auto";
        seg.title = \`\${b.label}: \${n} (\${((n/total)*100).toFixed(1)}%)\`;
        if (n / total >= 0.05) {
            seg.textContent = \`\${n} (\${((n/total)*100).toFixed(0)}%)\`;
        }
        seg.addEventListener("click", () => {
            activeBucket = (activeBucket === b.key) ? null : b.key;
            renderAll();
        });
        seg.addEventListener("mouseenter", evt => {
            showTip(\`<b>\${escapeHtml(b.label)}</b><br><span class="muted">\${escapeHtml(b.desc)}</span><br>\${n} (\${((n/total)*100).toFixed(1)}%)\`, evt);
        });
        seg.addEventListener("mousemove", moveTip);
        seg.addEventListener("mouseleave", hideTip);
        bar.appendChild(seg);
    }
}

// Legend chips (also work as filters)
function renderLegend() {
    const summary = VIEW.summary;
    const total = summary.totalMisroutes || 1;
    const wrap = document.getElementById("legend");
    wrap.innerHTML = "";
    const allChip = document.createElement("span");
    allChip.className = "chip" + (activeBucket === null ? " active" : "");
    allChip.innerHTML = \`<i style="background:#5a6273"></i>all <span class="muted">\${summary.totalMisroutes}</span>\`;
    allChip.addEventListener("click", () => { activeBucket = null; renderAll(); });
    wrap.appendChild(allChip);
    for (const b of BUCKETS) {
        const n = summary.buckets[b.key];
        const chip = document.createElement("span");
        chip.className = "chip" +
            (activeBucket === b.key ? " active" : "") +
            (activeBucket && activeBucket !== b.key ? " dim" : "");
        chip.innerHTML = \`<i style="background:\${b.color}"></i>\${escapeHtml(b.label)} <span class="muted">\${n} (\${((n/total)*100).toFixed(1)}%)</span>\`;
        chip.addEventListener("click", () => {
            activeBucket = (activeBucket === b.key) ? null : b.key;
            renderAll();
        });
        wrap.appendChild(chip);
    }
}

// Verdict callout. Three regimes:
//   benign-dominated  — sameSchema is the largest bucket. Most "misroutes"
//                       are likely-OK at runtime (LLM rescue within schema).
//   tunable-dominated — crossInCluster + crossOutOfCluster largest.
//   structural-dominated — crossOffList largest. Embedding loses the agent.
function renderVerdict() {
    const summary = VIEW.summary;
    const total = summary.totalMisroutes || 1;
    const same = summary.buckets.sameSchema;
    const inCluster = summary.buckets.crossInCluster;
    const outCluster = summary.buckets.crossOutOfCluster;
    const offList = summary.buckets.crossOffList;
    const tunable = inCluster + outCluster;
    const pct = (n) => ((n / total) * 100).toFixed(1) + "%";
    const v = document.getElementById("verdict");
    let dom = "structural";
    if (same >= tunable && same >= offList) dom = "benign";
    else if (tunable > offList) dom = "tunable";
    if (dom === "benign") {
        v.className = "verdict tunable";
        v.innerHTML = \`<b>Verdict: mostly benign.</b> \${same} of \${total} (\${pct(same)}) misroutes are <i>same-schema</i> — embedding picked the right schema, just not the right action; the LLM's translation pass over the schema's full action list should rescue these. Real runtime risk is the cross-schema slice: \${tunable + offList} (\${pct(tunable + offList)}), of which \${tunable} (\${pct(tunable)}) are <code>llmSelect</code>-tunable and \${offList} (\${pct(offList)}) are structural.\`;
    } else if (dom === "tunable") {
        v.className = "verdict tunable";
        v.innerHTML = \`<b>Verdict: tunable.</b> \${tunable} of \${total} (\${pct(tunable)}) misroutes are cross-schema with the right schema reachable in top-\${summary.topK}. The lever is <code>llmSelect</code> strategy / threshold. Same-schema benign: \${same} (\${pct(same)}). Structural off-list: \${offList} (\${pct(offList)}).\`;
    } else {
        v.className = "verdict";
        v.innerHTML = \`<b>Verdict: structural.</b> \${offList} of \${total} (\${pct(offList)}) misroutes are cross-schema with the expected schema not in top-\${summary.topK}. The embedding ranker is genuinely losing the right agent; <code>llmSelect</code> tuning can't reach these. Same-schema benign: \${same} (\${pct(same)}). Tunable cross-schema: \${tunable} (\${pct(tunable)}).\`;
    }
}

// Per-action / per-agent list
function rowDataset() {
    const view = document.getElementById("actionView").value;
    if (view === "agent") {
        return VIEW.perAgent.map(a => ({
            key: a.agent,
            label: a.agent,
            misrouteCount: a.misrouteCount,
            sameSchema: a.sameSchema,
            crossInCluster: a.crossInCluster,
            crossOutOfCluster: a.crossOutOfCluster,
            crossOffList: a.crossOffList,
            crossRescuable: a.crossRescuable,
            benignPct: a.benignPct,
        }));
    }
    return VIEW.perAction.map(a => ({
        key: a.action,
        label: a.action,
        misrouteCount: a.total,
        sameSchema: a.sameSchema,
        crossInCluster: a.crossInCluster,
        crossOutOfCluster: a.crossOutOfCluster,
        crossOffList: a.crossOffList,
        crossRescuable: a.crossRescuable,
        benignPct: a.benignPct,
    }));
}

const expanded = new Set(); // expanded rows

function phrasesForKey(key, view) {
    if (view === "agent") {
        return VIEW.phrases.filter(p => p.expected.split(".")[0] === key);
    }
    return VIEW.phrases.filter(p => p.expected === key);
}

function renderActionList() {
    const search = document.getElementById("actionSearch").value.trim().toLowerCase();
    const sort = document.getElementById("actionSort").value;
    const view = document.getElementById("actionView").value;
    let rows = rowDataset();

    // Apply bucket filter (highlight rows where activeBucket has count > 0)
    if (activeBucket) {
        rows = rows.filter(r => r[activeBucket] > 0);
    }
    if (search) {
        rows = rows.filter(r => r.label.toLowerCase().includes(search));
    }
    rows.sort((a, b) => {
        switch (sort) {
            case "crossRescuable": return b.crossRescuable - a.crossRescuable;
            case "crossOffList":   return b.crossOffList - a.crossOffList;
            case "benignPct":      return b.benignPct - a.benignPct;
            case "alpha":          return a.label.localeCompare(b.label);
            case "total":
            default:               return b.misrouteCount - a.misrouteCount;
        }
    });

    document.getElementById("actionCount").textContent = \`\${rows.length} \${view === "agent" ? "agent" : "action"}(s)\`;
    const list = document.getElementById("actionList");
    list.innerHTML = "";
    if (rows.length === 0) {
        list.innerHTML = \`<div class="empty-state">No matches.</div>\`;
        return;
    }
    const maxTotal = Math.max(...rows.map(r => r.misrouteCount), 1);

    for (const r of rows) {
        const row = document.createElement("div");
        row.className = "action-row" + (expanded.has(r.key) ? " expanded" : "");
        const stackHtml = BUCKETS.map(b => {
            const n = r[b.key];
            if (n === 0) return "";
            const w = (n / maxTotal) * 100;
            return \`<span class="seg" style="width:\${w}%;background:\${b.color};\${activeBucket && activeBucket !== b.key ? "opacity:0.25;" : ""}" title="\${b.label}: \${n}"></span>\`;
        }).join("");
        row.innerHTML = \`
            <div class="name" title="\${escapeHtml(r.label)}">\${escapeHtml(r.label)}</div>
            <div class="total">\${r.misrouteCount}</div>
            <div class="stack">\${stackHtml}</div>
        \`;
        row.addEventListener("click", () => {
            if (expanded.has(r.key)) expanded.delete(r.key);
            else expanded.add(r.key);
            renderActionList();
        });
        row.addEventListener("mouseenter", evt => {
            const total = r.misrouteCount || 1;
            const parts = BUCKETS.map(b => {
                const n = r[b.key];
                if (n === 0) return "";
                return \`<li><span style="display:inline-block;width:8px;height:8px;background:\${b.color};border-radius:1px;vertical-align:middle;margin-right:4px"></span>\${escapeHtml(b.label)}: <b>\${n}</b> (\${((n/total)*100).toFixed(0)}%)</li>\`;
            }).join("");
            showTip(\`<b>\${escapeHtml(r.label)}</b><br><span class="muted">\${r.misrouteCount} misroute(s) · \${r.benignPct.toFixed(0)}% same-schema (likely benign)</span><ul>\${parts}</ul>\`, evt);
        });
        row.addEventListener("mousemove", moveTip);
        row.addEventListener("mouseleave", hideTip);
        list.appendChild(row);

        if (expanded.has(r.key)) {
            const detail = document.createElement("div");
            detail.className = "action-detail";
            const phrases = phrasesForKey(r.key, view).filter(p =>
                !activeBucket || p.bucket === activeBucket
            );
            if (phrases.length === 0) {
                detail.innerHTML = \`<div class="empty-state">No phrases for current filter.</div>\`;
            } else {
                // Sort by bucket severity (sameSchema first, off-list last)
                // then by schema rank.
                const bucketOrder = {
                    sameSchema: 0,
                    crossInCluster: 1,
                    crossOutOfCluster: 2,
                    crossOffList: 3,
                };
                phrases.sort((a, b) => {
                    const ba = bucketOrder[a.bucket] ?? 9;
                    const bb = bucketOrder[b.bucket] ?? 9;
                    if (ba !== bb) return ba - bb;
                    const ar = a.schemaRank < 0 ? 99 : a.schemaRank;
                    const br = b.schemaRank < 0 ? 99 : b.schemaRank;
                    return ar - br;
                });
                // Progressive disclosure: first N phrases inline, the rest
                // hidden behind a "load N more" link. The document-level
                // click handler reveals the hidden block on click.
                const PHRASES_INITIAL = 20;
                const renderPhraseRow = (p) => {
                    const bucket = BUCKET_BY_KEY[p.bucket];
                    const rankLabel = p.schemaRank > 0 ? "#" + p.schemaRank : "off";
                    return \`<div class="ph">
                        <div class="rank" style="color:\${bucket.color}" title="\${escapeHtml(bucket.label)}">\${rankLabel}</div>
                        <div class="text" title="\${escapeHtml(p.phrase)}">\${escapeHtml(p.phrase)}</div>
                        <div class="actual" title="top-1: \${escapeHtml(p.actualTop1)}">→ \${escapeHtml(p.actualTop1)}</div>
                    </div>\`;
                };
                const initial = phrases.slice(0, PHRASES_INITIAL).map(renderPhraseRow).join("");
                const rest = phrases.slice(PHRASES_INITIAL);
                if (rest.length === 0) {
                    detail.innerHTML = initial;
                } else {
                    const restHtml = rest.map(renderPhraseRow).join("");
                    detail.innerHTML = initial +
                        \`<div class="more-samples-hidden">\${restHtml}</div>\` +
                        \`<a class="load-more" data-load-more>load \${rest.length} more</a>\`;
                }
            }
            list.appendChild(detail);
        }
    }
}

function renderRankHist() {
    const total = VIEW.summary.totalMisroutes || 1;
    const max = Math.max(...VIEW.actionRankHistogram.map(r => r.count), 1);
    const wrap = document.getElementById("rankHist");
    wrap.innerHTML = "";
    for (const r of VIEW.actionRankHistogram) {
        const w = (r.count / max) * 100;
        const isOff = r.rank === "off-list";
        const color = isOff
            ? "var(--b-off)"
            : (r.rank === "1" ? "var(--b-same)"
              : (r.rank === "2" ? "var(--b-in)" : "var(--b-out)"));
        const label = isOff ? "off-list" : ("rank " + r.rank);
        const html = \`<div class="rank-hist">
            <div class="label">\${escapeHtml(label)}</div>
            <div><span class="bar" style="display:block;width:\${w}%;background:\${color}"></span></div>
            <div class="count">\${r.count} (\${((r.count/total)*100).toFixed(1)}%)</div>
        </div>\`;
        wrap.insertAdjacentHTML("beforeend", html);
    }
}

document.getElementById("actionSearch").addEventListener("input", renderActionList);
document.getElementById("actionSort").addEventListener("change", renderActionList);
document.getElementById("actionView").addEventListener("change", () => {
    expanded.clear();
    renderActionList();
});

function renderAll() {
    renderStats();
    renderHeadline();
    renderLegend();
    renderVerdict();
    renderActionList();
    renderRankHist();
}

renderStyleChips();
renderAll();

// Document-level "load more" delegate. Click reveals the immediately-
// preceding hidden .more-samples-hidden block and removes the link.
document.addEventListener("click", (evt) => {
    const t = evt.target;
    if (!t || !t.matches || !t.matches("[data-load-more]")) return;
    evt.preventDefault();
    evt.stopPropagation();
    const more = t.previousElementSibling;
    if (more && more.classList.contains("more-samples-hidden")) {
        more.classList.remove("more-samples-hidden");
    }
    t.remove();
});
</script>
</body>
</html>`;

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
    /** Cross-schema action pairs above the similarity threshold whose
     *  members fall into (row, col). Counted symmetrically — pair (A,B)
     *  bumps both (rowA, colB) and (rowB, colA). 0 for same-schema cells
     *  because the similarity engine doesn't compute same-schema pairs. */
    similarityPairs: number;
    /** Subset of `similarityPairs` that also have a corpus misroute edge
     *  in either direction — the high-confidence "both" cells. */
    bothPairs: number;
    tight: number;
    clean: number;
    total: number;
    sameAgent: boolean;
    topActionEdges: VizCellEdge[];
    /** Per-phrase-style breakdown of misroute/tight/clean counts. Keys are
     *  style names (e.g. "imperative", "typos"). Sum across keys reproduces
     *  the top-level fields. Powers the per-style chip filter in the viz. */
    countsByStyle?: Record<
        string,
        { misroute: number; tight: number; clean: number }
    >;
    /** Of this cell's misrouted phrases, how many the LLM *translator* also
     *  routed away from the expected action (ranker MISROUTE + translator
     *  MISROUTE). Present only when the visualize command was given
     *  translator-probe data; undefined otherwise. Powers the
     *  "translator-confirmed" source view. */
    translatorConfirmedCount?: number | undefined;
}
interface VizSankeyEdge {
    expected: string;
    actual: string;
    /** Corpus misroute count. Always 0 for similarity-only edges (no
     *  phrases). */
    count: number;
    samples: { phrase: string; model?: string; style?: string }[];
    /** Aggregate similarity score (under the chosen strategy) when the
     *  same canonical pair is also in the similarity scan. */
    similarityScore?: number | undefined;
    sources: ("corpus" | "similarity")[];
    /** Per-style breakdown of `count`. Sums across keys reproduces `count`. */
    countsByStyle?: Record<string, number>;
    /** Of this edge's misrouted phrases, how many the LLM *translator* also
     *  routed away from the expected action (ranker MISROUTE + translator
     *  MISROUTE = the "translator-confirmed" hard-collision case). Present
     *  only when the visualize command was given translator-probe data;
     *  undefined otherwise. */
    translatorConfirmedCount?: number | undefined;
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
    similarity?:
        | {
              strategy: string;
              threshold: number;
              pairCount: number;
          }
        | undefined;
    /** Present only when the visualize command was given translator-probe
     *  data. Drives the "translator-confirmed" source view and its banner
     *  note. When absent, that source option is disabled in the viz. */
    translator?:
        | {
              /** Corpus file the translator outcomes were read from. */
              corpus: string;
              /** Phrases that joined to a ranker MISROUTE edge and where the
               *  translator also routed wrong (the CONFIRMED total). */
              confirmedPhrases: number;
              /** Distinct misroute edges with at least one CONFIRMED phrase. */
              confirmedEdges: number;
          }
        | undefined;
}

interface SimilarityEdge {
    /** Sorted alphabetically: `a < b`. */
    a: string;
    b: string;
    score: number;
}

function buildVisualizationPayload(
    probeFile: ProbeFile,
    sankeyTop: number,
    similarityEdges: SimilarityEdge[] = [],
    similarityMeta?: { strategy: string; threshold: number },
    translatorData?: { results: TranslationProbeRow[]; corpus: string },
): VizPayload {
    const results = probeFile.results;

    // -----------------------------------------------------------------
    // Translator cross-tab lookup. When translator-probe data is supplied,
    // index it by (expectedSchema, expectedAction, phraseText) → translator
    // verdict so we can mark each ranker MISROUTE phrase as "translator
    // also wrong" (CONFIRMED) or not. Mirrors translatorMerge.ts's join
    // key + normalized-action equality used by the neighborhoods viz.
    // -----------------------------------------------------------------
    function txKey(schema: string, action: string, phrase: string): string {
        return `${schema}\u0000${action}\u0000${phrase}`;
    }
    function normTxAction(name: string): string {
        return name.replace(/Action$/i, "").toLowerCase();
    }
    // value `true` = translator routed wrong (MISROUTE relative to expected);
    // `false` = translator picked the expected action. Phrases whose
    // translator outcome wasn't a clean CLEAN/MISROUTE (CLARIFY/INVALID/
    // ERROR) are omitted so they don't inflate either side.
    const txWrongByPhrase = translatorData
        ? new Map<string, boolean>()
        : undefined;
    if (translatorData && txWrongByPhrase) {
        for (const row of translatorData.results) {
            if (
                row.chosenSchema === undefined ||
                row.chosenAction === undefined
            )
                continue;
            if (row.outcome !== "CLEAN" && row.outcome !== "MISROUTE") continue;
            const wrong = !(
                row.chosenSchema === row.expectedSchema &&
                normTxAction(row.chosenAction) ===
                    normTxAction(row.expectedAction)
            );
            txWrongByPhrase.set(
                txKey(row.expectedSchema, row.expectedAction, row.phraseText),
                wrong,
            );
        }
    }
    // Accumulators (only populated when translator data is present).
    const txConfirmedByEdge = txWrongByPhrase
        ? new Map<string, number>()
        : undefined;
    let txConfirmedPhrases = 0;

    interface Cell {
        CLEAN: number;
        TIGHT: number;
        MISROUTE: number;
        total: number;
        edges: Map<string, number>;
        /** Per-style breakdown so the viz chip filter can re-aggregate. */
        byStyle: Map<
            string,
            { CLEAN: number; TIGHT: number; MISROUTE: number }
        >;
        /** Misrouted phrases in this cell the translator also got wrong. */
        translatorConfirmed: number;
    }
    const schemaMatrix = new Map<string, Map<string, Cell>>();
    function bumpMatrix(
        rowSchema: string,
        colSchema: string,
        verdict: Verdict,
        style: string | undefined,
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
                byStyle: new Map(),
                translatorConfirmed: 0,
            };
            row.set(colSchema, cell);
        }
        cell[verdict as "CLEAN" | "TIGHT" | "MISROUTE"]++;
        cell.total++;
        if (style && verdict !== "ERROR") {
            let s = cell.byStyle.get(style);
            if (!s) {
                s = { CLEAN: 0, TIGHT: 0, MISROUTE: 0 };
                cell.byStyle.set(style, s);
            }
            s[verdict as "CLEAN" | "TIGHT" | "MISROUTE"]++;
        }
        return cell;
    }

    const edgeCounts = new Map<string, number>();
    const edgeCountsByStyle = new Map<string, Map<string, number>>();
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
        const phraseStyle = r.phraseSources?.[0]?.style;
        const cell = bumpMatrix(expSchema, actSchema, r.verdict, phraseStyle);

        if (r.verdict === "MISROUTE") {
            const edgeK = `${expSchema}.${expAction}${SEP}${actSchema}.${actAction}`;
            edgeCounts.set(edgeK, (edgeCounts.get(edgeK) ?? 0) + 1);
            if (phraseStyle) {
                let byStyle = edgeCountsByStyle.get(edgeK);
                if (!byStyle) {
                    byStyle = new Map();
                    edgeCountsByStyle.set(edgeK, byStyle);
                }
                byStyle.set(phraseStyle, (byStyle.get(phraseStyle) ?? 0) + 1);
            }
            let samples = edgeSamples.get(edgeK);
            if (!samples) {
                samples = [];
                edgeSamples.set(edgeK, samples);
            }
            // No upstream cap — every phrase ships in the payload; the viz
            // uses progressive disclosure to keep the rendered DOM lean.
            samples.push({
                phrase: r.phraseText,
                model: r.phraseSources?.[0]?.model,
                style: phraseStyle,
            });
            const inCellKey = `${expAction}${SEP}${actAction}`;
            cell.edges.set(inCellKey, (cell.edges.get(inCellKey) ?? 0) + 1);

            // Translator cross-tab: did the LLM translator *also* route this
            // phrase away from the expected action? If so it's a CONFIRMED
            // hard collision — bump the per-edge + per-cell counters that
            // back the "translator-confirmed" source view.
            if (txWrongByPhrase && txConfirmedByEdge) {
                const wrong = txWrongByPhrase.get(
                    txKey(expSchema, expAction, r.phraseText),
                );
                if (wrong === true) {
                    txConfirmedByEdge.set(
                        edgeK,
                        (txConfirmedByEdge.get(edgeK) ?? 0) + 1,
                    );
                    cell.translatorConfirmed++;
                    txConfirmedPhrases++;
                }
            }
        }
    }

    // ---------------------------------------------------------------
    // Similarity overlay: per-cell counts + per-edge tagging.
    // ---------------------------------------------------------------
    function pairKey(a: string, b: string): string {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }
    function schemaOf(memberKey: string): string {
        const i = memberKey.lastIndexOf(".");
        return i < 0 ? memberKey : memberKey.slice(0, i);
    }
    // canonical-pair → score, for fast edge lookup
    const simByPair = new Map<string, number>();
    for (const sp of similarityEdges) {
        simByPair.set(pairKey(sp.a, sp.b), sp.score);
    }
    // Per-cell similarity counters. simCellCount.get("rowSchema|colSchema")
    // gives {sim, both} where `both` is similarity pairs that ALSO have
    // a corpus edge in either direction. Counted symmetrically so cells
    // (A,B) and (B,A) both reflect the pair.
    const simCellCount = new Map<string, { sim: number; both: number }>();
    function bumpSimCell(
        rowSchema: string,
        colSchema: string,
        hasCorpus: boolean,
    ) {
        const k = `${rowSchema}|${colSchema}`;
        let v = simCellCount.get(k);
        if (!v) {
            v = { sim: 0, both: 0 };
            simCellCount.set(k, v);
        }
        v.sim++;
        if (hasCorpus) v.both++;
    }
    // The corpus key uses the SEP separator; check both directions.
    function hasCorpusFor(a: string, b: string): boolean {
        return (
            edgeCounts.has(`${a}${SEP}${b}`) || edgeCounts.has(`${b}${SEP}${a}`)
        );
    }
    for (const sp of similarityEdges) {
        const aSchema = schemaOf(sp.a);
        const bSchema = schemaOf(sp.b);
        const both = hasCorpusFor(sp.a, sp.b);
        bumpSimCell(aSchema, bSchema, both);
        if (aSchema !== bSchema) bumpSimCell(bSchema, aSchema, both);
    }

    // ---------------------------------------------------------------
    // Build the row/col sets. Take the union of schemas seen in either
    // corpus misroutes or similarity pairs so the heatmap shows the full
    // candidate space. Per-source filtering happens client-side via the
    // source dropdown.
    // ---------------------------------------------------------------
    const rowMisCount = new Map<string, number>();
    const rowSimCount = new Map<string, number>();
    for (const [s, row] of schemaMatrix.entries()) {
        let mis = 0;
        for (const cell of row.values()) mis += cell.MISROUTE;
        rowMisCount.set(s, mis);
    }
    for (const [k, v] of simCellCount.entries()) {
        const rowSchema = k.split("|")[0];
        rowSimCount.set(rowSchema, (rowSimCount.get(rowSchema) ?? 0) + v.sim);
    }
    const allRowSchemas = new Set<string>([
        ...rowMisCount.keys(),
        ...rowSimCount.keys(),
    ]);
    const rowSchemas = [...allRowSchemas]
        .filter(
            (s) => (rowMisCount.get(s) ?? 0) + (rowSimCount.get(s) ?? 0) > 0,
        )
        .map((schema) => ({
            schema,
            mis: rowMisCount.get(schema) ?? 0,
            sim: rowSimCount.get(schema) ?? 0,
        }))
        .sort(
            (a, b) =>
                b.mis + b.sim - (a.mis + a.sim) ||
                a.schema.localeCompare(b.schema),
        );

    const colMisCount = new Map<string, number>();
    const colSimCount = new Map<string, number>();
    for (const row of schemaMatrix.values()) {
        for (const [colSchema, cell] of row.entries()) {
            colMisCount.set(
                colSchema,
                (colMisCount.get(colSchema) ?? 0) + cell.MISROUTE,
            );
        }
    }
    for (const [k, v] of simCellCount.entries()) {
        const colSchema = k.split("|")[1];
        colSimCount.set(colSchema, (colSimCount.get(colSchema) ?? 0) + v.sim);
    }
    const allColSchemas = new Set<string>([
        ...colMisCount.keys(),
        ...colSimCount.keys(),
    ]);
    const colSchemas = [...allColSchemas]
        .filter(
            (s) => (colMisCount.get(s) ?? 0) + (colSimCount.get(s) ?? 0) > 0,
        )
        .map((schema) => ({
            schema,
            mis: colMisCount.get(schema) ?? 0,
            sim: colSimCount.get(schema) ?? 0,
        }))
        .sort(
            (a, b) =>
                b.mis + b.sim - (a.mis + a.sim) ||
                a.schema.localeCompare(b.schema),
        );

    const matrixCells: VizCell[] = [];
    for (const r of rowSchemas) {
        const row = schemaMatrix.get(r.schema);
        for (const c of colSchemas) {
            const cell = row?.get(c.schema);
            const sim = simCellCount.get(`${r.schema}|${c.schema}`);
            const misroute = cell?.MISROUTE ?? 0;
            const similarityPairs = sim?.sim ?? 0;
            if (misroute === 0 && similarityPairs === 0) continue;
            const topActionEdges: VizCellEdge[] = cell
                ? [...cell.edges.entries()]
                      .map(([k, v]) => {
                          const [exp, act] = k.split(SEP);
                          return { exp, act, count: v };
                      })
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 5)
                : [];
            const countsByStyle =
                cell && cell.byStyle.size > 0
                    ? Object.fromEntries(
                          [...cell.byStyle.entries()].map(([style, v]) => [
                              style,
                              {
                                  misroute: v.MISROUTE,
                                  tight: v.TIGHT,
                                  clean: v.CLEAN,
                              },
                          ]),
                      )
                    : undefined;
            matrixCells.push({
                row: r.schema,
                col: c.schema,
                misroute,
                similarityPairs,
                bothPairs: sim?.both ?? 0,
                tight: cell?.TIGHT ?? 0,
                clean: cell?.CLEAN ?? 0,
                total: cell?.total ?? 0,
                sameAgent: r.schema === c.schema,
                topActionEdges,
                ...(countsByStyle && { countsByStyle }),
                ...(txWrongByPhrase && {
                    translatorConfirmedCount: cell?.translatorConfirmed ?? 0,
                }),
            });
        }
    }

    // ---------------------------------------------------------------
    // Unified edges: corpus edges enriched with similarity score, plus
    // similarity-only entries for pairs without any corpus signal.
    // ---------------------------------------------------------------
    const corpusEdges: VizSankeyEdge[] = [...edgeCounts.entries()]
        .map(([k, v]) => {
            const [exp, act] = k.split(SEP);
            const score = simByPair.get(pairKey(exp, act));
            const styleMap = edgeCountsByStyle.get(k);
            const countsByStyle =
                styleMap && styleMap.size > 0
                    ? Object.fromEntries(styleMap.entries())
                    : undefined;
            return {
                expected: exp,
                actual: act,
                count: v,
                samples: edgeSamples.get(k) ?? [],
                similarityScore: score,
                sources: (score !== undefined
                    ? ["corpus", "similarity"]
                    : ["corpus"]) as ("corpus" | "similarity")[],
                ...(countsByStyle && { countsByStyle }),
                ...(txConfirmedByEdge && {
                    translatorConfirmedCount: txConfirmedByEdge.get(k) ?? 0,
                }),
            };
        })
        .sort((a, b) => b.count - a.count);

    // Similarity-only entries: pairs not seen as a corpus edge in either
    // direction. Listed once per canonical pair (a < b sorted).
    const corpusPairKeys = new Set<string>();
    for (const e of corpusEdges) {
        corpusPairKeys.add(pairKey(e.expected, e.actual));
    }
    const similarityOnlyEdges: VizSankeyEdge[] = [];
    for (const sp of similarityEdges) {
        const k = pairKey(sp.a, sp.b);
        if (corpusPairKeys.has(k)) continue;
        similarityOnlyEdges.push({
            expected: sp.a,
            actual: sp.b,
            count: 0,
            samples: [],
            similarityScore: sp.score,
            sources: ["similarity"],
        });
    }
    // Sort similarity-only entries by score desc.
    similarityOnlyEdges.sort(
        (a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0),
    );

    const allEdges: VizSankeyEdge[] = [...corpusEdges, ...similarityOnlyEdges];

    // Sankey is corpus-driven (it requires direction). Take the heaviest
    // corpus edges; client can further filter by source for the "both"
    // view (corpus edges with similarity confirmation).
    const sankeyEdges = corpusEdges.slice(0, sankeyTop);

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
        edges: allEdges,
        perAction: probeFile.summary.perAction.slice(0, 100),
        similarity: similarityMeta
            ? {
                  strategy: similarityMeta.strategy,
                  threshold: similarityMeta.threshold,
                  pairCount: similarityEdges.length,
              }
            : undefined,
        translator:
            txConfirmedByEdge && translatorData
                ? {
                      corpus: translatorData.corpus,
                      confirmedPhrases: txConfirmedPhrases,
                      confirmedEdges: [...txConfirmedByEdge.values()].filter(
                          (n) => n > 0,
                      ).length,
                  }
                : undefined,
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
  /* Per-phrase-style chips — global filter, lives in the page header.
     Click-to-toggle which styles count toward EVERY chart on the page
     (heatmap, sankey, edge table). Default state: every detected style
     enabled. Row hides when the corpus carries no per-style breakdown. */
  header .style-chips {
    margin-top: 8px;
    padding: 6px 10px;
    background: rgba(122, 162, 247, 0.05);
    border-left: 3px solid var(--accent);
    border-radius: 0 4px 4px 0;
  }
  .style-chips { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .style-chips .label { color: var(--muted); font-size: 12px; margin-right: 4px; }
  .style-chips .chip {
    font-size: 11px; padding: 2px 9px; border-radius: 11px;
    border: 1px solid var(--line); background: #0a0d12;
    color: var(--ink); cursor: pointer; user-select: none;
    transition: background 0.08s, border-color 0.08s, opacity 0.08s;
    font-family: ui-monospace, monospace;
  }
  .style-chips .chip:hover { border-color: var(--accent); }
  .style-chips .chip.off { opacity: 0.35; background: transparent; }
  .style-chips .chip .count { color: var(--muted); margin-left: 4px; font-size: 10px; }
  .style-chips .quick { font-size: 11px; color: var(--muted); cursor: pointer; text-decoration: underline; margin-left: 8px; }
  .style-chips .quick:hover { color: var(--accent); }
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
  .load-more {
    color: var(--accent); cursor: pointer; text-decoration: underline;
    font-size: 11px; display: inline-block; margin: 4px 0 0 18px;
  }
  .load-more:hover { color: var(--ink); }
  .more-samples-hidden { display: none; }
  .legend-bar { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; margin-top: 8px; }
  .legend-bar .swatch { width: 220px; height: 8px; border-radius: 4px; background: linear-gradient(to right, #1a1f29, #b14f60, #ff5470); }
  /* Collapsible "how to read" panel */
  details.help {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 12px 18px;
  }
  details.help > summary {
    cursor: pointer; user-select: none;
    font-weight: 600; font-size: 14px;
    list-style: none; outline: none;
    display: flex; align-items: center; gap: 8px;
  }
  details.help > summary::-webkit-details-marker { display: none; }
  details.help > summary::before {
    content: "\\25B8"; color: var(--muted);
    font-size: 11px; transition: transform 0.1s;
    display: inline-block; width: 10px;
  }
  details.help[open] > summary::before { transform: rotate(90deg); }
  details.help[open] > summary {
    margin-bottom: 12px; padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  details.help .help-body { font-size: 13px; color: var(--ink); }
  details.help .help-body h3 {
    margin: 14px 0 6px; font-size: 13px; font-weight: 600;
    color: var(--ink);
  }
  details.help .help-body h3:first-child { margin-top: 0; }
  details.help .help-body p { margin: 4px 0 8px; }
  details.help .help-body ul { margin: 4px 0 8px; padding-left: 20px; }
  details.help .help-body li { margin: 3px 0; }
  details.help .help-body code {
    background: #11141b; padding: 1px 5px; border-radius: 2px;
    font-size: 12px; font-family: ui-monospace, monospace;
  }
  details.help .help-body .muted { color: var(--muted); }
  details.help .help-body .swatch {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 2px; vertical-align: middle;
    margin-right: 4px;
  }
</style>
</head>
<body>
<header>
  <h1>TypeAgent collision hotspots</h1>
  <div class="stats" id="stats"></div>
  <div id="sourceBanner" style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <label style="font-size:12px;color:var(--muted);">Source
      <select id="sourceFilter" style="background:#0a0d12;border:1px solid var(--line);color:var(--ink);border-radius:5px;padding:3px 6px;font:inherit;">
        <option value="all">all (corpus + similarity)</option>
        <option value="corpus" selected>corpus (misroute phrases)</option>
        <option value="similarity">similarity (embedding pairs)</option>
        <option value="both">both (corpus AND similarity)</option>
        <option value="tx-confirmed">translator-confirmed</option>
      </select>
    </label>
    <span id="simMeta" class="muted" style="color:var(--muted);font-size:12px;"></span>
    <span id="txMeta" class="muted" style="color:var(--muted);font-size:12px;"></span>
  </div>
  <div class="style-chips" id="styleChips" style="display:none;">
    <span class="label">Phrase styles (applies to every chart on this page):</span>
    <span id="styleChipsList"></span>
    <span class="quick" data-style-all>all</span>
    <span class="quick" data-style-none>none</span>
  </div>
</header>
<main>
  <details class="help" open>
    <summary>How to read these charts</summary>
    <div class="help-body">
      <h3>What's being measured</h3>
      <p>Each input row is one phrase generated by an LLM for a specific intended action, replayed through the embedding ranker (the <code>semanticSearchActionSchema</code> call <code>llmSelect</code> uses at runtime). A <b>MISROUTE</b> means the ranker's top-1 candidate wasn't the intended action. The three views below slice the same MISROUTE pile three ways.</p>

      <h3>The source filter</h3>
      <p>The <b>Source</b> dropdown in the header re-scopes every chart on the page:</p>
      <ul>
        <li><b>corpus</b> &mdash; misroute phrases from the probe corpus (the default).</li>
        <li><b>similarity</b> &mdash; cross-schema action pairs the embedding scan flagged above threshold.</li>
        <li><b>both</b> &mdash; pairs supported by corpus misroutes <i>and</i> a similarity hit.</li>
        <li><b>translator-confirmed</b> &mdash; corpus misroutes where the LLM <i>translator</i> also routed the phrase away from the expected action (ranker AND translator both wrong). These are the genuine hard collisions worth explicit policy. Available only when the visualize command was given translator-probe data (<code>@collision corpus translate</code> writes <code>translation-results.json</code>, then <code>visualize</code> folds it in); otherwise the option is disabled. Edges carrying such phrases show a red <b>🛑N</b> badge in the table.</li>
      </ul>

      <h3>The header pills</h3>
      <p>Top-line counts of CLEAN / TIGHT / MISROUTE phrases:</p>
      <ul>
        <li><b>CLEAN</b> &mdash; top-1 matches expected with delta to #2 above the threshold (no runtime collision).</li>
        <li><b>TIGHT</b> &mdash; top-1 matches expected but delta to #2 is below the threshold (<code>llmSelect</code> would flag this as a collision at runtime; resolution depends on strategy).</li>
        <li><b>MISROUTE</b> &mdash; top-1 does <i>not</i> match expected. Everything below this line drills into the MISROUTE slice.</li>
      </ul>

      <h3>1. Cross-agent hotspot heatmap</h3>
      <p>Rows are <b>expected</b> schemas (intended target of phrases), columns are <b>actual top-1</b> schemas (where the embedding routed them). Cell color = MISROUTE count for that (expected schema &rarr; actual schema) pair on a sequential scale (dark = few, bright pink = max).</p>
      <ul>
        <li><b>Diagonal cells</b> are within-agent: the embedding picked the right schema, just not the right action. Toggle "Hide within-agent" to remove them; they're usually benign at runtime because the LLM disambiguates within the schema.</li>
        <li><b>Cells outlined in blue</b> are within-agent (same schema row=col).</li>
        <li><b>Bright off-diagonal cells</b> are the real cross-agent risk &mdash; the embedding routes phrases for one agent to a different agent.</li>
        <li><b>Hover</b> a cell to see the top action pairs that produced its count.</li>
        <li><b>Click</b> a cell to filter the misroute-edge table at the bottom of the page to that schema-pair.</li>
        <li><b>Min misroutes</b> trims out small cells; raise it to focus on heavy hitters.</li>
      </ul>

      <h3>2. Top action-level misroute flows (sankey)</h3>
      <p>The top-N misrouted action edges by count, drawn as a flow from <b>expected</b> action (left) to <b>actual top-1</b> action (right). Width = phrase count. Colors are by <b>source agent</b> (the agent whose action was the intended target).</p>
      <ul>
        <li><b>Hover</b> an edge for sample phrases that produced it.</li>
        <li><b>Legend chips</b> above the sankey filter to one source agent (click again to clear). Useful for isolating "all of agent X's misroutes".</li>
      </ul>

      <h3>3. All misroute edges (table)</h3>
      <p>Every (expected &rarr; actual) action pair where at least one phrase misrouted, sorted by count. Searchable across schema names, action names, and phrase text.</p>
      <ul>
        <li><b>Click a row</b> to expand and see up to 5 sample phrases that produced this misroute, with the LLM model and style that generated each in brackets (e.g. <code>[GPT_4_1 imperative]</code>).</li>
        <li><b>Filter</b> with free-text terms; multiple terms are AND-ed.</li>
      </ul>

      <h3>What this page does <em>not</em> show</h3>
      <p>This is the embedding-ranker view of misroutes &mdash; the <i>schema picker</i>'s view of the world. It doesn't show what the LLM <i>translator</i> actually picks for each phrase at runtime (which often disambiguates within a schema). For the runtime-aware decomposition, see <code>recovery-viz.html</code> (built by <code>@collision corpus visualize-recovery</code> on the same source data).</p>
    </div>
  </details>

  <section>
    <h2>Cross-agent hotspot heatmap</h2>
    <div class="sub">Each cell is the MISROUTE count for phrases generated for the row schema that the embedding ranker top-1'd to the column schema. Cells outlined in blue are within-agent (row = column). Hover for the top action pairs.</div>
    <div class="controls">
      <label><input type="checkbox" id="hideSelf"> Hide within-agent (diagonal)</label>
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
          <th data-key="similarityScore">sim</th>
          <th>src</th>
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

// =========================================================================
// Per-phrase-style filter (chip UI in header). Defines ALL_STYLES,
// HAS_STYLE_DATA, enabledStyles, and helpers that the renderers consult
// to re-aggregate cell/edge counts under the current chip selection.
// =========================================================================
const ALL_STYLES = (() => {
    const s = new Set();
    for (const cell of (PAYLOAD.matrix?.cells || [])) {
        for (const k of Object.keys(cell.countsByStyle || {})) s.add(k);
    }
    for (const e of (PAYLOAD.edges || [])) {
        for (const k of Object.keys(e.countsByStyle || {})) s.add(k);
    }
    const order = ["imperative","conversational","casual","polite","curt","slang","typos"];
    return [...s].sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== bi) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        }
        return a.localeCompare(b);
    });
})();
const HAS_STYLE_DATA = ALL_STYLES.length > 0;
const enabledStyles = new Set(ALL_STYLES);

function sumCellStyle(cbs, field) {
    if (!cbs) return 0;
    let total = 0;
    for (const k of enabledStyles) {
        const v = cbs[k];
        if (v && typeof v[field] === "number") total += v[field];
    }
    return total;
}
function cellMisroute(cell) {
    if (cell.countsByStyle && HAS_STYLE_DATA) return sumCellStyle(cell.countsByStyle, "misroute");
    return cell.misroute || 0;
}
function cellTight(cell) {
    if (cell.countsByStyle && HAS_STYLE_DATA) return sumCellStyle(cell.countsByStyle, "tight");
    return cell.tight || 0;
}
function cellClean(cell) {
    if (cell.countsByStyle && HAS_STYLE_DATA) return sumCellStyle(cell.countsByStyle, "clean");
    return cell.clean || 0;
}
function edgeCount(e) {
    if (e.countsByStyle && HAS_STYLE_DATA) {
        let total = 0;
        for (const k of enabledStyles) {
            if (typeof e.countsByStyle[k] === "number") total += e.countsByStyle[k];
        }
        return total;
    }
    return e.count || 0;
}
function sampleEnabled(s) {
    if (!HAS_STYLE_DATA) return true;
    if (!s.style) return true;
    return enabledStyles.has(s.style);
}
function renderStyleChips() {
    if (!HAS_STYLE_DATA) return;
    const row = document.getElementById("styleChips");
    const list = document.getElementById("styleChipsList");
    row.style.display = "flex";
    const totals = {};
    for (const s of ALL_STYLES) totals[s] = 0;
    for (const e of PAYLOAD.edges || []) {
        for (const [s, v] of Object.entries(e.countsByStyle || {})) {
            totals[s] = (totals[s] ?? 0) + (v || 0);
        }
    }
    list.innerHTML = ALL_STYLES.map(s => {
        const on = enabledStyles.has(s);
        return \`<span class="chip\${on ? "" : " off"}" data-style="\${escapeHtml(s)}">\${escapeHtml(s)}<span class="count">\${totals[s] || 0}</span></span>\`;
    }).join("");
    function refreshAll() {
        renderStyleChips();
        renderHeatmap();
        renderSankey();
        renderTable();
    }
    list.querySelectorAll("[data-style]").forEach(el => {
        el.onclick = () => {
            const s = el.getAttribute("data-style");
            if (enabledStyles.has(s)) enabledStyles.delete(s);
            else enabledStyles.add(s);
            refreshAll();
        };
    });
    row.querySelectorAll("[data-style-all]").forEach(el => {
        el.onclick = () => { for (const s of ALL_STYLES) enabledStyles.add(s); refreshAll(); };
    });
    row.querySelectorAll("[data-style-none]").forEach(el => {
        el.onclick = () => { enabledStyles.clear(); refreshAll(); };
    });
}

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

if (PAYLOAD.similarity) {
    const s = PAYLOAD.similarity;
    document.getElementById("simMeta").innerHTML =
        \`similarity: \${s.pairCount} pair(s) · strategy <code>\${escapeHtml(s.strategy)}</code> @ <code>\${s.threshold}</code>\`;
} else {
    // Disable similarity-related options when the overlay isn't present.
    const sel = document.getElementById("sourceFilter");
    for (const opt of sel.options) {
        if (opt.value === "similarity" || opt.value === "both" || opt.value === "all") {
            opt.disabled = true;
        }
    }
    document.getElementById("simMeta").textContent = "similarity overlay: not available (run with similarity enabled)";
}

// Translator overlay meta + option gating. The "translator-confirmed"
// source is meaningful only when a translator-probe corpus was folded in
// (each ranker MISROUTE phrase cross-tabbed against the LLM translator's
// pick). When absent, disable the option and explain how to enable it.
if (PAYLOAD.translator) {
    const t = PAYLOAD.translator;
    document.getElementById("txMeta").innerHTML =
        \`translator: <b>\${t.confirmedPhrases}</b> confirmed phrase(s) across \${t.confirmedEdges} edge(s)\`;
} else {
    const sel = document.getElementById("sourceFilter");
    for (const opt of sel.options) {
        if (opt.value === "tx-confirmed") opt.disabled = true;
    }
    document.getElementById("txMeta").textContent =
        "translator overlay: not available (run @collision corpus translate, then visualize)";
}

// Source filter — drives what the heatmap colors by, what the sankey
// shows, and what the table lists. Defaults to "corpus" (preserves the
// pre-similarity-overlay behavior).
let currentSource = "corpus";
document.getElementById("sourceFilter").value = currentSource;
document.getElementById("sourceFilter").addEventListener("change", (evt) => {
    currentSource = evt.target.value;
    renderHeatmap();
    renderSankey();
    renderTable();
});

// Returns the count for a heatmap cell under the active source. The
// similarity engine is cross-schema only, so same-schema cells always
// have similarityPairs = 0; in similarity / both views the diagonal
// naturally drops out.
function cellMetric(c) {
    // Misroute count is style-filterable; similarity/both pair counts come
    // from the embedding scan and have no per-style breakdown, so they
    // pass through unchanged. translator-confirmed counts likewise have no
    // per-style breakdown — they reflect the LLM translator's verdict.
    const mis = cellMisroute(c);
    switch (currentSource) {
        case "similarity": return c.similarityPairs;
        case "both":       return c.bothPairs;
        case "all":        return mis + c.similarityPairs - c.bothPairs;
        case "tx-confirmed": return c.translatorConfirmedCount || 0;
        case "corpus":
        default:           return mis;
    }
}

// Heatmap
function renderHeatmap() {
    const hideSelf = document.getElementById("hideSelf").checked;
    const minMis = Number(document.getElementById("minMis").value) || 0;
    const cells = PAYLOAD.matrix.cells.filter(c =>
        (!hideSelf || !c.sameAgent) && cellMetric(c) >= minMis,
    );
    const rows = [...new Set(cells.map(c => c.row))].sort((a,b)=>{
        const ma = d3.sum(cells.filter(x=>x.row===a),x=>cellMetric(x));
        const mb = d3.sum(cells.filter(x=>x.row===b),x=>cellMetric(x));
        return mb - ma || a.localeCompare(b);
    });
    const cols = [...new Set(cells.map(c => c.col))].sort((a,b)=>{
        const ma = d3.sum(cells.filter(x=>x.col===a),x=>cellMetric(x));
        const mb = d3.sum(cells.filter(x=>x.col===b),x=>cellMetric(x));
        return mb - ma || a.localeCompare(b);
    });
    const cellSize = 18, labelW = 240, labelH = 180;
    const W = labelW + cols.length * cellSize + 40;
    const H = labelH + rows.length * cellSize + 40;
    const maxVal = d3.max(cells, c => cellMetric(c)) ?? 1;
    document.getElementById("maxMis").textContent = maxVal;
    const color = d3.scaleSequential(d3.interpolateRgb("#1a1f29", "#ff5470")).domain([0, maxVal]);
    const wrap = d3.select("#heatmap").html("");
    if (cells.length === 0) {
        wrap.append("div").style("color", "var(--muted)").style("padding", "12px 0").style("font-style", "italic")
            .text("No cells match the current source / filter.");
        return;
    }
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
        .attr("fill", c => color(cellMetric(c)))
        .on("mouseenter",(evt,c)=>{
            const top = c.topActionEdges.map(e =>
                \`<li><b>\${c.row}.\${e.exp}</b> → <b>\${c.col}.\${e.act}</b> · <span class="muted">\${e.count}</span></li>\`).join("");
            const counts = \`misroutes: \${cellMisroute(c)} · similarity: \${c.similarityPairs} · both: \${c.bothPairs}\`;
            showTip(\`<b>\${c.row}</b> → <b>\${c.col}</b><br><span class="muted">\${counts}</span>\` + (top?\`<ul>\${top}</ul>\`:""), evt);
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
    // Sankey requires direction. Similarity-only edges aren't directional,
    // so filter to corpus-tagged edges. For "both" mode, restrict further
    // to corpus edges that ALSO have similarity confirmation.
    let baseEdges;
    if (currentSource === "similarity") {
        // No directional edges in similarity-only mode.
        d3.select("#sankey").html("").append("div").attr("class","empty")
            .text("Sankey shows directional flows; similarity-only pairs aren't directional. Switch source to corpus, both, or all.");
        document.getElementById("topN").textContent = "0";
        return;
    } else if (currentSource === "both") {
        baseEdges = all.filter(e => e.sources.includes("corpus") && e.sources.includes("similarity"));
    } else if (currentSource === "tx-confirmed") {
        // Corpus edges the translator also got wrong on ≥1 phrase.
        baseEdges = all.filter(e => e.sources.includes("corpus") && (e.translatorConfirmedCount || 0) > 0);
    } else {
        // "corpus" or "all" — show all corpus-tagged sankey edges.
        baseEdges = all.filter(e => e.sources.includes("corpus"));
    }
    // Drop sankey edges whose count is zero under the current style filter.
    if (HAS_STYLE_DATA) baseEdges = baseEdges.filter(e => edgeCount(e) > 0);
    const edges = selectedAgent ? baseEdges.filter(e => agentOf(e.expected) === selectedAgent) : baseEdges;
    document.getElementById("topN").textContent = selectedAgent ? \`\${edges.length} of \${baseEdges.length}\` : edges.length;
    const color = SANKEY_COLOR, agents = SANKEY_AGENTS, agentTotals = SANKEY_AGENT_TOTALS;
    const W = 1000, H = Math.max(420, edges.length * 14);
    const wrap = d3.select("#sankey").html("");
    const legend = wrap.append("div").attr("class","sankey-legend");
    legend.append("span").attr("class","swatch all" + (selectedAgent === null ? " active" : ""))
        .html(\`<i style="background:#5a6273"></i>all <span class="muted">\${baseEdges.length} edge(s)</span>\`)
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
        return {
            source: s, target: t,
            value: edgeCount(e),
            samples: (e.samples || []).filter(sampleEnabled),
            agent: agentOf(e.expected),
        };
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
function edgeMatchesSource(e) {
    const hasCor = e.sources.includes("corpus");
    const hasSim = e.sources.includes("similarity");
    switch (currentSource) {
        case "corpus":     return hasCor && !hasSim;
        case "similarity": return hasSim && !hasCor;
        case "both":       return hasCor && hasSim;
        case "tx-confirmed": return hasCor && (e.translatorConfirmedCount || 0) > 0;
        case "all":
        default:           return true;
    }
}
function renderTable() {
    const q = document.getElementById("filter").value.trim().toLowerCase();
    const tokens = q.split(/\\s+/).filter(Boolean);
    const filtered = PAYLOAD.edges.filter(e => {
        if (!edgeMatchesSource(e)) return false;
        // Drop edges whose style count is zero under the current chip filter
        // (only applies to edges with a per-style breakdown — i.e. corpus
        // edges; similarity-only edges have count 0 and pass through).
        if (HAS_STYLE_DATA && e.countsByStyle && edgeCount(e) === 0) return false;
        if (tokens.length === 0) return true;
        const blob = [e.expected, e.actual, ...(e.samples || []).map(s => s.phrase)].join(" ").toLowerCase();
        return tokens.every(t => blob.includes(t));
    });
    filtered.sort((a, b) => {
        // Sort by filtered count when the user is sorting by count.
        const get = (e, k) => k === "count" ? edgeCount(e) : e[k];
        let av = get(a, sortKey), bv = get(b, sortKey);
        if (typeof av === "string") return sortDir * av.localeCompare(bv);
        if (av === undefined) av = -Infinity;
        if (bv === undefined) bv = -Infinity;
        return sortDir * (av - bv);
    });
    document.getElementById("filterCount").textContent =
        \`\${filtered.length} edges · \${d3.sum(filtered, e => edgeCount(e))} phrases\`;
    const tbody = document.querySelector("#edges tbody");
    tbody.innerHTML = "";
    for (const e of filtered.slice(0, 500)) {
        const tr = document.createElement("tr");
        tr.className = "expandable";
        const hasCor = e.sources.includes("corpus");
        const hasSim = e.sources.includes("similarity");
        const sourceBadge = (hasCor && hasSim)
            ? \`<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;color:#0f1217;background:#f472b6;font-weight:600;">both</span>\`
            : (hasSim
                ? \`<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;color:#0f1217;background:#c084fc;font-weight:600;">sim</span>\`
                : \`<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;color:#0f1217;background:#fb923c;font-weight:600;">corpus</span>\`);
        // Translator-confirmed badge: how many of this edge's misroutes the
        // LLM translator also got wrong. Only shown when translator data was
        // folded in and this edge has ≥1 such phrase.
        const txConfirmed = e.translatorConfirmedCount || 0;
        const txBadge = (PAYLOAD.translator && txConfirmed > 0)
            ? \` <span title="ranker AND translator both wrong on \${txConfirmed} phrase(s)" style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;color:#0f1217;background:#ef4444;font-weight:600;">🛑\${txConfirmed}</span>\`
            : "";
        const liveCount = edgeCount(e);
        const countCell = liveCount > 0 ? liveCount : "·";
        const scoreCell = e.similarityScore !== undefined
            ? \`<span style="color:var(--accent);font-family:monospace;">\${e.similarityScore.toFixed(2)}</span>\`
            : \`<span class="muted">·</span>\`;
        tr.innerHTML =
            \`<td class="count">\${countCell}</td>\` +
            \`<td>\${scoreCell}</td>\` +
            \`<td>\${sourceBadge}\${txBadge}</td>\` +
            \`<td class="action">\${escapeHtml(e.expected)}</td>\` +
            \`<td class="muted">→</td>\` +
            \`<td class="action">\${escapeHtml(e.actual)}</td>\`;
        tbody.appendChild(tr);
        const sampleTr = document.createElement("tr");
        sampleTr.className = "samples";
        sampleTr.style.display = "none";
        // Progressive disclosure: first 5 samples inline, "load N more" link
        // for the rest. Hidden block is the immediate previous sibling so the
        // document-level click handler can reveal it.
        const SAMPLES_INITIAL = 5;
        const visibleSamples = (e.samples || []).filter(sampleEnabled);
        const renderLi = (s) =>
            \`<li><span class="style">[\${s.model ?? ""} · \${s.style ?? ""}]</span> \${escapeHtml(s.phrase)}</li>\`;
        let samplesHtml;
        if (visibleSamples.length === 0) {
            samplesHtml = "";
        } else {
            const initialLis = visibleSamples.slice(0, SAMPLES_INITIAL).map(renderLi).join("");
            const restLis = visibleSamples.slice(SAMPLES_INITIAL).map(renderLi).join("");
            const restBlock = visibleSamples.length > SAMPLES_INITIAL
                ? \`<ul class="more-samples-hidden" style="margin-top:0;">\${restLis}</ul>\` +
                  \`<a class="load-more" data-load-more>load \${visibleSamples.length - SAMPLES_INITIAL} more</a>\`
                : "";
            samplesHtml = \`<ul>\${initialLis}</ul>\${restBlock}\`;
        }
        const detailHtml = samplesHtml
            ? samplesHtml
            : \`<div style="color:var(--muted);font-style:italic;">No corpus phrases for this edge (similarity-only).</div>\`;
        sampleTr.innerHTML = \`<td colspan="6">\${detailHtml}</td>\`;
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
renderStyleChips();
renderHeatmap(); renderSankey(); renderTable();

// Document-level "load more" delegate for progressive-disclosure sample
// blocks. Click reveals the immediately-preceding hidden sibling and
// removes the link.
document.addEventListener("click", (evt) => {
    const t = evt.target;
    if (!t || !t.matches || !t.matches("[data-load-more]")) return;
    evt.preventDefault();
    evt.stopPropagation();
    const more = t.previousElementSibling;
    if (more && more.classList.contains("more-samples-hidden")) {
        more.classList.remove("more-samples-hidden");
    }
    t.remove();
});
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

function renderProbeSummaryText(probeFile: ProbeFile, label: string): string[] {
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
            styles: {
                description: `Comma-separated phrase styles to generate. Available: ${PHRASE_STYLE_KEYS.join(",")}. Default: ${DEFAULT_PHRASE_STYLES.join(",")}.`,
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
                    "Output corpus JSON file path (file name, not directory — use --workdir to choose the directory). Default: <instanceDir>/collisions/corpus.json",
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
        const stylesResolved = resolveStyles(params.flags.styles);
        if (stylesResolved.errors.length > 0) {
            for (const e of stylesResolved.errors) displayWarn(e, context);
            return;
        }
        const styles = stylesResolved.styles;
        const concurrency = Math.max(
            1,
            params.flags.concurrency ?? DEFAULT_CONCURRENCY,
        );
        const workdir = params.flags.workdir
            ? resolveWorkdir(systemContext, params.flags.workdir)
            : undefined;
        const outPath = resolveOutFilePath(
            systemContext,
            params.flags.out,
            "out",
            workdir,
            DEFAULT_FILES.corpus,
            context,
        );
        if (outPath === null) return;
        const partialWriter = createThrottledFileWriter(outPath, 3000);

        await withReadOnlySession(context, async () => {
            displayStatus(
                `Corpus generation\nLoading action schemas…`,
                context,
            );
            const t0 = Date.now();
            const { corpus, errorCount, failedSchemas, perCallErrors } =
                await generateCorpus(
                    systemContext,
                    { schemas, models, concurrency, styles },
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
                                          (((Date.now() - t0) / done) *
                                              (total - done)) /
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
                    (getCorpus) => partialWriter.snapshot(getCorpus),
                );

            partialWriter.finalize(corpus);
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
            concurrency: {
                description: `Concurrent probes (default ${DEFAULT_CONCURRENCY})`,
                type: "number",
                default: DEFAULT_CONCURRENCY,
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
        const concurrency = Math.max(
            1,
            params.flags.concurrency ?? DEFAULT_CONCURRENCY,
        );

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
                `Probe replay\n[0/${totalPhrases}] starting (concurrency ${concurrency})…`,
                context,
            );
            const probeFile = await probeCorpus(
                systemContext,
                corpus,
                inPath,
                { top, delta, concurrency },
                (done, total) => {
                    if (done % 25 === 0 || done === total) {
                        displayStatus(
                            `Probe replay\n[${done}/${total}] (concurrency ${concurrency})`,
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
// Handler: @collision corpus translate
// =============================================================================
// Replays corpus phrases through the *LLM translator* (full translateRequest
// path), capturing the typed action the translator picks per phrase. Distinct
// from `corpus probe`, which only runs the embedding ranker. Forces
// `first-match` to suppress user-clarify short-circuits and observes the
// translator's pure verdict; emits `translation-results.json` (a
// TranslationProbeFile) under the same `{summary, results}` envelope shape.
// Sources: see translation/translationProbeRunner.ts.

class CollisionCorpusTranslateCommandHandler implements CommandHandler {
    public readonly description =
        "Replay a phrase corpus through the LLM translator (cache/grammar/exec/fuzzy off) and classify each phrase as CLEAN / MISROUTE / CLARIFY / INVALID / ERROR. Distinct from 'corpus probe' — that one runs the embedding ranker; this runs the actual translator.";
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
                    "Output translation-results JSON file path (file name, not directory — use --workdir to choose the directory). Default: <workdir>/translation-results.json (or translation-results-<suffix>.json when --output-suffix is set).",
                type: "string",
                optional: true,
            },
            concurrency: {
                description:
                    "Concurrent translator calls (default 4 — chat completions are expensive)",
                type: "number",
                default: 4,
            },
            strategy: {
                description:
                    "llmSelect strategy to force during the run. Default 'first-match' (suppresses user-clarify short-circuit). Reserved: future runs will sweep multiple strategies in one go.",
                type: "string",
                default: "first-match",
            },
            "max-phrases": {
                description:
                    "Cap the run to N phrases (deterministic prefix). Useful for smoke tests.",
                type: "number",
                optional: true,
            },
            "model-label": {
                description:
                    "Label recorded in each row's `model` field. Reserved for future multi-model sweeps; defaults to 'default'.",
                type: "string",
                optional: true,
            },
            "user-context-mode": {
                description:
                    "How userContext is attached per phrase: 'none' (baseline, no injection), 'expected-schema' (derive from each phrase's expected schema via manifest), 'fixed' (use --user-context-json for every phrase).",
                type: "string",
                default: "none",
            },
            "user-context-json": {
                description:
                    'JSON object parsed as UserContext when --user-context-mode=fixed. E.g. \'{"activeApp":"spotify","activeAppDescription":"Spotify music agent"}\'.',
                type: "string",
                optional: true,
            },
            "output-suffix": {
                description:
                    "When set and --out is not given, write to <workdir>/translation-results-<suffix>.json so baseline and context runs coexist in one workdir.",
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
        const inPath = defaultPath(
            systemContext,
            params.flags.in,
            workdir,
            DEFAULT_FILES.corpus,
        );
        const outputSuffix = params.flags["output-suffix"];
        const defaultOutName = outputSuffix
            ? `translation-results-${outputSuffix}.json`
            : "translation-results.json";
        const outPath = resolveOutFilePath(
            systemContext,
            params.flags.out,
            "out",
            workdir,
            defaultOutName,
            context,
        );
        if (outPath === null) return;
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Corpus file not found: ${inPath}. Generate one with \`@collision corpus generate\`.`,
                context,
            );
            return;
        }
        const concurrency = Math.max(1, params.flags.concurrency ?? 4);
        const strategyFlag = params.flags.strategy ?? "first-match";
        const validStrategies = new Set([
            "first-match",
            "score-rank",
            "priority",
            "user-clarify",
        ]);
        if (!validStrategies.has(strategyFlag)) {
            displayWarn(
                `Unknown --strategy '${strategyFlag}'. Expected one of: ${[...validStrategies].join(", ")}.`,
                context,
            );
            return;
        }
        const maxPhrases = params.flags["max-phrases"];

        // userContext mode + payload validation. Fixed mode requires a
        // JSON-encoded UserContext; expected-schema and none modes don't.
        const userContextModeFlag = (params.flags["user-context-mode"] ??
            "none") as string;
        const validUserContextModes = new Set<UserContextMode>([
            "none",
            "expected-schema",
            "fixed",
        ]);
        if (
            !validUserContextModes.has(userContextModeFlag as UserContextMode)
        ) {
            displayWarn(
                `Unknown --user-context-mode '${userContextModeFlag}'. Expected one of: ${[...validUserContextModes].join(", ")}.`,
                context,
            );
            return;
        }
        const userContextMode = userContextModeFlag as UserContextMode;
        let fixedUserContext: UserContext | undefined;
        if (userContextMode === "fixed") {
            const json = params.flags["user-context-json"];
            if (!json) {
                displayWarn(
                    `--user-context-mode=fixed requires --user-context-json '{"activeApp":"...","activeAppDescription":"..."}'.`,
                    context,
                );
                return;
            }
            try {
                const parsed = JSON.parse(json) as UserContext;
                if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    typeof parsed.activeApp !== "string"
                ) {
                    throw new Error(
                        "UserContext requires a string `activeApp` field.",
                    );
                }
                fixedUserContext = parsed;
            } catch (e) {
                displayWarn(
                    `Failed to parse --user-context-json: ${
                        e instanceof Error ? e.message : String(e)
                    }`,
                    context,
                );
                return;
            }
        }

        const partialWriter = createThrottledFileWriter(outPath, 3000);

        await withReadOnlySession(context, async () => {
            displayStatus(`Translation probe\nLoading ${inPath}…`, context);
            const corpus = JSON.parse(
                fs.readFileSync(inPath, "utf8"),
            ) as Corpus;
            const totalPhrases = corpus.actions.reduce(
                (n, a) => n + a.phrases.length,
                0,
            );
            const cap = maxPhrases
                ? Math.min(maxPhrases, totalPhrases)
                : totalPhrases;
            displayStatus(
                `Translation probe\n[0/${cap}] starting (concurrency ${concurrency}, strategy ${strategyFlag})…`,
                context,
            );

            const probeFile = await runTranslationProbe(
                corpus as TranslationCorpus,
                context,
                {
                    concurrency,
                    strategy: strategyFlag as CollisionStrategy,
                    ...(maxPhrases !== undefined && {
                        maxPhrases,
                    }),
                    ...(params.flags["model-label"] !== undefined && {
                        modelLabel: params.flags["model-label"],
                    }),
                    userContextMode,
                    ...(fixedUserContext !== undefined && {
                        fixedUserContext,
                    }),
                },
                (done, total) => {
                    if (done % 10 === 0 || done === total) {
                        displayStatus(
                            `Translation probe\n[${done}/${total}] (concurrency ${concurrency}, strategy ${strategyFlag})`,
                            context,
                        );
                    }
                },
                (getFile) => partialWriter.snapshot(getFile),
            );
            partialWriter.finalize(probeFile);

            const c = probeFile.summary.counts;
            const total = probeFile.summary.totalPhrases;
            const pct = (n: number) =>
                total === 0 ? "0.0%" : ((n / total) * 100).toFixed(1) + "%";
            const html =
                `<h3 style="margin:0 0 6px;font-size:14px;">Translation probe complete</h3>` +
                `<table style="font:12px ui-monospace,monospace;border-collapse:collapse;">` +
                `<tr><td style="padding:1px 8px;color:#888;">CLEAN</td><td style="padding:1px 8px;text-align:right;">${c.CLEAN} (${pct(c.CLEAN)})</td></tr>` +
                `<tr><td style="padding:1px 8px;color:#c44;">MISROUTE</td><td style="padding:1px 8px;text-align:right;">${c.MISROUTE} (${pct(c.MISROUTE)})</td></tr>` +
                `<tr><td style="padding:1px 8px;color:#888;">CLARIFY</td><td style="padding:1px 8px;text-align:right;">${c.CLARIFY} (${pct(c.CLARIFY)})</td></tr>` +
                `<tr><td style="padding:1px 8px;color:#888;">INVALID</td><td style="padding:1px 8px;text-align:right;">${c.INVALID} (${pct(c.INVALID)})</td></tr>` +
                `<tr><td style="padding:1px 8px;color:#888;">ERROR</td><td style="padding:1px 8px;text-align:right;">${c.ERROR} (${pct(c.ERROR)})</td></tr>` +
                `<tr><td style="padding:1px 8px;color:#888;">total</td><td style="padding:1px 8px;text-align:right;">${total}</td></tr>` +
                `</table>` +
                `<div style="font-family:system-ui,sans-serif;font-size:12px;padding:0 8px 8px;color:#777;">→ <code>${escapeShellHtml(outPath)}</code></div>`;
            const text: string[] = [
                `Translation probe complete (strategy: ${strategyFlag}, userContext: ${userContextMode})`,
                `  CLEAN    ${c.CLEAN.toString().padStart(5)} (${pct(c.CLEAN)})`,
                `  MISROUTE ${c.MISROUTE.toString().padStart(5)} (${pct(c.MISROUTE)})`,
                `  CLARIFY  ${c.CLARIFY.toString().padStart(5)} (${pct(c.CLARIFY)})`,
                `  INVALID  ${c.INVALID.toString().padStart(5)} (${pct(c.INVALID)})`,
                `  ERROR    ${c.ERROR.toString().padStart(5)} (${pct(c.ERROR)})`,
                `  total    ${total.toString().padStart(5)}`,
                `  → ${outPath}`,
            ];
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

// Shared defaults for the similarity overlay used by both the visualize
// command and the orchestrator.
const DEFAULT_VIZ_SIMILARITY_STRATEGY = "balanced";
const DEFAULT_VIZ_SIMILARITY_THRESHOLD = 0.85;

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

/**
 * Run the cross-schema similarity scan against every loaded action and
 * apply the chosen strategy at `threshold`. Returns the surviving pairs as
 * canonically-sorted SimilarityEdge records, plus meta for the payload.
 *
 * Read-only: the scan is pure embedding lookups + in-memory cosine
 * similarity. Reuses the on-disk embedding cache so subsequent runs are
 * fast. Returns an empty array on failure (logs a warning) so collision
 * hotspots viz still works without similarity overlay.
 */
async function runSimilarityScan(
    systemContext: CommandHandlerContext,
    strategyName: string,
    threshold: number,
    onStatus: (msg: string) => void,
): Promise<{
    edges: SimilarityEdge[];
    meta?: { strategy: string; threshold: number };
    skipped: { schemaName: string; reason: string }[];
}> {
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
        return { edges: [], skipped };
    }

    const strategy = getStrategy(strategyName);
    if (!strategy) {
        onStatus(
            `Similarity overlay skipped — unknown strategy "${strategyName}"`,
        );
        return { edges: [], skipped };
    }

    const cachePath = resolveSimilarityCachePath(systemContext);
    onStatus(`Similarity overlay\n[0/${inputs.length}] preparing…`);
    const scan = await computeActionSimilarity(inputs, {
        cachePath,
        onProgress: (phase, index, total, label) => {
            if (index % 50 === 0 || index === total) {
                onStatus(
                    `Similarity overlay · ${phase}\n[${index}/${total}]${label ? ` ${label}` : ""}`,
                );
            }
        },
    });
    const applied = applyStrategy(scan, strategy, threshold);

    const edges: SimilarityEdge[] = applied.pairs.map((p) => {
        const a = `${p.keyA.schemaName}.${p.keyA.actionName}`;
        const b = `${p.keyB.schemaName}.${p.keyB.actionName}`;
        return a < b
            ? { a, b, score: p.aggregateScore }
            : { a: b, b: a, score: p.aggregateScore };
    });
    return {
        edges,
        meta: { strategy: strategy.name, threshold },
        skipped,
    };
}

class CollisionCorpusVisualizeCommandHandler implements CommandHandler {
    public readonly description =
        "Build an interactive HTML visualization of misroute hotspots from reclassified probe results, overlaid with a cross-schema similarity scan";
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
            "similarity-strategy": {
                description: `Similarity strategy for the overlay (default ${DEFAULT_VIZ_SIMILARITY_STRATEGY})`,
                type: "string",
                optional: true,
            },
            "similarity-threshold": {
                description: `Similarity threshold for the overlay, decimal in [0,1] (default ${DEFAULT_VIZ_SIMILARITY_THRESHOLD})`,
                type: "string",
                optional: true,
            },
            "no-similarity": {
                description:
                    "Skip the similarity overlay; produce a corpus-only viz",
                type: "boolean",
                default: false,
            },
            translator: {
                description:
                    "Translator-probe results JSON to overlay (enables the 'translator-confirmed' source filter). Default: <workdir>/translation-results.json when present. Use --no-translator to skip.",
                type: "string",
                optional: true,
            },
            "no-translator": {
                description:
                    "Skip the translator overlay even if translation-results.json is present",
                type: "boolean",
                default: false,
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

        // Parse threshold (string flag → float; framework number flags are
        // integer-only).
        let simThreshold = DEFAULT_VIZ_SIMILARITY_THRESHOLD;
        if (params.flags["similarity-threshold"] !== undefined) {
            const parsed = parseFloat(params.flags["similarity-threshold"]);
            if (Number.isNaN(parsed)) {
                displayWarn(
                    `Invalid --similarity-threshold "${params.flags["similarity-threshold"]}" — must be a decimal in [0, 1].`,
                    context,
                );
                return;
            }
            simThreshold = Math.max(0, Math.min(1, parsed));
        }
        const simStrategy =
            params.flags["similarity-strategy"] ??
            DEFAULT_VIZ_SIMILARITY_STRATEGY;
        const skipSim = params.flags["no-similarity"] ?? false;

        ensureDir(path.dirname(outPath));

        const probeFile = JSON.parse(
            fs.readFileSync(inPath, "utf8"),
        ) as ProbeFile;

        let simEdges: SimilarityEdge[] = [];
        let simMeta: { strategy: string; threshold: number } | undefined;
        let simSkipped: { schemaName: string; reason: string }[] = [];
        if (!skipSim) {
            await withReadOnlySession(context, async () => {
                const result = await runSimilarityScan(
                    systemContext,
                    simStrategy,
                    simThreshold,
                    (msg) => displayStatus(msg, context),
                );
                simEdges = result.edges;
                simMeta = result.meta;
                simSkipped = result.skipped;
            });
        }

        // Translator overlay (optional). Enables the "translator-confirmed"
        // source filter by joining each ranker MISROUTE phrase with the LLM
        // translator's pick for the same phrase. Best-effort: when the
        // default file is absent and no explicit path was given, the viz is
        // built without it (the source option self-disables client-side).
        const skipTx = params.flags["no-translator"] ?? false;
        let txData:
            | { results: TranslationProbeRow[]; corpus: string }
            | undefined;
        let txNote = "";
        if (!skipTx) {
            const txPathExplicit = params.flags.translator !== undefined;
            const txPath = defaultPath(
                systemContext,
                params.flags.translator,
                workdir,
                DEFAULT_FILES.translator,
            );
            if (fs.existsSync(txPath)) {
                try {
                    const txFile = JSON.parse(
                        fs.readFileSync(txPath, "utf8"),
                    ) as TranslationProbeFile;
                    txData = { results: txFile.results, corpus: txPath };
                } catch (err) {
                    displayWarn(
                        `Failed to read translator results ${txPath}: ${
                            err instanceof Error ? err.message : String(err)
                        }. Building without the translator overlay.`,
                        context,
                    );
                }
            } else if (txPathExplicit) {
                displayWarn(
                    `Translator results not found: ${txPath}. Building without the translator overlay (run \`@collision corpus translate\` to populate).`,
                    context,
                );
            }
        }

        const payload = buildVisualizationPayload(
            probeFile,
            sankeyTop,
            simEdges,
            simMeta,
            txData,
        );
        const html = buildVisualizationHTML(payload);
        fs.writeFileSync(outPath, html);

        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
        const simNote = skipSim
            ? '<div style="font-size:11px;color:#c80;margin-top:4px;">similarity overlay disabled (--no-similarity)</div>'
            : `<div style="font-size:11px;color:#777;margin-top:4px;">similarity overlay: ${simEdges.length} pair(s) at threshold ${simThreshold} (strategy <code>${escapeShellHtml(simStrategy)}</code>)</div>`;
        if (skipTx) {
            txNote =
                '<div style="font-size:11px;color:#c80;margin-top:4px;">translator overlay disabled (--no-translator)</div>';
        } else if (payload.translator) {
            txNote = `<div style="font-size:11px;color:#777;margin-top:4px;">translator overlay: ${payload.translator.confirmedPhrases} confirmed phrase(s) across ${payload.translator.confirmedEdges} edge(s)</div>`;
        } else {
            txNote =
                '<div style="font-size:11px;color:#777;margin-top:4px;">translator overlay: not available (run <code>@collision corpus translate</code> to enable the translator-confirmed filter)</div>';
        }
        const skipNote = simSkipped.length
            ? `<div style="font-size:11px;color:#c80;margin-top:4px;">${simSkipped.length} schema(s) failed to load: ${simSkipped.map((s) => `<code>${escapeShellHtml(s.schemaName)}</code>`).join(", ")}</div>`
            : "";
        const summary =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Visualization written</h3>` +
            `<div style="font-size:12px;color:#777;margin-bottom:6px;">${probeFile.results.length} probe(s) · ${payload.matrix.cells.length} schema-pair cells · ${payload.sankey.length} sankey edges · ${payload.edges.length} table edges · ${sizeKB} KB</div>` +
            `<div style="font-size:12px;">→ <code>${escapeShellHtml(outPath)}</code></div>` +
            simNote +
            skipNote +
            txNote +
            `<div style="font-size:11px;color:#777;margin-top:4px;">Open in any browser.</div>` +
            `</div>`;
        const text = [
            `Visualization written: ${outPath} (${sizeKB} KB)`,
            `  ${probeFile.results.length} probes · ${payload.matrix.cells.length} schema-pair cells · ${payload.sankey.length} sankey edges · ${payload.edges.length} table edges`,
            skipSim
                ? `  similarity overlay: disabled`
                : `  similarity overlay: ${simEdges.length} pair(s) at threshold ${simThreshold}`,
            skipTx
                ? `  translator overlay: disabled`
                : payload.translator
                  ? `  translator overlay: ${payload.translator.confirmedPhrases} confirmed phrase(s) across ${payload.translator.confirmedEdges} edge(s)`
                  : `  translator overlay: not available`,
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
            styles: {
                description: `Comma-separated phrase styles (corpus only). Available: ${PHRASE_STYLE_KEYS.join(",")}. Default: ${DEFAULT_PHRASE_STYLES.join(",")}.`,
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
            translator: path.join(workdir, DEFAULT_FILES.translator),
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
        const stylesResolved = resolveStyles(params.flags.styles);
        if (stylesResolved.errors.length > 0) {
            for (const e of stylesResolved.errors) displayWarn(e, context);
            return;
        }
        const styles = stylesResolved.styles;
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
                        { schemas, models, concurrency, styles },
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
                fs.writeFileSync(files.corpus, JSON.stringify(corpus, null, 2));
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
                    { top, delta, concurrency },
                    (done, total) => {
                        if (done % 50 === 0 || done === total) {
                            displayStatus(
                                `Pipeline 2/4 · probe\n[${done}/${total}] (concurrency ${concurrency})`,
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
                // The orchestrator runs the similarity overlay too so the
                // hotspot HTML has a source filter populated. Run inside the
                // existing read-only session — reuses the embedding cache.
                const simResult = await runSimilarityScan(
                    systemContext,
                    DEFAULT_VIZ_SIMILARITY_STRATEGY,
                    DEFAULT_VIZ_SIMILARITY_THRESHOLD,
                    (msg) => displayStatus(msg, context),
                );
                // Best-effort translator overlay: if a translate run already
                // wrote translation-results.json into this workdir, fold it
                // in so the hotspot HTML offers the translator-confirmed
                // source filter. Absent file → viz without it (option
                // self-disables client-side).
                let txData:
                    | { results: TranslationProbeRow[]; corpus: string }
                    | undefined;
                if (fs.existsSync(files.translator)) {
                    try {
                        const txFile = JSON.parse(
                            fs.readFileSync(files.translator, "utf8"),
                        ) as TranslationProbeFile;
                        txData = {
                            results: txFile.results,
                            corpus: files.translator,
                        };
                    } catch {
                        // Ignore a malformed translator file in the pipeline;
                        // the standalone `visualize` command surfaces the
                        // parse error explicitly.
                    }
                }
                const payload = buildVisualizationPayload(
                    probeFile,
                    sankeyTop,
                    simResult.edges,
                    simResult.meta,
                    txData,
                );
                const html = buildVisualizationHTML(payload);
                fs.writeFileSync(files.html, html);
                const sizeKB = (fs.statSync(files.html).size / 1024).toFixed(0);
                const txStep = payload.translator
                    ? ` Translator overlay: ${payload.translator.confirmedPhrases} confirmed phrase(s).`
                    : "";
                displaySuccess(
                    `Step 4/4 visualize: ${files.html} (${sizeKB} KB) — open in browser. Similarity overlay: ${simResult.edges.length} pair(s).${txStep}`,
                    context,
                );
            }
        });
    }
}

// =============================================================================
// Handler: @collision corpus recovery
// =============================================================================

const RECOVERY_BUCKET_LABELS: Record<RuntimeBucket, string> = {
    sameSchema: "same-schema (likely benign)",
    crossInCluster: "cross, in cluster (llmSelect-tunable)",
    crossOutOfCluster: "cross, out of cluster (widen threshold)",
    crossOffList: "cross, off-list (structural)",
};
const RECOVERY_BUCKET_COLORS: Record<RuntimeBucket, string> = {
    sameSchema: "#5a8", // green — embedding picked right schema
    crossInCluster: "#36c", // blue — strategy can save
    crossOutOfCluster: "#c80", // amber — wider threshold needed
    crossOffList: "#c44", // red — structural
};

function renderRecoveryHTML(analysis: RecoveryAnalysis): string {
    const total = analysis.totalMisroutes;
    const pct = (n: number) =>
        total === 0 ? "0.0%" : ((n / total) * 100).toFixed(1) + "%";
    const C_MUTED = "#777";

    if (total === 0) {
        return (
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Recovery-rank analysis</h3>` +
            `<div style="color:${C_MUTED};">No MISROUTE results to analyze.</div></div>`
        );
    }

    const order: RuntimeBucket[] = [
        "sameSchema",
        "crossInCluster",
        "crossOutOfCluster",
        "crossOffList",
    ];
    const barWidth = 600;
    let cursor = 0;
    const barSegments = order
        .map((b) => {
            const w = Math.round((analysis.buckets[b] / total) * barWidth);
            const x = cursor;
            cursor += w;
            return `<rect x="${x}" y="0" width="${w}" height="22" fill="${RECOVERY_BUCKET_COLORS[b]}"></rect>`;
        })
        .join("");
    const barSvg = `<svg width="${barWidth}" height="22" style="display:block;border-radius:3px;overflow:hidden;margin:8px 0 12px;">${barSegments}</svg>`;

    const legendRows = order
        .map((b) => {
            const n = analysis.buckets[b];
            return `<tr>
                <td style="padding:2px 8px 2px 0;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${RECOVERY_BUCKET_COLORS[b]};vertical-align:middle;"></span></td>
                <td style="padding:2px 12px 2px 0;font-family:monospace;font-size:12px;">${RECOVERY_BUCKET_LABELS[b]}</td>
                <td style="padding:2px 12px 2px 0;font-family:monospace;font-size:12px;text-align:right;font-weight:600;">${n}</td>
                <td style="padding:2px 0;font-family:monospace;font-size:12px;color:${C_MUTED};text-align:right;">${pct(n)}</td>
            </tr>`;
        })
        .join("");

    // Top 25 actions by misroute count, with per-bucket breakdown.
    const topActions = analysis.perAction.slice(0, 25);
    const headStyle =
        "padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:600;color:#555;font-size:11px;";
    const cellStyle =
        "padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;font-family:monospace;font-size:12px;";
    const actionStyle =
        "padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:left;font-family:monospace;font-size:12px;";
    const actionRows = topActions
        .map((a) => {
            const cell = (n: number, color: string) =>
                n > 0
                    ? `<td style="${cellStyle}color:${color};font-weight:600;">${n}</td>`
                    : `<td style="${cellStyle}color:#bbb;">·</td>`;
            return `<tr>
                <td style="${actionStyle}">${escapeShellHtml(a.schemaName + "." + a.actionName)}</td>
                <td style="${cellStyle}font-weight:600;">${a.misrouteCount}</td>
                ${cell(a.sameSchema, RECOVERY_BUCKET_COLORS.sameSchema)}
                ${cell(a.crossInCluster, RECOVERY_BUCKET_COLORS.crossInCluster)}
                ${cell(a.crossOutOfCluster, RECOVERY_BUCKET_COLORS.crossOutOfCluster)}
                ${cell(a.crossOffList, RECOVERY_BUCKET_COLORS.crossOffList)}
            </tr>`;
        })
        .join("");

    // Three-way verdict: benign-dominated / tunable-dominated / structural.
    const same = analysis.buckets.sameSchema;
    const tunable =
        analysis.buckets.crossInCluster + analysis.buckets.crossOutOfCluster;
    const offList = analysis.buckets.crossOffList;
    let verdict: string;
    if (same >= tunable && same >= offList) {
        verdict = `<div style="margin-top:10px;padding:8px 10px;background:#efe;color:#060;border-left:3px solid #5a8;font-size:12px;">
            <b>Verdict: mostly benign.</b> ${same} of ${total} misroutes (${pct(same)}) are <i>same-schema</i> — embedding picked the right schema, the LLM should disambiguate within it.
            Real runtime risk is the cross-schema slice: <code>${tunable}</code> tunable + <code>${offList}</code> structural (${pct(tunable + offList)} combined).
          </div>`;
    } else if (tunable > offList) {
        verdict = `<div style="margin-top:10px;padding:8px 10px;background:#efe;color:#060;border-left:3px solid #080;font-size:12px;">
            <b>Verdict: tunable.</b> ${tunable} of ${total} misroutes (${pct(tunable)}) are cross-schema with the right schema reachable in top-${analysis.topK}.
            The lever is <code>llmSelect</code> strategy / threshold.
            Same-schema benign: <code>${same}</code> (${pct(same)}). Structural: <code>${offList}</code> (${pct(offList)}).
          </div>`;
    } else {
        verdict = `<div style="margin-top:10px;padding:8px 10px;background:#fee;color:#900;border-left:3px solid #c44;font-size:12px;">
            <b>Verdict: structural.</b> ${offList} of ${total} misroutes (${pct(offList)}) are cross-schema with the expected schema not in top-${analysis.topK}.
            Embedding ranker is genuinely losing the right agent. <code>llmSelect</code> tuning can't reach these.
            Same-schema benign: <code>${same}</code> (${pct(same)}). Tunable cross-schema: <code>${tunable}</code> (${pct(tunable)}).
          </div>`;
    }

    return (
        `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1000px;">` +
        `<h3 style="margin:0 0 6px;font-size:14px;">Recovery analysis (runtime-aware)</h3>` +
        `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">` +
        `<b>${total}</b> MISROUTE result(s) · top-K=<code>${analysis.topK}</code> · llmSelect threshold=<code>${analysis.delta.toFixed(2)}</code></div>` +
        barSvg +
        `<table style="border-collapse:collapse;margin-bottom:6px;">${legendRows}</table>` +
        verdict +
        `<h4 style="margin:18px 0 6px;font-size:13px;">Top 25 actions by misroute count</h4>` +
        `<table style="border-collapse:collapse;width:100%;font-size:12px;">` +
        `<thead><tr style="background:#fafafa;">` +
        `<th style="${headStyle}text-align:left;">Action</th>` +
        `<th style="${headStyle}">total</th>` +
        `<th style="${headStyle}color:${RECOVERY_BUCKET_COLORS.sameSchema};">same</th>` +
        `<th style="${headStyle}color:${RECOVERY_BUCKET_COLORS.crossInCluster};">in</th>` +
        `<th style="${headStyle}color:${RECOVERY_BUCKET_COLORS.crossOutOfCluster};">out</th>` +
        `<th style="${headStyle}color:${RECOVERY_BUCKET_COLORS.crossOffList};">off</th>` +
        `</tr></thead><tbody>${actionRows}</tbody></table>` +
        `</div>`
    );
}

function renderRecoveryText(analysis: RecoveryAnalysis): string[] {
    const total = analysis.totalMisroutes;
    const pct = (n: number) =>
        total === 0 ? "0.0%" : ((n / total) * 100).toFixed(1) + "%";
    const lines: string[] = [];
    lines.push(
        `Recovery analysis: ${total} misroute(s), top-K=${analysis.topK}, threshold=${analysis.delta}`,
    );
    if (total === 0) {
        return lines;
    }
    lines.push("");
    const order: RuntimeBucket[] = [
        "sameSchema",
        "crossInCluster",
        "crossOutOfCluster",
        "crossOffList",
    ];
    for (const b of order) {
        const n = analysis.buckets[b];
        lines.push(
            `  ${RECOVERY_BUCKET_LABELS[b].padEnd(42)} ${String(n).padStart(5)} (${pct(n)})`,
        );
    }
    const same = analysis.buckets.sameSchema;
    const tunable =
        analysis.buckets.crossInCluster + analysis.buckets.crossOutOfCluster;
    const offList = analysis.buckets.crossOffList;
    lines.push("");
    if (same >= tunable && same >= offList) {
        lines.push(
            `  Verdict: MOSTLY BENIGN — ${pct(same)} same-schema. Cross-schema runtime risk = ${pct(tunable + offList)}.`,
        );
    } else if (tunable > offList) {
        lines.push(
            `  Verdict: TUNABLE — ${pct(tunable)} cross-schema reachable in top-${analysis.topK}. Lever is llmSelect strategy/threshold.`,
        );
    } else {
        lines.push(
            `  Verdict: STRUCTURAL — ${pct(offList)} cross-schema off-list. Embedding ranker is losing the agent.`,
        );
    }
    lines.push("");
    lines.push("Top 25 actions by misroute count:");
    lines.push(
        `  ${"action".padEnd(50)} ${"total".padStart(6)} ${"same".padStart(6)} ${"in".padStart(6)} ${"out".padStart(6)} ${"off".padStart(6)}`,
    );
    for (const a of analysis.perAction.slice(0, 25)) {
        lines.push(
            `  ${(a.schemaName + "." + a.actionName).padEnd(50)} ${String(a.misrouteCount).padStart(6)} ${String(a.sameSchema).padStart(6)} ${String(a.crossInCluster).padStart(6)} ${String(a.crossOutOfCluster).padStart(6)} ${String(a.crossOffList).padStart(6)}`,
        );
    }
    return lines;
}

class CollisionCorpusRecoveryCommandHandler implements CommandHandler {
    public readonly description =
        "Decompose MISROUTE results by where the correct target ranks among the top-K candidates (which fix lever applies?)";
    public readonly parameters = {
        flags: {
            in: {
                description:
                    "Input reclassified probe-results JSON. Default: <workdir>/probe-results-reclassified.json",
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory for default-named files. Default: <instanceDir>/collisions",
                type: "string",
                optional: true,
            },
            delta: {
                description: `llmSelect threshold for the rank-2 tight/wide split (default ${DEFAULT_DELTA})`,
                type: "number",
                default: DEFAULT_DELTA,
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
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Reclassified probe results not found: ${inPath}. Run \`@collision corpus reanalyze\` first.`,
                context,
            );
            return;
        }
        const delta = Math.max(0, params.flags.delta ?? DEFAULT_DELTA);
        const probeFile = JSON.parse(
            fs.readFileSync(inPath, "utf8"),
        ) as ProbeFile;
        const analysis = analyzeRecoveryRank(probeFile, delta);
        context.actionIO.appendDisplay({
            type: "html",
            content: renderRecoveryHTML(analysis),
            alternates: [
                { type: "text", content: renderRecoveryText(analysis) },
            ],
        });
    }
}

// =============================================================================
// Handler: @collision corpus visualize-recovery
// =============================================================================

const DEFAULT_FILES_RECOVERY_HTML = "recovery-viz.html";

class CollisionCorpusVisualizeRecoveryCommandHandler implements CommandHandler {
    public readonly description =
        "Build an interactive HTML visualization of recovery-rank analysis (which fix lever applies, per action and per agent)";
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
                    "Output HTML path. Default: <workdir>/recovery-viz.html",
                type: "string",
                optional: true,
            },
            delta: {
                description: `llmSelect threshold for the rank-2 tight/wide split (default ${DEFAULT_DELTA})`,
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
            DEFAULT_FILES.reclassified,
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_FILES_RECOVERY_HTML,
        );
        if (!fs.existsSync(inPath)) {
            displayWarn(
                `Reclassified probe results not found: ${inPath}. Run \`@collision corpus reanalyze\` first.`,
                context,
            );
            return;
        }
        const delta = Math.max(0, params.flags.delta ?? DEFAULT_DELTA);
        ensureDir(path.dirname(outPath));

        const probeFile = JSON.parse(
            fs.readFileSync(inPath, "utf8"),
        ) as ProbeFile;
        const payload = buildRecoveryPayload(probeFile, delta);
        const html = buildRecoveryHTML(payload);
        fs.writeFileSync(outPath, html);

        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
        const summaryHtml =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Recovery visualization written</h3>` +
            `<div style="font-size:12px;color:#777;margin-bottom:6px;">${payload.summary.totalMisroutes} misroute(s) · ${payload.perAction.length} action(s) · ${payload.perAgent.length} agent(s) · ${sizeKB} KB</div>` +
            `<div style="font-size:12px;">→ <code>${escapeShellHtml(outPath)}</code></div>` +
            `<div style="font-size:11px;color:#777;margin-top:4px;">Open in any browser. Click headline-bar segments or legend chips to filter; click an action row to drill into phrases.</div>` +
            `</div>`;
        const summaryText = [
            `Recovery visualization written: ${outPath} (${sizeKB} KB)`,
            `  ${payload.summary.totalMisroutes} misroute(s) · ${payload.perAction.length} action(s) · ${payload.perAgent.length} agent(s)`,
            `  Open in any browser.`,
        ];
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

export function getCollisionCorpusCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Generate phrase corpora, probe through the embedding ranker, and build the collision-hotspot visualizations",
        defaultSubCommand: "run",
        commands: {
            generate: new CollisionCorpusGenerateCommandHandler(),
            probe: new CollisionCorpusProbeCommandHandler(),
            translate: new CollisionCorpusTranslateCommandHandler(),
            reanalyze: new CollisionCorpusReanalyzeCommandHandler(),
            recovery: new CollisionCorpusRecoveryCommandHandler(),
            visualize: new CollisionCorpusVisualizeCommandHandler(),
            "visualize-recovery":
                new CollisionCorpusVisualizeRecoveryCommandHandler(),
            run: new CollisionCorpusRunCommandHandler(),
        },
    };
}
