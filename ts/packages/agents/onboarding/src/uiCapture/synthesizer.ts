// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { getSynthesisModel } from "../lib/llm.js";
import type {
    CapturedState,
    CapturedTransition,
} from "./exploreTypes.js";
import type {
    ClusteringResult,
    MergeRecommendation,
    NeutralStatesClassification,
    NeutralStateClassification,
    SynthesizedAction,
    ValidationResult,
} from "./synthesisLlmSchema.js";
import type { TreeNode } from "./types.js";

export type SynthesisInput = {
    runDir: string;
    integrationName: string;
    /** Override the default LLM model. Defaults to getExploreModel(). */
    model?: ChatModel;
    /**
     * If set, the synthesized actions are merged into a workspace-level
     * discoveredActions.json. The merged file is the canonical source for
     * downstream consumers (runtime agent, phraseGen, etc.).
     */
    workspaceDir?: string;
};

export type SynthesisOutput = {
    integrationName: string;
    actions: SynthesizedAction[];
    neutralStates: NeutralStateClassification[];
    clusters: ClusteringResult;
    chunkCount: number;
    discoveredActionsPath: string;
    reportPath: string;
    /** Path to the workspace-level merged file, when workspaceDir was set. */
    mergedActionsPath?: string;
    mergeStats?: {
        priorActionCount: number;
        addedActionCount: number;
        updatedActionCount: number;
        finalActionCount: number;
    };
    /** Validation pass output, if it ran. */
    validation?: ValidationResult;
};

export type DiscoveredActionsFile = {
    version: 1;
    integrationName: string;
    discoveredAt: string;
    source: string;
    actions: SynthesizedAction[];
};

type Chunk = {
    id: string;
    transitionIds: string[];
    startStateId: string;
    endStateId: string;
    isNeutralStart: boolean;
    isNeutralEnd: boolean;
};

type LoadedGraph = {
    states: CapturedState[];
    transitions: CapturedTransition[];
    runDir: string;
};

const SYSTEM_PROMPT_BASE = `You are post-processing a UI-Automation exploration trace into a list of user-meaningful actions for a Windows desktop app. Be precise and conservative — don't invent capabilities the trace doesn't show. Take time to think structurally about the data; over-fragmenting or duplicating actions is worse than under-discovering them.`;

const NEUTRAL_RULES = `Strict rules for isNeutral:
- A modal dialog, popup, flyout, wizard step, picker overlay, or "edit" pane is NEVER neutral. Even if it has stable controls, the user cannot "start a new task" from it — they must commit or cancel first.
- A confirmation prompt is NEVER neutral.
- A loading or transient state is NEVER neutral.
- An app's tab landing area (e.g., "Alarm tab list view", "Timer tab list view") IS neutral, even if it has data; it's the rest point.
- A running operation that the user has no obligation to commit (e.g., "Stopwatch running") IS neutral — it's an idle state of the running tool.
- Use the actionable controls listed for the state to decide. If the controls include "Save", "OK", "Cancel", "Discard", or other commit/dismiss verbs, that's a strong signal of a non-neutral mid-flow state.`;

const CLUSTERING_RULES = `Strict rules for clustering chunks into intents:

1) AGGRESSIVELY MERGE multi-step task flows. If a chunk performs an "open dialog → fill fields → click Save/OK/Confirm" sequence, the WHOLE chunk represents ONE user-intent (e.g., "createAlarm"), not three separate intents. Do not split.

2) PARAMETERIZE BY VARIATION. If multiple chunks share the same selector pattern but differ in values (e.g., 5 chunks each click a different tab; 2 chunks each create an alarm with a different time), they are the SAME cluster. The variation becomes a parameter at synthesis time.

3) RECOGNIZE TOGGLE BUTTONS. If the SAME selector is invoked across chunks but its effect differs by app state (e.g., a play/pause button, a start/stop button), emit TWO clusters — one per logical action — even though they share a selector. Don't lump alternating clicks of one button into a single 9-step recipe.

4) DON'T EMIT FRAGMENTS. Do not produce a cluster that contains only "set the name field" or only "click Save in a modal". Those are sub-steps of a parent task. Find the parent task and roll them up.

5) AIM FOR FEW CLUSTERS. A typical Windows app has 10-25 user-meaningful actions. If you're emitting 40+ clusters from <100 chunks, you're fragmenting. If you're emitting <5 clusters from rich exploration, you're over-merging.

6) Use camelCase verb-noun names (createAlarm, startTimer, navigateToTab, recordLap, etc.).

7) If a chunk's purpose is genuinely unclear or it's a partial path the explorer abandoned, list its id under \`orphans\` rather than forcing a cluster.`;

