// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer header: the utterance, the divergence verdict badge, and the
 * optional subtitle line. This is the chrome above the resolution pipeline —
 * what the row was and, at a glance, whether the two versions agreed.
 */

import {
    TRACE_LAYER_NAME,
    type TraceDivergenceViewModel,
} from "../traceDivergenceViewModel.js";
import { el } from "./traceViewerDom.js";

export const LOW_CONFIDENCE_NOTE =
    "Low confidence: the captured trace can't pin the difference to a single layer.";

/** Utterance on the left, the divergence verdict on the right. The A/B version
 *  provenance is deliberately not repeated here — it lives in the Impact Report
 *  toolbar this panel is opened from. */
export function header(vm: TraceDivergenceViewModel): HTMLElement {
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
export function subtitle(
    vm: TraceDivergenceViewModel,
): HTMLElement | undefined {
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
