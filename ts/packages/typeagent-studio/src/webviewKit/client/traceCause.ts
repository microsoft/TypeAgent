// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The expanded stage where the two versions diverged and the terminal Result.
 * The diverging stage lays A and B side-by-side, accented as the cause, and —
 * for a file-backed cause — carries a ⇄ diff chip of the grammar or schema file
 * the split traces to. The Result always renders both produced actions and,
 * whenever they differ, the ground-truth JSON diff of the output; its status
 * reads from the actions themselves, not from whether both sides merely ran.
 */

import type {
    TraceDivergenceViewModel,
    TraceNodeSummary,
    TraceStageView,
} from "../traceDivergenceViewModel.js";
import type { ActionDiff } from "../replayViewModel.js";
import type { TraceSide, TraceSourceNode } from "../traceProtocol.js";
import { el } from "./traceViewerDom.js";
import { requestCompare } from "./traceViewerBridge.js";
import {
    compactBody,
    labeledArtifact,
    outcomeSpan,
    statusChip,
    type OutcomeTone,
} from "./traceStageParts.js";

/** The expanded body for the stage the divergence is attributed to: the two
 *  sides side-by-side, then — for a file-backed cause — the ⇄ diff chip of the
 *  grammar or schema file the split traces to. */
export function causeBody(
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
export function resultBlock(vm: TraceDivergenceViewModel): HTMLElement {
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

    // An unchanged result collapses to the same compact one-liner the agreeing
    // pre-action stages use, so a converged Result reads consistently with them
    // rather than expanding a redundant A/B split of one identical action. A
    // changed result keeps the side-by-side, its output diff, and — when the
    // action payload is the cause — the schema diff chip.
    if (diff.identical && stage !== undefined) {
        block.appendChild(compactBody(stage));
        return block;
    }
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
