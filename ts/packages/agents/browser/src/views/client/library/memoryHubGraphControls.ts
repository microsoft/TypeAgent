// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { graphText } from "./memoryHubGraphDetails";

function field(form: HTMLElement, label: string, type = "text") {
    const input = graphText("input");
    input.type = type;
    input.setAttribute("aria-label", label);
    const wrapper = graphText("label", label);
    wrapper.append(input);
    form.append(wrapper);
    return input;
}

export function mountGraphControls(host: HTMLElement, onApply: () => void) {
    const form = graphText("form", undefined, "hub-graph-controls");
    const search = field(form, "Find graph nodes", "search");
    const mode = graphText("select");
    mode.setAttribute("aria-label", "Topic graph meaning");
    mode.append(
        new Option("Maintained hierarchy", "hierarchy"),
        new Option("Source co-occurrence", "topics"),
    );
    const modeLabel = graphText("label", "Topic graph");
    modeLabel.append(mode);
    const evidence = graphText("select");
    evidence.setAttribute("aria-label", "Graph evidence kinds");
    evidence.append(
        new Option("Documents and events", "all"),
        new Option("Documents", "document"),
        new Option("Events", "event"),
    );
    const evidenceLabel = graphText("label", "Evidence");
    evidenceLabel.append(evidence);
    form.append(modeLabel, evidenceLabel);
    host.append(form);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        onApply();
    });
    mode.addEventListener("change", onApply);
    evidence.addEventListener("change", onApply);
    return {
        mode,
        showMode(visible: boolean) {
            modeLabel.hidden = !visible;
        },
        request() {
            const query = search.value.trim();
            return {
                ...(query ? { search: query } : {}),
                evidenceKinds:
                    evidence.value === "document"
                        ? (["document"] as const)
                        : evidence.value === "event"
                          ? (["event"] as const)
                          : (["document", "event"] as const),
            };
        },
    };
}