const SYNTHESIS_RULES = `Strict rules for synthesizing one action from a cluster:

A) USE THE MOST COMPLETE CHUNK AS THE BASIS. Some chunks in the cluster will be partial (the explorer bailed early, the user shortcut to defaults). Pick the CHUNK WITH THE MOST STEPS as the canonical playback shape. Do NOT take the intersection of chunks — that drops field-setting steps the user needs.

B) PARAMETER EXTRACTION. For each step in the canonical playback, look at the corresponding step across all chunks. If values vary, declare a parameter and use valueRef "\${paramName}". If values are constant, use valueLiteral. Even with only ONE chunk that has a value, declare a parameter for setValue/select-with-item steps when the value is clearly user-supplied (a name, a number, a city). Don't hardcode user-input values.

C) COMPLETE PLAYBACKS. The recipe must include EVERY step needed to perform the action from the precondition state — open dialog, fill fields, click Save. Don't omit the final commit step. Don't include unrelated steps from before/after the action.

D) TOGGLE-AWARE. If the same selector appears multiple times in adjacent chunks (e.g., 3 lap presses, 5 alternating play/pause clicks), the action is the SINGLE click — not the repeated clicking. Emit ONE step per logical action.

E) PARAMETER TYPES. number for numeric values; string for free text; boolean for toggle states; enum (with enumValues) for fixed sets of choices (like tab names).

F) DESTRUCTIVE FLAG. Set destructive=true for delete/remove/reset/clear actions. Otherwise false.

G) DESCRIPTIONS are short user-facing help text — what the action accomplishes, not how.`;

export async function synthesize(
    input: SynthesisInput,
): Promise<SynthesisOutput> {
    const model = input.model ?? getSynthesisModel();
    const graph = loadGraph(input.runDir);
    if (graph.states.length === 0) {
        throw new Error(`No states found in ${input.runDir}`);
    }
    if (graph.transitions.length === 0) {
        throw new Error(`No transitions found in ${input.runDir}`);
    }

    // Step 1: classify neutral states (one LLM call covering all states).
    const neutralResult = await classifyNeutralStates(model, graph);
    const neutralByState = new Map<string, NeutralStateClassification>();
    for (const c of neutralResult.classifications) {
        neutralByState.set(c.stateId, c);
    }

    // Step 2: chunk transitions deterministically using the neutrals.
    const chunks = chunkTransitions(graph.transitions, neutralByState);

    // Step 3: cluster chunks by intent (one LLM call).
    let clusters: ClusteringResult = { clusters: [], orphans: [] };
    if (chunks.length > 0) {
        clusters = await clusterChunks(
            model,
            chunks,
            graph,
            neutralByState,
        );
    }

    // Step 4: synthesize one action per cluster.
    let actions: SynthesizedAction[] = [];
    for (const cluster of clusters.clusters) {
        const action = await synthesizeOneCluster(
            model,
            cluster,
            chunks,
            graph,
            neutralByState,
        );
        if (action) {
            actions.push(action);
        }
    }

    // Step 4b: validation pass — review the full set, flag fragments/duplicates,
    // emit merge recommendations. Then apply merges deterministically.
    let validation: ValidationResult | undefined;
    if (actions.length > 0) {
        validation = await validateActions(model, actions);
        if (validation.mergeRecommendations && validation.mergeRecommendations.length > 0) {
            actions = applyMergeRecommendations(
                actions,
                validation.mergeRecommendations,
            );
        }
    }

    // Step 5: persist outputs.
    const discoveredActionsPath = path.join(input.runDir, "discoveredActions.json");
    writeFileSync(
        discoveredActionsPath,
        JSON.stringify(
            {
                version: 1,
                integrationName: input.integrationName,
                discoveredAt: new Date().toISOString(),
                source: "uiCapture",
                actions,
            },
            null,
            2,
        ),
    );
    const reportPath = path.join(input.runDir, "synthesisReport.md");
    writeFileSync(
        reportPath,
        renderReport({
            integrationName: input.integrationName,
            graph,
            chunks,
            neutralByState,
            clusters,
            actions,
        }),
    );

    // Step 6: optional merge into workspace-level discoveredActions.json.
    let mergedActionsPath: string | undefined;
    let mergeStats: SynthesisOutput["mergeStats"];
    if (input.workspaceDir) {
        const result = mergeIntoWorkspace({
            workspaceDir: input.workspaceDir,
            integrationName: input.integrationName,
            newActions: actions,
        });
        mergedActionsPath = result.path;
        mergeStats = result.stats;
    }

    return {
        integrationName: input.integrationName,
        actions,
        neutralStates: neutralResult.classifications,
        clusters,
        chunkCount: chunks.length,
        discoveredActionsPath,
        reportPath,
        ...(mergedActionsPath !== undefined ? { mergedActionsPath } : {}),
        ...(mergeStats !== undefined ? { mergeStats } : {}),
        ...(validation !== undefined ? { validation } : {}),
    };
}

