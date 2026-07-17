// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer webview client. Renders one row's resolution as a top-to-
 * bottom **pipeline** a developer reads to answer "where did version A and
 * version B diverge on this utterance, and what changed there?" The stages run
 * in resolution order (construction cache → grammar match → wildcard validation
 * → Result). Stages the two versions agree on are compact one-liners; the stage
 * where they diverged expands into a side-by-side A vs B card accented as the
 * cause, and carries its own dig-in — including a native A↔B diff of the grammar
 * or schema file behind the divergence, driven from that stage rather than a
 * disconnected top button.
 *
 * Everything divergence-related is derived by the shared, browser-neutral
 * {@link toTraceDivergenceViewModel}; this file only turns that view model into
 * DOM. No inline styles (the CSP forbids them) — every visual is a CSS class.
 */

import type { ReplayResolutionTrace } from "@typeagent/core/replay";
import {
    toTraceDivergenceViewModel,
    TRACE_LAYER_NAME,
    type TraceDivergenceViewModel,
    type TraceNodeSummary,
    type TraceStageView,
} from "../traceDivergenceViewModel.js";
import type { ActionDiff } from "../replayViewModel.js";
import type {
    HostToTraceMessage,
    TraceToHostMessage,
    TraceUnavailableState,
    TraceSide,
    TraceSourceNode,
} from "../traceProtocol.js";

interface VsCodeApi {
    postMessage(message: TraceToHostMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// The recorded trace is the single source of truth for what the row resolved.
let recorded: ReplayResolutionTrace | undefined;
let unavailable: TraceUnavailableState | undefined = "loading";
let traceError: string | undefined;

// Transient feedback from the last source open/compare (e.g. a file that can't
// be located); cleared when the row changes or a jump succeeds.
let sourceNote: string | undefined;

// Monotonic id for source open/compare requests so a stale reply is ignored.
let sourceRequestId = 0;

// Post a source-jump request for one node on one side; the host opens that
// side's version of the backing file, scrolled to the recorded span.
function requestSource(side: TraceSide, node: TraceSourceNode): void {
    sourceRequestId += 1;
    sourceNote = undefined;
    render();
    vscode.postMessage({
        type: "open-source",
        requestId: sourceRequestId,
        side,
        node,
    });
}

// Post a compare request: the host opens a native A↔B diff of the node's file.
function requestCompare(node: TraceSourceNode): void {
    sourceRequestId += 1;
    sourceNote = undefined;
    render();
    vscode.postMessage({
        type: "compare-source",
        requestId: sourceRequestId,
        node,
    });
}

const root = document.getElementById("root") as HTMLElement;

window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToTraceMessage;
    switch (msg.type) {
        case "trace":
            recorded = msg.recorded;
            unavailable = undefined;
            traceError = undefined;
            // Reset transient per-row state so a previous row's source-open
            // error doesn't bleed into the new row.
            sourceNote = undefined;
            render();
            break;
        case "trace-state":
            unavailable = msg.state;
            render();
            break;
        case "trace-error":
            traceError = msg.message;
            unavailable = undefined;
            render();
            break;
        case "source-result":
            // Ignore a stale reply superseded by a newer request.
            if (msg.requestId !== sourceRequestId) {
                break;
            }
            // A successful open/compare cleared the view; drop any stale note.
            // A failure surfaces the host's explanation.
            if (msg.status === "opened") {
                sourceNote = undefined;
            } else if (msg.message !== undefined) {
                sourceNote = msg.message;
            }
            render();
            break;
    }
});

vscode.postMessage({ type: "ready" });

// --- Rendering ------------------------------------------------------------

function render(): void {
    clear(root);

    if (unavailable === "loading") {
        root.appendChild(centeredState("Loading trace…", "loading"));
        return;
    }
    if (traceError !== undefined) {
        root.appendChild(centeredState(traceError, "error"));
        return;
    }
    if (unavailable === "evicted") {
        root.appendChild(
            centeredState(
                "This run's traces have been rotated out of the store. Re-run the report to capture them again.",
                "evicted",
            ),
        );
        return;
    }
    if (unavailable === "missing") {
        root.appendChild(
            centeredState("No trace was captured for this row.", "missing"),
        );
        return;
    }

    if (!recorded) {
        root.appendChild(centeredState("No trace to show.", "missing"));
        return;
    }

    let vm: TraceDivergenceViewModel;
    try {
        vm = toTraceDivergenceViewModel(recorded);
    } catch {
        root.appendChild(
            centeredState(
                "The captured trace is malformed and can't be interpreted.",
                "error",
            ),
        );
        return;
    }

    root.appendChild(header(vm));
    if (sourceNote !== undefined) {
        root.appendChild(noteBanner(sourceNote));
    }
    const sub = subtitle(vm);
    if (sub !== undefined) {
        root.appendChild(sub);
    }
    root.appendChild(pipeline(vm));
}

