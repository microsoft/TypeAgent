// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer webview client entry. Owns the trace state and the host
 * message loop, and repaints the panel: one row's resolution shown as a top-to-
 * bottom **pipeline** a developer reads to answer "where did version A and
 * version B diverge on this utterance, and what changed there?" The stages run
 * in resolution order (construction cache → grammar match → wildcard validation
 * → Result). Stages the two versions agree on are compact one-liners; the stage
 * where they diverged expands into a side-by-side A vs B card accented as the
 * cause, and carries its own dig-in — including a native A↔B diff of the grammar
 * or schema file behind the divergence, driven from that stage rather than a
 * disconnected top button.
 *
 * The rendering is split into logical modules by pipeline part — the header, the
 * shared stage building blocks, the pipeline layout, the diverging/Result cards,
 * and the placeholder screens — all derived from the shared, browser-neutral
 * {@link toTraceDivergenceViewModel}. This file only orchestrates them. No inline
 * styles (the CSP forbids them) — every visual is a CSS class.
 */

import type { ReplayResolutionTrace } from "@typeagent/core/replay";
import { toTraceDivergenceViewModel } from "../traceDivergenceViewModel.js";
import type {
    HostToTraceMessage,
    TraceUnavailableState,
} from "../traceProtocol.js";
import { clear } from "./traceViewerDom.js";
import {
    applySourceResult,
    clearSourceNote,
    getSourceNote,
    postReady,
    setRerender,
} from "./traceViewerBridge.js";
import { header, subtitle } from "./traceHeader.js";
import { centeredState, noteBanner } from "./traceStateScreens.js";
import { pipeline } from "./tracePipeline.js";

// The recorded trace is the single source of truth for what the row resolved.
let recorded: ReplayResolutionTrace | undefined;
let unavailable: TraceUnavailableState | undefined = "loading";
let traceError: string | undefined;

const root = document.getElementById("root") as HTMLElement;

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

    let vm;
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
    const note = getSourceNote();
    if (note !== undefined) {
        root.appendChild(noteBanner(note));
    }
    const sub = subtitle(vm);
    if (sub !== undefined) {
        root.appendChild(sub);
    }
    root.appendChild(pipeline(vm));
}

setRerender(render);

window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToTraceMessage;
    switch (msg.type) {
        case "trace":
            recorded = msg.recorded;
            unavailable = undefined;
            traceError = undefined;
            // Reset transient per-row state so a previous row's source-open
            // error doesn't bleed into the new row.
            clearSourceNote();
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
            applySourceResult(msg);
            render();
            break;
    }
});

postReady();