/* ---------- Merge into workspace-level file ---------- */

export function mergeIntoWorkspace(opts: {
    workspaceDir: string;
    integrationName: string;
    newActions: SynthesizedAction[];
}): { path: string; stats: NonNullable<SynthesisOutput["mergeStats"]> } {
    const filePath = path.join(opts.workspaceDir, "discoveredActions.json");
    const prior = loadDiscoveredActions(filePath);
    const stats = {
        priorActionCount: prior.length,
        addedActionCount: 0,
        updatedActionCount: 0,
        finalActionCount: 0,
    };
    const byName = new Map<string, SynthesizedAction>();
    for (const a of prior) byName.set(a.actionName, a);

    for (const fresh of opts.newActions) {
        const existing = byName.get(fresh.actionName);
        if (!existing) {
            byName.set(fresh.actionName, fresh);
            stats.addedActionCount++;
        } else {
            byName.set(fresh.actionName, mergeAction(existing, fresh));
            stats.updatedActionCount++;
        }
    }

    const merged: DiscoveredActionsFile = {
        version: 1,
        integrationName: opts.integrationName,
        discoveredAt: new Date().toISOString(),
        source: "uiCapture",
        actions: [...byName.values()].sort((a, b) =>
            a.actionName.localeCompare(b.actionName),
        ),
    };
    stats.finalActionCount = merged.actions.length;
    writeFileSync(filePath, JSON.stringify(merged, null, 2));
    return { path: filePath, stats };
}

function loadDiscoveredActions(filePath: string): SynthesizedAction[] {
    if (!existsSync(filePath)) return [];
    try {
        const f = JSON.parse(readFileSync(filePath, "utf8")) as DiscoveredActionsFile;
        return Array.isArray(f.actions) ? f.actions : [];
    } catch {
        return [];
    }
}

function mergeAction(
    existing: SynthesizedAction,
    incoming: SynthesizedAction,
): SynthesizedAction {
    // Newer playback wins (it likely refines or generalizes the older one).
    const playback =
        incoming.playback.length >= existing.playback.length
            ? incoming.playback
            : existing.playback;
    // Description: keep the longer one.
    const description =
        incoming.description.length > existing.description.length
            ? incoming.description
            : existing.description;
    // Destructive: union (true if either run flagged it).
    const destructive = existing.destructive || incoming.destructive;
    // Preconditions / postconditions: prefer the newer if present, else keep the prior.
    const preconditions = incoming.preconditions ?? existing.preconditions;
    const postconditions = incoming.postconditions ?? existing.postconditions;
    // Parameters: merge by name, accumulate examples.
    const params = mergeParameters(existing.parameters, incoming.parameters);

    return {
        actionName: existing.actionName,
        description,
        parameters: params,
        playback,
        preconditions,
        postconditions,
        destructive,
    };
}