/** Utterance on the left, the divergence verdict on the right. The A/B version
 *  provenance is deliberately not repeated here — it lives in the Impact Report
 *  toolbar this panel is opened from. */
function header(vm: TraceDivergenceViewModel): HTMLElement {
    const head = el("div", "trace-header");
    const top = el("div", "header-top");
    const utter = el("div", "utterance");
    utter.textContent = vm.utterance;
    utter.title = vm.utterance;
    top.appendChild(utter);
    top.appendChild(verdictBadge(vm));
    head.appendChild(top);
    return head;
}

const LOW_CONFIDENCE_NOTE =
    "Low confidence: the captured trace can't pin the difference to a single layer.";

/** The headline badge on the top row: whether the two versions ended at the same
 *  action and — when they diverged — the stage the split is attributed to. */
function verdictBadge(vm: TraceDivergenceViewModel): HTMLElement {
    const { conclusion } = vm;
    const badge = el("span", "verdict");
    if (conclusion.parity === "match") {
        badge.classList.add(
            conclusion.bothNoAction ? "is-neutral" : "is-match",
        );
        badge.textContent = conclusion.bothNoAction
            ? "No action"
            : "Same result";
    } else {
        badge.classList.add("is-differ");
        badge.textContent =
            vm.divergingLayer !== undefined
                ? `Diverged · ${TRACE_LAYER_NAME[vm.divergingLayer]}`
                : "Diverged";
    }
    if (conclusion.confidence === "low") {
        badge.classList.add("is-low-confidence");
        badge.title = LOW_CONFIDENCE_NOTE;
    }
    return badge;
}

/** An optional line under the header, shown only when it adds something the
 *  verdict badge and the cause stage don't already say: the "same action" reading
 *  when the versions agree, a fidelity-path caveat, a low-confidence note, or —
 *  when no single stage could be blamed — the cause sentence itself (there's no
 *  cause card to carry it). For a normal single-stage divergence this returns
 *  nothing, so the pipeline speaks for itself. */
function subtitle(vm: TraceDivergenceViewModel): HTMLElement | undefined {
    const { conclusion } = vm;
    const notes: string[] = [];
    if (conclusion.parity === "match") {
        notes.push(conclusion.headline);
    } else if (
        vm.divergingLayer === undefined &&
        conclusion.cause !== undefined
    ) {
        notes.push(conclusion.cause.detail);
    }
    if (conclusion.pathNote !== undefined) {
        notes.push(conclusion.pathNote);
    }
    if (conclusion.confidenceNote !== undefined) {
        notes.push(conclusion.confidenceNote);
    } else if (conclusion.confidence === "low") {
        notes.push(LOW_CONFIDENCE_NOTE);
    }
    if (notes.length === 0) {
        return undefined;
    }
    const line = el("div", "subtitle");
    if (conclusion.confidence === "low") {
        line.classList.add("is-low-confidence");
    }
    notes.forEach((noteText, i) => {
        const span = el("span", i === 0 ? "subtitle-text" : "subtitle-note");
        span.textContent = noteText;
        line.appendChild(span);
    });
    return line;
}

// --- Pipeline -------------------------------------------------------------

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

/** The resolution pipeline: the pre-action stages (cache → grammar → wildcard)
 *  as a top-to-bottom flow, each compact unless it's the divergence (which
 *  expands side-by-side), capped by the terminal Result so the produced action
 *  is always shown for both versions. */
function pipeline(vm: TraceDivergenceViewModel): HTMLElement {
    const wrap = el("div", "pipeline");
    for (const stage of vm.stages) {
        if (stage.kind === "action") {
            continue;
        }
        wrap.appendChild(stageRow(vm, stage));
    }
    wrap.appendChild(resultBlock(vm));
    return wrap;
}

/** One pipeline stage: a header (name + status) then its body — a compact
 *  one-liner when the two sides agree, or an expanded side-by-side card when
 *  this is the divergence. */
function stageRow(
    vm: TraceDivergenceViewModel,
    stage: TraceStageView,
): HTMLElement {
    const row = el("div", "stage");
    row.classList.add(`status-${stage.status}`);
    if (stage.isCause) {
        row.classList.add("is-cause");
    }
    row.appendChild(stageHead(stage.layerName, stageStatusChip(stage)));
    row.appendChild(stage.isCause ? causeBody(vm, stage) : compactBody(stage));
    return row;
}

