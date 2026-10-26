// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEventAuthority,
    MemoryEventFilter,
} from "@typeagent/memory-service";
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
    const advanced = graphText("details");
    advanced.append(graphText("summary", "Event filters"));
    const conversation = field(advanced, "Conversation ID");
    const producer = field(advanced, "Event producer ID");
    const from = field(advanced, "Event time from", "datetime-local");
    const to = field(advanced, "Event time to", "datetime-local");
    const authority = graphText("select");
    authority.setAttribute("aria-label", "Event authority");
    authority.append(new Option("All authorities", ""));
    const authorities: MemoryEventAuthority[] = [
        "user-assertion",
        "evidence-only",
        "verified-observation",
        "explicit",
        "producer-reported",
    ];
    for (const value of authorities) authority.append(new Option(value, value));
    const authorityLabel = graphText("label", "Authority");
    authorityLabel.append(authority);
    advanced.append(authorityLabel);
    const apply = graphText("button", "Apply graph filters");
    apply.type = "submit";
    form.append(advanced, apply);
    host.append(form);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        onApply();
    });
    mode.addEventListener("change", onApply);
    return {
        mode,
        showMode(visible: boolean) {
            modeLabel.hidden = !visible;
        },
        request() {
            const eventFilter: MemoryEventFilter = {};
            if (conversation.value.trim())
                eventFilter.conversationIds = [conversation.value.trim()];
            if (producer.value.trim())
                eventFilter.producerIds = [producer.value.trim()];
            const selectedAuthority = authorities.find(
                (value) => value === authority.value,
            );
            if (selectedAuthority)
                eventFilter.authorities = [selectedAuthority];
            if (from.value)
                eventFilter.eventFrom = new Date(from.value).toISOString();
            if (to.value)
                eventFilter.eventTo = new Date(to.value).toISOString();
            const query = search.value.trim();
            return {
                ...(query ? { search: query } : {}),
                eventFilter,
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