function mergeParameters(
    existing: SynthesizedAction["parameters"],
    incoming: SynthesizedAction["parameters"],
): SynthesizedAction["parameters"] {
    const byName = new Map<string, SynthesizedAction["parameters"][number]>();
    for (const p of existing) byName.set(p.name, p);
    for (const p of incoming) {
        const prev = byName.get(p.name);
        if (!prev) {
            byName.set(p.name, p);
            continue;
        }
        // Same name: merge examples (dedupe), prefer newer description, union enumValues.
        const examples = dedupeExamples([...prev.examples, ...p.examples]);
        const description =
            p.description.length > prev.description.length
                ? p.description
                : prev.description;
        const enumValues = p.enumValues ?? prev.enumValues;
        const merged: SynthesizedAction["parameters"][number] = {
            name: prev.name,
            type: p.type ?? prev.type,
            description,
            examples,
            ...(enumValues !== undefined ? { enumValues } : {}),
        };
        byName.set(prev.name, merged);
    }
    return [...byName.values()];
}

function dedupeExamples<T extends string | number | boolean>(arr: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const v of arr) {
        const key = JSON.stringify(v);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(v);
        }
    }
    return out;
}

/* ---------- Step 1: neutral classification ---------- */

async function classifyNeutralStates(
    model: ChatModel,
    graph: LoadedGraph,
): Promise<NeutralStatesClassification> {
    const translator = makeTranslator<NeutralStatesClassification>(
        model,
        "NeutralStatesClassification",
    );
    const lines: string[] = [];
    lines.push(SYSTEM_PROMPT_BASE);
    lines.push("");
    lines.push("Task: classify each state below as neutral or not.");
    lines.push("");
    lines.push(NEUTRAL_RULES);
    lines.push("");
    lines.push(
        "Assign each a short tabOrSection label like 'alarmTab.empty', 'alarmTab.editingDialog', 'timerTab.running' when applicable. Use 'modalX' if you can't tell which tab a non-neutral state belongs to.",
    );
    lines.push("");
    for (const state of graph.states) {
        const tree = loadStateTree(graph, state.id);
        lines.push(summarizeState(state, tree));
        lines.push("");
    }
    lines.push("Return a NeutralStatesClassification with one entry per stateId.");
    const result = await translator.translate(lines.join("\n"));
    if (!result.success) {
        process.stderr.write(
            `[synth] neutral classification translation failed: ${result.message}\n`,
        );
        // Fallback: assume all states are neutral. Better signal than silent failure.
        return {
            classifications: graph.states.map((s) => ({
                stateId: s.id,
                isNeutral: true,
                reason: `(fallback after LLM failure: ${result.message})`,
            })),
        };
    }
    return result.data;
}

function summarizeState(state: CapturedState, tree: TreeNode): string {
    const actionable: string[] = [];
    function walk(n: TreeNode): void {
        if (n.patterns.length > 0 && n.isEnabled && !n.isOffscreen) {
            const label = n.name ?? n.automationId ?? n.className ?? "";
            actionable.push(
                `${n.controlType}${label ? ` '${truncate(label, 40)}'` : ""} [${n.patterns.join(",")}]`,
            );
        }
        for (const c of n.children) walk(c);
    }
    walk(tree);
    const head = `${state.id} window='${state.windowTitle}' label='${state.label ?? ""}'`;
    const limited = actionable.slice(0, 30);
    const overflow =
        actionable.length > limited.length
            ? `\n  ... +${actionable.length - limited.length} more`
            : "";
    return `${head}\n  controls: ${limited.join("; ")}${overflow}`;
}

