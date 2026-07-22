// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The shared building blocks a resolution stage is drawn from, used by both the
 * compact one-liner rows and the expanded side-by-side cause card: status chips,
 * the tone-colored outcome phrase, the labeled read-only artifact values (matched
 * rule, produced action, construction id) and their go-to-file affordance. Kept
 * separate so the pipeline layout and the cause/result layout can each compose
 * them without depending on one another.
 */

import type {
    TraceNodeSummary,
    TraceStageView,
} from "../traceDivergenceViewModel.js";
import type { TraceSide, TraceSourceNode } from "../traceProtocol.js";
import { el, capitalize } from "./traceViewerDom.js";
import { requestSource } from "./traceViewerBridge.js";

const STAGE_STATUS_LABEL: Record<TraceStageView["status"], string> = {
    agree: "same",
    diverge: "diverges",
    "one-sided": "one side",
    inapplicable: "n/a",
};

const STAGE_STATUS_HELP: Record<TraceStageView["status"], string> = {
    agree: "Both versions ran this stage the same way.",
    diverge: "This is where the two versions parted ways.",
    "one-sided":
        "Only one version engaged this stage — typically a live-only step a git-ref side can't run.",
    inapplicable: "Neither version actively ran this stage here.",
};

/** The text, tone, and hover for a stage's status chip. */
export interface StatusChip {
    label: string;
    tone?: OutcomeTone;
    help: string;
}

/** The status chip for a pre-action stage. A grammar divergence that gained or
 *  lost a rule match in B is stated directionally — "new in B" (green) for a
 *  match B introduced, "lost in B" (orange) for one it dropped — the same
 *  vocabulary and tone the Result chip uses; every other status keeps its plain
 *  convergence label. */
export function stageStatusChip(stage: TraceStageView): StatusChip {
    if (stage.status === "diverge" && stage.kind === "grammar-match") {
        const aMatched = stage.a?.grammar?.chosenRule !== undefined;
        const bMatched = stage.b?.grammar?.chosenRule !== undefined;
        if (!aMatched && bMatched) {
            return {
                label: "new in B",
                tone: "positive",
                help: "Only B matched a rule — a new match B introduced.",
            };
        }
        if (aMatched && !bMatched) {
            return {
                label: "lost in B",
                tone: "negative",
                help: "Only A matched a rule — a match B lost.",
            };
        }
    }
    return {
        label: STAGE_STATUS_LABEL[stage.status],
        help: STAGE_STATUS_HELP[stage.status],
    };
}

export function stageHead(name: string, chip: StatusChip): HTMLElement {
    const head = el("div", "stage-head");
    head.appendChild(el("span", "stage-marker"));
    const label = el("span", "stage-name");
    label.textContent = name;
    head.appendChild(label);
    head.appendChild(statusChip(chip));
    return head;
}

/** A stage-status chip element, tinted green/orange when the status carries an
 *  improvement/regression direction. */
export function statusChip(chip: StatusChip): HTMLElement {
    const node = el("span", "stage-status");
    if (chip.tone !== undefined) {
        node.classList.add(`is-${chip.tone}`);
    }
    node.textContent = chip.label;
    node.title = chip.help;
    return node;
}

/** The representative node for a compact stage: the side that actually ran,
 *  preferring the live B side, so the one-liner describes what happened. */
function representative(
    stage: TraceStageView,
): { node: TraceNodeSummary; side: TraceSide } | undefined {
    if (stage.b?.executionLabel === "ran") {
        return { node: stage.b, side: "b" };
    }
    if (stage.a?.executionLabel === "ran") {
        return { node: stage.a, side: "a" };
    }
    if (stage.b !== undefined) {
        return { node: stage.b, side: "b" };
    }
    if (stage.a !== undefined) {
        return { node: stage.a, side: "a" };
    }
    return undefined;
}

/** A converged / one-sided / inapplicable stage as a single line: what happened,
 *  with the winning rule still a source jump where recorded. One-sided stages
 *  name the side that ran. */
