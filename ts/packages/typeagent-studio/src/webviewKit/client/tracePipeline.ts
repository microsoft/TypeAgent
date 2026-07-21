// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The resolution pipeline layout: the pre-action stages (construction cache →
 * grammar match → wildcard validation) as a top-to-bottom flow, each a compact
 * one-liner unless it's the divergence (which expands into the side-by-side
 * cause card), capped by the terminal Result so the produced action is always
 * shown for both versions.
 */

import type {
    TraceDivergenceViewModel,
    TraceStageView,
} from "../traceDivergenceViewModel.js";
import { el } from "./traceViewerDom.js";
import { compactBody, stageHead, stageStatusChip } from "./traceStageParts.js";
import { causeBody, resultBlock } from "./traceCause.js";

/** The resolution pipeline: the pre-action stages (cache → grammar → wildcard)
 *  as a top-to-bottom flow, each compact unless it's the divergence (which
 *  expands side-by-side), capped by the terminal Result so the produced action
 *  is always shown for both versions. */
export function pipeline(vm: TraceDivergenceViewModel): HTMLElement {
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