/* ---------- Step 2: chunking ---------- */

function chunkTransitions(
    transitions: CapturedTransition[],
    neutralByState: Map<string, NeutralStateClassification>,
): Chunk[] {
    const chunks: Chunk[] = [];
    let chunkId = 1;
    let pending: CapturedTransition[] = [];
    let pendingStart: string | null = null;

    const isNeutral = (id: string) =>
        neutralByState.get(id)?.isNeutral !== false; // unknown → assume neutral

    for (const t of transitions) {
        if (pendingStart === null) {
            pendingStart = t.fromStateId;
        }
        pending.push(t);
        if (isNeutral(t.toStateId)) {
            chunks.push({
                id: `C-${chunkId.toString().padStart(3, "0")}`,
                transitionIds: pending.map((p) => p.id),
                startStateId: pendingStart!,
                endStateId: t.toStateId,
                isNeutralStart: isNeutral(pendingStart!),
                isNeutralEnd: true,
            });
            chunkId++;
            pending = [];
            pendingStart = null;
        }
    }
    // Trailing non-neutral path (incomplete chunk).
    if (pending.length > 0) {
        const last = pending[pending.length - 1]!;
        chunks.push({
            id: `C-${chunkId.toString().padStart(3, "0")}`,
            transitionIds: pending.map((p) => p.id),
            startStateId: pendingStart!,
            endStateId: last.toStateId,
            isNeutralStart: isNeutral(pendingStart!),
            isNeutralEnd: false,
        });
    }
    return chunks;
}

/* ---------- Step 3: clustering ---------- */

async function clusterChunks(
    model: ChatModel,
    chunks: Chunk[],
    graph: LoadedGraph,
    neutralByState: Map<string, NeutralStateClassification>,
): Promise<ClusteringResult> {
    const translator = makeTranslator<ClusteringResult>(model, "ClusteringResult");
    const lines: string[] = [];
    lines.push(SYSTEM_PROMPT_BASE);
    lines.push("");
    lines.push("Task: group these UI-action chunks by user-meaningful intent.");
    lines.push("");
    lines.push(CLUSTERING_RULES);
    lines.push("");
    lines.push(`Total chunks to cluster: ${chunks.length}`);
    lines.push("");
    for (const ch of chunks) {
        lines.push(renderChunkForLLM(ch, graph, neutralByState));
    }
    lines.push("");
    lines.push("Return a ClusteringResult. Apply the rules above carefully.");
    const result = await translator.translate(lines.join("\n"));
    if (!result.success) {
        process.stderr.write(
            `[synth] clustering translation failed: ${result.message}\n`,
        );
        return { clusters: [], orphans: chunks.map((c) => c.id) };
    }
    return result.data;
}

function renderChunkForLLM(
    chunk: Chunk,
    graph: LoadedGraph,
    neutralByState: Map<string, NeutralStateClassification>,
): string {
    const startLabel = neutralByState.get(chunk.startStateId)?.tabOrSection ?? "";
    const endLabel = neutralByState.get(chunk.endStateId)?.tabOrSection ?? "";
    const lines: string[] = [];
    lines.push(
        `Chunk ${chunk.id}: ${chunk.startStateId}${startLabel ? ` (${startLabel})` : ""} → ${chunk.endStateId}${endLabel ? ` (${endLabel})` : ""}`,
    );
    for (const tid of chunk.transitionIds) {
        const t = graph.transitions.find((x) => x.id === tid);
        if (!t) continue;
        const value =
            t.trigger.value !== undefined
                ? ` value=${JSON.stringify(t.trigger.value)}`
                : "";
        const tail = lastSegment(t.trigger.selector);
        lines.push(`  ${t.trigger.verb} ${tail}${value}`);
    }
    return lines.join("\n");
}

/* ---------- Step 4: synthesis ---------- */