export function compactBody(stage: TraceStageView): HTMLElement {
    const body = el("div", "stage-compact");
    const rep = representative(stage);
    const summary = el("div", "stage-summary");
    if (rep === undefined) {
        summary.classList.add("is-muted");
        summary.textContent = "not applicable to either version";
        body.appendChild(summary);
        return body;
    }
    summary.appendChild(compactContent(stage, rep.node));
    if (stage.status === "one-sided") {
        const only = el("span", "only-side");
        only.textContent = `${rep.side.toUpperCase()} only`;
        only.title =
            "Only this version engaged the stage; the other ran a different fidelity path.";
        summary.appendChild(only);
    }
    body.appendChild(summary);
    return body;
}

/** The single outcome phrase for one stage on one side, plus the tone used to
 *  color it. A side that didn't actively run the stage reads as its muted
 *  execution state ("Not applicable", "Not reached"). */
export type OutcomeTone = "positive" | "negative" | "neutral" | "muted";

function stageOutcome(
    kind: TraceStageView["kind"],
    node: TraceNodeSummary,
): { text: string; tone: OutcomeTone } {
    if (node.executionLabel !== "ran") {
        return { text: capitalize(node.executionLabel), tone: "muted" };
    }
    switch (kind) {
        case "cache-consult":
            return node.outcomeLabel === "hit"
                ? { text: "Cache hit", tone: "positive" }
                : { text: "Cache miss", tone: "neutral" };
        case "grammar-match":
            return node.grammar?.chosenRule !== undefined
                ? { text: "Matched", tone: "positive" }
                : { text: "No match", tone: "negative" };
        case "wildcard-validation":
            return node.outcomeLabel === "rejected"
                ? { text: "Rejected", tone: "negative" }
                : { text: "Accepted", tone: "positive" };
        default:
            return node.action?.actionName !== undefined
                ? { text: "Produced action", tone: "positive" }
                : { text: "No action", tone: "negative" };
    }
}

/** The outcome phrase as a tone-colored span, with the node's raw detail on
 *  hover. The single consistent primary line every side card and compact row
 *  leads with. */
export function outcomeSpan(
    kind: TraceStageView["kind"],
    node: TraceNodeSummary,
): HTMLElement {
    const { text, tone } = stageOutcome(kind, node);
    const span = el("span", "outcome");
    span.classList.add(`is-${tone}`);
    span.textContent = text;
    if (node.detail !== undefined) {
        span.title = node.detail;
    }
    return span;
}

/** The one mono value identifying what a stage produced on a side: the matched
 *  rule, the produced action, or the construction id. A read-only value paired at
 *  the call site with {@link artifactLabel} so its meaning is explicit; the file
 *  behind a divergence is reached through the diverging stage's diff chip, not
 *  from here. Absent for stages with no such artifact or when the side produced
 *  none. */
function stageArtifact(
    kind: TraceStageView["kind"],
    node: TraceNodeSummary,
): HTMLElement | undefined {
    switch (kind) {
        case "grammar-match":
            return node.grammar?.chosenRule !== undefined
                ? ruleChip(node.grammar)
                : undefined;
        case "action":
            return node.action?.actionName !== undefined
                ? actionChip(node.action)
                : undefined;
        case "cache-consult":
            return node.cache?.constructionId !== undefined
                ? cacheChip(node.cache)
                : undefined;
        default:
            return undefined;
    }
}

/** The dim micro-label naming what a side card's artifact value is, so a bare
 *  token (a rule name) can't be mistaken for a file or an action. */
function artifactLabel(kind: TraceStageView["kind"]): string | undefined {
    switch (kind) {
        case "grammar-match":
            return "rule";
        case "action":
            return "action";
        case "cache-consult":
            return "construction";
        default:
            return undefined;
    }
}

/** A side card's artifact as a labeled value: the dim micro-label, the mono
 *  value, and — when the trace recorded a location — a small go-to-file icon that
 *  opens that side's version of the backing file. Nothing when the side produced
 *  no such artifact. */