/** The text, tone, and hover for a stage's status chip. */
interface StatusChip {
    label: string;
    tone?: OutcomeTone;
    help: string;
}

/** The status chip for a pre-action stage. A grammar divergence that gained or
 *  lost a rule match in B is stated directionally — "new in B" (green) for a
 *  match B introduced, "lost in B" (orange) for one it dropped — the same
 *  vocabulary and tone the Result chip uses; every other status keeps its plain
 *  convergence label. */
function stageStatusChip(stage: TraceStageView): StatusChip {
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

function stageHead(name: string, chip: StatusChip): HTMLElement {
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
function statusChip(chip: StatusChip): HTMLElement {
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
function compactBody(stage: TraceStageView): HTMLElement {
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
type OutcomeTone = "positive" | "negative" | "neutral" | "muted";

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
function outcomeSpan(
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
function labeledArtifact(
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

// --- Diverging (expanded) stage & terminal Result -------------------------

/** The expanded body for the stage the divergence is attributed to: the two
 *  sides side-by-side, then — for a file-backed cause — the ⇄ diff chip of the
 *  grammar or schema file the split traces to. */
function causeBody(
    vm: TraceDivergenceViewModel,
    stage: TraceStageView,
): HTMLElement {
    const body = el("div", "stage-body");
    body.appendChild(sideBySide(stage.a, stage.b, stage.kind));
    const bar = causeBar(vm, stage);
    if (bar !== undefined) {
        body.appendChild(bar);
    }
    return body;
}

/** The A and B nodes for one stage laid out side-by-side. */
function sideBySide(
    a: TraceNodeSummary | undefined,
    b: TraceNodeSummary | undefined,
    kind: TraceStageView["kind"],
): HTMLElement {
    const sides = el("div", "stage-sides");
    sides.appendChild(sideColumn("a", a, kind));
    sides.appendChild(sideColumn("b", b, kind));
    return sides;
}

/** One version's column within an expanded stage, in the shared anatomy every
 *  side card uses: the A/B badge, one tone-colored outcome phrase, and — when the
 *  side produced one — the labeled read-only value (matched rule, produced
 *  action, or construction id) that names what it settled on. A side that didn't
 *  run the stage reads as a muted "did not run this stage". */
function sideColumn(
    side: TraceSide,
    node: TraceNodeSummary | undefined,
    kind: TraceStageView["kind"],
): HTMLElement {
    const col = el("div", "side-col");
    col.classList.add(side === "a" ? "side-a" : "side-b");

    const head = el("div", "side-col-head");
    const tag = el("span", "side-tag");
    tag.textContent = side.toUpperCase();
    head.appendChild(tag);
    col.appendChild(head);

    if (node === undefined) {
        const none = el("div", "side-empty");
        none.textContent = "did not run this stage";
        col.appendChild(none);
        return col;
    }

    col.appendChild(outcomeSpan(kind, node));
    const artifact = labeledArtifact(kind, side, node);
    if (artifact !== undefined) {
        col.appendChild(artifact);
    }
    return col;
}

/** The single visual attribution under a diverging stage: a short accented label
 *  naming it as the likely (or, at low confidence, possible) cause, then a ⇄ diff
 *  chip for the grammar/schema file the split traces to, opening its A↔B diff.
 *  Rendered only for a file-backed cause with a diffable path recorded — cache
 *  and wildcard divergences (no file changed) and older captures without a path
 *  show none, since the accented side cards and the output diff carry those. */
function causeBar(
    vm: TraceDivergenceViewModel,
    stage: TraceStageView,
): HTMLElement | undefined {
    if (stage.compare === undefined) {
        return undefined;
    }
    const fileName = vm.conclusion.cause?.fileName;
    const noun = stage.compare === "grammar-match" ? "grammar" : "schema";
    const bar = el("div", "cause-bar");
    const label = el("span", "cause-label");
    label.textContent =
        vm.conclusion.confidence === "low" ? "Possible cause" : "Likely cause";
    bar.appendChild(label);
    bar.appendChild(compareLink(fileName ?? noun, stage.compare));
    return bar;
}

/** The two produced actions as a unified JSON diff (the Impact Report's action
 *  diff, reused): the ground-truth "what differs in the output". Only rendered
 *  when the actions actually differ. */
function actionDiffBlock(diff: ActionDiff): HTMLElement {
    const wrap = el("div", "output-diff");
    const label = el("span", "output-diff-label");
    label.textContent = "Output difference";
    wrap.appendChild(label);
    const pre = el("pre", "action-diff");
    for (const line of diff.lines) {
        const span = document.createElement("span");
        span.className = `diff-line diff-${line.kind}`;
        const sign =
            line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        span.textContent = `${sign} ${line.text}\n`;
        pre.appendChild(span);
    }
    wrap.appendChild(pre);
    return wrap;
}

/** The ⇄ compare affordance: an inline link (not a chrome button) that asks the
 *  host to open the two versions of the backing file side-by-side. */
function compareLink(label: string, node: TraceSourceNode): HTMLButtonElement {
    const link = el("button", "compare-link") as HTMLButtonElement;
    link.type = "button";
    const glyph = el("span", "compare-glyph");
    glyph.textContent = "⇄";
    link.appendChild(glyph);
    const text = el("span", "compare-label");
    text.textContent = label;
    link.appendChild(text);
    link.addEventListener("click", () => requestCompare(node));
    return link;
}

/** The terminal Result: the two versions' produced actions side-by-side plus,
 *  whenever they differ, the unified JSON diff of the output — the ground-truth
 *  "what came out". Its status reads from the actions themselves (same / differs
 *  / a new or lost match), not from whether both sides merely ran, so a real
 *  output divergence never mislabels as "same". When the action payload is the
 * attributed cause, this block is the accented cause and carries the schema diff
 * chip. */
function resultBlock(vm: TraceDivergenceViewModel): HTMLElement {
    const stage = vm.stages.find((s) => s.kind === "action");
    const diff = vm.resultDiff;
    const block = el("div", "stage is-result");
    block.classList.add(diff.identical ? "status-agree" : "status-diverge");
    if (stage?.isCause === true) {
        block.classList.add("is-cause");
    }

    const head = el("div", "stage-head");
    head.appendChild(el("span", "stage-marker"));
    const name = el("span", "stage-name");
    name.textContent = "Result";
    head.appendChild(name);
    head.appendChild(
        statusChip({
            label: resultStatusLabel(diff),
            tone: resultStatusTone(diff),
            help: resultStatusHelp(diff),
        }),
    );
    block.appendChild(head);

    const body = el("div", "stage-body");
    body.appendChild(sideBySide(stage?.a, stage?.b, "action"));
    if (!diff.identical) {
        body.appendChild(actionDiffBlock(diff));
    }
    if (stage?.isCause === true) {
        const bar = causeBar(vm, stage);
        if (bar !== undefined) {
            body.appendChild(bar);
        }
    }
    block.appendChild(body);
    return block;
}

/** The Result status chip text, from the action comparison: identical actions,
 *  a new match (only B produced one), a lost match (only A), or a plain diff. */
function resultStatusLabel(diff: ActionDiff): string {
    if (diff.identical) {
        return "same";
    }
    if (diff.onlyB) {
        return "new in B";
    }
    if (diff.onlyA) {
        return "lost in B";
    }
    return "differs";
}

/** The Result chip tone: green when B introduced an action A lacked, orange when
 *  B lost one A had; a plain differing or identical result stays untinted. */
function resultStatusTone(diff: ActionDiff): OutcomeTone | undefined {
    if (diff.onlyB) {
        return "positive";
    }
    if (diff.onlyA) {
        return "negative";
    }
    return undefined;
}

function resultStatusHelp(diff: ActionDiff): string {
    if (diff.identical) {
        return "Both versions produced the same action.";
    }
    if (diff.onlyB) {
        return "Only B produced an action — a new match B introduced.";
    }
    if (diff.onlyA) {
        return "Only A produced an action — a match B lost.";
    }
    return "The two versions produced different actions.";
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

// --- State screens & bits -------------------------------------------------

function centeredState(message: string, kind: string): HTMLElement {
    const box = el("div", "state-screen");
    box.classList.add(`state-${kind}`);
    const inner = el("div", "state-inner");
    if (kind === "loading") {
        inner.appendChild(el("div", "spinner"));
    }
    const text = el("div", "state-text");
    text.textContent = message;
    inner.appendChild(text);
    box.appendChild(inner);
    return box;
}

function noteBanner(message: string): HTMLElement {
    const banner = el("div", "note-banner");
    banner.textContent = message;
    return banner;
}

// --- DOM helpers ----------------------------------------------------------

function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function clear(node: HTMLElement): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function capitalize(value: string): string {
    return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