async function synthesizeOneCluster(
    model: ChatModel,
    cluster: ClusteringResult["clusters"][number],
    chunks: Chunk[],
    graph: LoadedGraph,
    neutralByState: Map<string, NeutralStateClassification>,
): Promise<SynthesizedAction | null> {
    const translator = makeTranslator<SynthesizedAction>(model, "SynthesizedAction");
    const memberChunks = chunks.filter((c) => cluster.chunkIds.includes(c.id));
    if (memberChunks.length === 0) return null;

    const lines: string[] = [];
    lines.push(SYSTEM_PROMPT_BASE);
    lines.push("");
    lines.push(
        `Task: synthesize a single SynthesizedAction for the intent '${cluster.intentName}' (${cluster.shortDescription}).`,
    );
    lines.push(
        `This intent was observed across ${memberChunks.length} chunk(s). Each chunk is a sequence of (selector, verb, value) tuples that together accomplish the intent.`,
    );
    lines.push("");
    lines.push(SYNTHESIS_RULES);
    lines.push("");
    lines.push("Use full selector paths exactly as they appear in the chunks.");
    lines.push("");
    for (const ch of memberChunks) {
        const startLabel = neutralByState.get(ch.startStateId)?.tabOrSection ?? "";
        const endLabel = neutralByState.get(ch.endStateId)?.tabOrSection ?? "";
        lines.push(
            `Chunk ${ch.id}: ${ch.startStateId}${startLabel ? ` (${startLabel})` : ""} → ${ch.endStateId}${endLabel ? ` (${endLabel})` : ""}`,
        );
        for (const tid of ch.transitionIds) {
            const t = graph.transitions.find((x) => x.id === tid);
            if (!t) continue;
            const value =
                t.trigger.value !== undefined
                    ? ` value=${JSON.stringify(t.trigger.value)}`
                    : "";
            lines.push(
                `  ${t.trigger.verb} selector="${t.trigger.selector}"${value}`,
            );
        }
        lines.push("");
    }
    lines.push("Return a SynthesizedAction.");
    const result = await translator.translate(lines.join("\n"));
    if (!result.success) {
        process.stderr.write(
            `[synth] cluster '${cluster.intentName}' synthesis translation failed: ${result.message}\n`,
        );
        return null;
    }
    return result.data;
}

/* ---------- Step 4b: validation pass ---------- */

async function validateActions(
    model: ChatModel,
    actions: SynthesizedAction[],
): Promise<ValidationResult> {
    const translator = makeTranslator<ValidationResult>(model, "ValidationResult");
    const lines: string[] = [];
    lines.push(SYSTEM_PROMPT_BASE);
    lines.push("");
    lines.push(
        "Task: review the synthesized action set below and judge its quality. Look for:",
    );
    lines.push(
        "- FRAGMENTS: actions that are obviously a sub-step of another (e.g., 'setAlarmDetails' that just sets the name field, or 'confirmAlarm' that just clicks Save). These shouldn't exist as separate actions; they should be merged INTO their parent action.",
    );
    lines.push(
        "- DUPLICATES: multiple actions doing the same thing with different parameter values (e.g., 'navigateToTabAlarm', 'navigateToTabTimer', 'navigateToTabClock' should all be ONE 'navigateToTab' with a tab parameter).",
    );
    lines.push(
        "- BROKEN: actions whose playback is obviously incomplete (1 step that just opens a dialog and never closes it, or N invocations of the same toggle button merged into one recipe).",
    );
    lines.push(
        "- AMBIGUOUS: action names too generic to be useful, or descriptions that don't match the playback.",
    );
    lines.push("");
    lines.push(
        "For DUPLICATES specifically, emit mergeRecommendations: list the action names to merge, propose a single combined name, and propose the parameter (with type and possibly enumValues) that distinguishes them.",
    );
    lines.push("");
    lines.push("--- Action set under review ---");
    lines.push("");
    for (const a of actions) {
        lines.push(`### ${a.actionName}`);
        lines.push(`description: ${a.description}`);
        lines.push(
            `parameters: ${a.parameters.map((p) => `${p.name}:${p.type}=${JSON.stringify(p.examples)}`).join(", ") || "(none)"}`,
        );
        lines.push(`destructive: ${a.destructive}`);
        lines.push(`playback (${a.playback.length} step(s)):`);
        for (let i = 0; i < a.playback.length; i++) {
            const s = a.playback[i]!;
            const v =
                s.valueRef !== undefined
                    ? ` ref=${s.valueRef}`
                    : s.valueLiteral !== undefined
                      ? ` lit=${JSON.stringify(s.valueLiteral)}`
                      : "";
            lines.push(`  ${i + 1}. ${s.verb}${v} on ${lastSegment(s.selector)}`);
        }
        lines.push("");
    }
    lines.push(
        "Return a ValidationResult. Be willing to flag many actions if the set is poorly synthesized.",
    );
    const result = await translator.translate(lines.join("\n"));
    if (!result.success) {
        return { reviews: [] };
    }
    return result.data;
}