export function labeledArtifact(
    kind: TraceStageView["kind"],
    side: TraceSide,
    node: TraceNodeSummary,
): HTMLElement | undefined {
    const value = stageArtifact(kind, node);
    if (value === undefined) {
        return undefined;
    }
    const line = el("div", "side-artifact");
    const label = artifactLabel(kind);
    if (label !== undefined) {
        const tag = el("span", "artifact-label");
        tag.textContent = label;
        line.appendChild(tag);
    }
    line.appendChild(value);
    const open = openSourceButton(kind, side, node);
    if (open !== undefined) {
        line.appendChild(open);
    }
    return line;
}

/** The source node a stage's artifact can open, when the trace recorded its
 *  location: the matched rule's `.agr` for a grammar stage, the produced action's
 *  schema for an action stage. Undefined when nothing is openable. */
function sourceNodeFor(
    kind: TraceStageView["kind"],
    node: TraceNodeSummary,
): TraceSourceNode | undefined {
    if (kind === "grammar-match" && node.grammar?.hasSource === true) {
        return "grammar-match";
    }
    if (kind === "action" && node.action?.hasSchema === true) {
        return "action";
    }
    return undefined;
}

/** A small go-to-file icon beside a rule/action value that opens that side's
 *  version of the backing file, scrolled to the rule or schema span. A distinct
 *  affordance from the value itself, so the token stays a plain identifier. */
function openSourceButton(
    kind: TraceStageView["kind"],
    side: TraceSide,
    node: TraceNodeSummary,
): HTMLElement | undefined {
    const source = sourceNodeFor(kind, node);
    if (source === undefined) {
        return undefined;
    }
    const what =
        source === "grammar-match" ? "grammar source" : "action schema";
    const title = `Open ${side.toUpperCase()}'s ${what}`;
    const btn = el("button", "open-source") as HTMLButtonElement;
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.appendChild(el("span", "codicon codicon-go-to-file"));
    btn.addEventListener("click", () => requestSource(side, source));
    return btn;
}

/** A converged / one-sided / inapplicable stage as one inline line: the
 *  representative side's outcome phrase and its artifact value. */
function compactContent(
    stage: TraceStageView,
    node: TraceNodeSummary,
): HTMLElement {
    const wrap = el("span", "summary-content");
    wrap.appendChild(outcomeSpan(stage.kind, node));
    const artifact = stageArtifact(stage.kind, node);
    if (artifact !== undefined) {
        wrap.appendChild(artifact);
    }
    return wrap;
}

/** The matched rule as a read-only mono value. Labeled `rule` by its side card so
 *  the bare token can't be read as a file or an action; the file behind a
 *  divergence is reached through the diverging stage's diff chip, not here. */
function ruleChip(
    grammar: NonNullable<TraceNodeSummary["grammar"]>,
): HTMLElement {
    const code = el("code", "mono rule");
    code.textContent = grammar.chosenRule ?? "grammar";
    return code;
}

/** The produced action as a read-only mono value, labeled `action` by its side
 *  card. */
function actionChip(
    action: NonNullable<TraceNodeSummary["action"]>,
): HTMLElement {
    const code = el("code", "mono action-name");
    code.textContent = action.actionName ?? "action";
    return code;
}

/** The matched construction id as a mono chip, with its namespace and pattern on
 *  hover so a cache stage stays inspectable without a second panel. */
function cacheChip(cache: NonNullable<TraceNodeSummary["cache"]>): HTMLElement {
    const id = el("code", "mono cache-id");
    id.textContent = `#${cache.constructionId}`;
    const tip: string[] = [];
    if (cache.namespace !== undefined) {
        tip.push(`Namespace: ${cache.namespace}`);
    }
    if (cache.parts !== undefined && cache.parts.length > 0) {
        tip.push(`Pattern: ${cache.parts.join(" ")}`);
    }
    id.title = tip.length > 0 ? tip.join("\n") : "Matched construction id.";
    return id;
}
