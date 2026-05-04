// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { getExploreModel } from "../lib/llm.js";
import type {
    CapturedState,
    CapturedTransition,
} from "./exploreTypes.js";
import type {
    ClusteringResult,
    NeutralStatesClassification,
    NeutralStateClassification,
    SynthesizedAction,
} from "./synthesisLlmSchema.js";
import type { TreeNode } from "./types.js";

export type SynthesisInput = {
    runDir: string;
    integrationName: string;
    /** Override the default LLM model. Defaults to getExploreModel(). */
    model?: ChatModel;
};

export type SynthesisOutput = {
    integrationName: string;
    actions: SynthesizedAction[];
    neutralStates: NeutralStateClassification[];
    clusters: ClusteringResult;
    chunkCount: number;
    discoveredActionsPath: string;
    reportPath: string;
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

const SYSTEM_PROMPT_BASE = `You are post-processing a UI-Automation exploration trace into a list of user-meaningful actions for a Windows desktop app. Be precise and conservative — don't invent capabilities the trace doesn't show.`;

export async function synthesize(
    input: SynthesisInput,
): Promise<SynthesisOutput> {
    const model = input.model ?? getExploreModel();
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
    const actions: SynthesizedAction[] = [];
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

    return {
        integrationName: input.integrationName,
        actions,
        neutralStates: neutralResult.classifications,
        clusters,
        chunkCount: chunks.length,
        discoveredActionsPath,
        reportPath,
    };
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
    lines.push(
        "Task: classify each state below as `isNeutral=true` if it's a settled rest point where a user could start a new task, or `isNeutral=false` if it's mid-flow (modal dialogs, animations in progress, transient prompts). Also assign each a short tabOrSection label like 'alarmTab.empty' or 'timerTab.running' when applicable.",
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
    lines.push(
        "Task: group these UI-action chunks by user-meaningful intent. Same intent across multiple chunks (e.g., creating an alarm with different times) belongs to one cluster. Pure tab-switching navigation should usually become one cluster (e.g., 'navigateToTab').",
    );
    lines.push(
        "Use camelCase verb-noun intent names. If a chunk's purpose is unclear or partial, list it under `orphans` instead.",
    );
    lines.push("");
    for (const ch of chunks) {
        lines.push(renderChunkForLLM(ch, graph, neutralByState));
    }
    lines.push("");
    lines.push("Return a ClusteringResult.");
    const result = await translator.translate(lines.join("\n"));
    if (!result.success) {
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
    lines.push(
        "For the playback recipe: include every step needed to replay this action from the precondition state. Use full selector paths exactly as they appear in the chunks. Where chunks differ in their value at a step, extract a parameter and use ${paramName} via valueRef. Where chunks all share a value at a step, use valueLiteral.",
    );
    lines.push(
        "Set destructive=true if the action removes user data (delete/reset/clear). Otherwise false.",
    );
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
        return null;
    }
    return result.data;
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