function applyMergeRecommendations(
    actions: SynthesizedAction[],
    recs: MergeRecommendation[],
): SynthesizedAction[] {
    let working = [...actions];
    for (const rec of recs) {
        const targets = rec.actionNames
            .map((n) => working.find((a) => a.actionName === n))
            .filter((x): x is SynthesizedAction => x !== undefined);
        if (targets.length < 2) continue;

        // Use the LONGEST playback as the canonical recipe (most complete observation).
        const canonical = targets.reduce((best, cur) =>
            cur.playback.length > best.playback.length ? cur : best,
        );

        // Build the parameter that distinguishes the variants.
        const distParam = {
            name: rec.proposedParam.name,
            type: rec.proposedParam.type,
            description: `Distinguishes ${rec.actionNames.join(" / ")} variants.`,
            examples: collectExamples(targets),
            ...(rec.proposedParam.enumValues !== undefined
                ? { enumValues: rec.proposedParam.enumValues }
                : {}),
        };

        // Strip the literal that varies (we don't know which step it's at without reading
        // the cluster; mark every literal-with-matching-type as a candidate ref so the
        // user/runtime can fix up. This is heuristic — log it in description.)
        const playback = canonical.playback.map((s) => {
            // Only swap a literal of the proposed-param type to a valueRef on the FIRST match.
            return s;
        });
        // Conservative: append note to description; leave playback literals alone.
        // (Better: we'd reconstruct from the cluster's chunk variations. Future work.)

        // Merged action.
        const merged: SynthesizedAction = {
            actionName: rec.proposedName,
            description:
                canonical.description +
                `  [merged from: ${rec.actionNames.join(", ")}]`,
            parameters: dedupeParams([...canonical.parameters, distParam]),
            playback,
            preconditions: canonical.preconditions,
            postconditions: canonical.postconditions,
            destructive: targets.some((t) => t.destructive),
        };

        // Replace targets with merged.
        working = working.filter((a) => !rec.actionNames.includes(a.actionName));
        working.push(merged);
    }
    return working;
}

function collectExamples(actions: SynthesizedAction[]): Array<string | number | boolean> {
    // Use the actionName variants as examples when no parameters distinguish them.
    return actions.map((a) => {
        const m = a.actionName.match(/[A-Z][a-z]+$/);
        return m ? m[0].toLowerCase() : a.actionName;
    });
}

function dedupeParams(
    params: SynthesizedAction["parameters"],
): SynthesizedAction["parameters"] {
    const seen = new Set<string>();
    return params.filter((p) => {
        if (seen.has(p.name)) return false;
        seen.add(p.name);
        return true;
    });
}

/* ---------- Output report ---------- */

function renderReport(args: {
    integrationName: string;
    graph: LoadedGraph;
    chunks: Chunk[];
    neutralByState: Map<string, NeutralStateClassification>;
    clusters: ClusteringResult;
    actions: SynthesizedAction[];
}): string {
    const lines: string[] = [];
    lines.push(`# Synthesis report: ${args.integrationName}`);
    lines.push("");
    lines.push(
        `Run dir: \`${args.graph.runDir}\``,
    );
    lines.push(
        `States: ${args.graph.states.length}  ·  Transitions: ${args.graph.transitions.length}  ·  Chunks: ${args.chunks.length}`,
    );
    lines.push(
        `Clusters: ${args.clusters.clusters.length}  ·  Orphans: ${args.clusters.orphans?.length ?? 0}  ·  Synthesized actions: ${args.actions.length}`,
    );
    lines.push("");
    lines.push("## Neutral classifications");
    for (const c of [...args.neutralByState.values()]) {
        const flag = c.isNeutral ? "✓" : "✗";
        const label = c.tabOrSection ? ` [${c.tabOrSection}]` : "";
        lines.push(`- ${flag} ${c.stateId}${label}: ${c.reason}`);
    }
    lines.push("");
    lines.push("## Clusters");
    for (const cl of args.clusters.clusters) {
        lines.push(
            `- **${cl.intentName}** (${cl.clusterId}): ${cl.shortDescription} — chunks: ${cl.chunkIds.join(", ")}`,
        );
    }
    if (args.clusters.orphans && args.clusters.orphans.length > 0) {
        lines.push("");
        lines.push(
            `Orphan chunks: ${args.clusters.orphans.join(", ")}`,
        );
    }
    lines.push("");
    lines.push("## Synthesized actions");
    for (const a of args.actions) {
        lines.push(`### ${a.actionName}${a.destructive ? " (destructive)" : ""}`);
        lines.push(a.description);
        lines.push("");
        lines.push("Parameters:");
        if (a.parameters.length === 0) {
            lines.push("  (none)");
        } else {
            for (const p of a.parameters) {
                const eg = p.examples
                    .slice(0, 5)
                    .map((v) => JSON.stringify(v))
                    .join(", ");
                lines.push(
                    `  - \`${p.name}\` (${p.type}${p.enumValues ? `: ${p.enumValues.join("|")}` : ""}) — ${p.description}${eg ? `; examples: ${eg}` : ""}`,
                );
            }
        }
        lines.push("");
        lines.push("Playback:");
        for (let i = 0; i < a.playback.length; i++) {
            const step = a.playback[i]!;
            const valuePart =
                step.valueRef !== undefined
                    ? ` ${step.valueRef}`
                    : step.valueLiteral !== undefined
                      ? ` ${JSON.stringify(step.valueLiteral)}`
                      : "";
            lines.push(
                `  ${i + 1}. ${step.verb}${valuePart} on \`${step.selector}\``,
            );
        }
        lines.push("");
        lines.push(`Preconditions: ${a.preconditions.description}`);
        lines.push(`Postconditions: ${a.postconditions.description}`);
        lines.push("");
    }
    return lines.join("\n");
}

/* ---------- helpers ---------- */

function makeTranslator<T extends object>(
    model: ChatModel,
    typeName: string,
): TypeChatJsonTranslator<T> {
    const schema = loadSchema(["synthesisLlmSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    return createJsonTranslator<T>(model, validator);
}

function loadGraph(runDir: string): LoadedGraph {
    const statesFile = path.join(runDir, "states.jsonl");
    const transitionsFile = path.join(runDir, "transitions.jsonl");
    if (!existsSync(statesFile) || !existsSync(transitionsFile)) {
        throw new Error(`Missing states.jsonl or transitions.jsonl in ${runDir}`);
    }
    const states = readFileSync(statesFile, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as CapturedState);
    const transitions = readFileSync(transitionsFile, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as CapturedTransition);
    return { states, transitions, runDir };
}

function loadStateTree(graph: LoadedGraph, stateId: string): TreeNode {
    const state = graph.states.find((s) => s.id === stateId);
    if (!state) {
        throw new Error(`No such state: ${stateId}`);
    }
    return JSON.parse(
        readFileSync(path.join(graph.runDir, state.treeFile), "utf8"),
    ) as TreeNode;
}

function lastSegment(selector: string): string {
    const segs = selector.split("/").filter((s) => s.length > 0);
    return segs[segs.length - 1] ?? selector;
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
