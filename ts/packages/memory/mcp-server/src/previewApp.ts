// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { App, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { config } from "zod/v4/core";
import type { UnderstandingModuleResult } from "@typeagent/memory-service";
import { previewMetaKey, type MemoryPreview } from "./previewTypes.js";

config({ jitless: true });
const app = new App(
    { name: "TypeAgent memory preview", version: "1.0.0" },
    {},
    { autoResize: true },
);
const root = document.getElementById("preview")!;
const status = document.getElementById("status")!;
let preview: MemoryPreview | undefined;
let revision = 0;
const slots = new Map<string, HTMLElement>();
function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
}
function report(error: unknown) {
    status.textContent = error instanceof Error ? error.message : String(error);
}
function renderModule(value: UnderstandingModuleResult, slot: HTMLElement) {
    slot.replaceChildren(node("h3", value.kind));
    if (value.status === "unavailable") {
        slot.append(node("p", value.reason));
        return;
    }
    if (value.kind === "timeline") {
        slot.append(
            node("small", "Source sessions are context, not project events."),
        );
        const list = node("ol");
        for (const date of value.timeline?.slice(0, 6) ?? [])
            list.append(
                node(
                    "li",
                    `${
                        date.precision === "year"
                            ? date.date.slice(0, 4)
                            : date.precision === "month"
                              ? date.date.slice(0, 7)
                              : date.date
                    } · ${date.kind} · ${date.label} [${date.evidenceId}]`,
                ),
            );
        slot.append(list);
    } else if (value.kind === "relationships") {
        const graph = value.graph;
        const nodes = graph?.nodes.slice(0, 8) ?? [];
        const list = node("ul");
        const edges =
            graph?.edges
                .filter(
                    (edge) =>
                        nodes.some((node) => node.id === edge.source) &&
                        nodes.some((node) => node.id === edge.target),
                )
                .slice(0, 10) ?? [];
        for (const edge of edges)
            list.append(
                node(
                    "li",
                    `${nodes.find((node) => node.id === edge.source)?.label} → ${edge.label ?? edge.type} → ${nodes.find((node) => node.id === edge.target)?.label}`,
                ),
            );
        slot.append(
            node("small", "Recorded associations, not verified completion."),
            list,
        );
    } else if (value.kind === "concepts") {
        for (const concept of value.concepts ?? [])
            slot.append(
                node("p", concept.label),
                node("small", "Existing entity context with original support."),
            );
    } else {
        for (const citation of value.citations) {
            const card = node("section");
            if (citation.kind === "source")
                card.append(
                    node("h3", citation.source.title),
                    node(
                        "small",
                        `Exact revision ${citation.source.revisionId} · ${citation.source.locator ?? "document-level context; no exact span supplied"}`,
                    ),
                    node("pre", citation.source.snippet),
                );
            else
                card.append(
                    node(
                        "p",
                        `${citation.kind} · ${citation.reference.viewId} @ ${citation.reference.revisionId}`,
                    ),
                );
            slot.append(card);
        }
    }
    if (value.status === "partial")
        slot.append(
            node("small", "Bounded module preview; more evidence may exist."),
        );
}
async function expand(
    kind: "sources" | "timeline" | "relationships" | "concepts",
    slot: HTMLElement,
) {
    if (!preview) return;
    const version = revision;
    const handle = preview;
    slot.replaceChildren(node("p", `Loading ${kind}…`));
    try {
        const result = await app.callServerTool({
            name: "memory_preview_expand",
            arguments: {
                corpusId: handle.corpusId,
                snapshotId: handle.snapshotId,
                kind,
            },
        });
        if (version !== revision) return;
        if (result.isError)
            throw new Error(
                result.content
                    .flatMap((item) =>
                        item.type === "text" ? [item.text] : [],
                    )
                    .join("\n"),
            );
        const model = result._meta?.[previewMetaKey] as
            | { module?: UnderstandingModuleResult }
            | undefined;
        if (!model?.module)
            throw new Error(
                "Host did not deliver the expanded memory UI payload",
            );
        renderModule(model.module, slot);
    } catch (error) {
        if (version !== revision) return;
        slot.replaceChildren(
            node("p", error instanceof Error ? error.message : String(error)),
        );
    }
}
function render(value: MemoryPreview) {
    preview = value;
    revision++;
    slots.clear();
    root.replaceChildren(node("h2", value.title), node("small", value.status));
    if (value.summary)
        root.append(
            node(
                "p",
                `${value.summary.text} [${value.summary.evidenceIds.join(", ")}]`,
            ),
        );
    for (const section of value.sections) {
        root.append(node("h3", section.title));
        for (const claim of section.claims)
            root.append(
                node("p", `${claim.text} [${claim.evidenceIds.join(", ")}]`),
            );
    }
    if (value.omittedSections)
        root.append(
            node(
                "small",
                `${value.omittedSections} sections omitted from this compact preview.`,
            ),
        );
    for (const unknown of value.unknowns)
        root.append(node("p", `Unknown: ${unknown}`));
    for (const warning of value.warnings)
        root.append(node("p", `Warning: ${warning}`));
    const sources = node("ul");
    for (const source of value.sources)
        sources.append(node("li", `[${source.id}] ${source.title}`));
    root.append(
        sources,
        node(
            "small",
            `${value.sources.length} of ${value.sourceCount} retained references`,
        ),
    );
    for (const module of value.modules) {
        if (module.kind === "explanation") continue;
        const slot = node("section");
        slots.set(module.kind, slot);
        const kind = module.kind;
        const control = node("button", `Show ${kind}`);
        control.type = "button";
        control.addEventListener("click", () => {
            void expand(kind, slot);
        });
        root.append(control, slot);
        if (module.status === "unavailable") {
            control.disabled = true;
            slot.append(node("p", module.reason));
        }
    }
    status.textContent =
        "Memory preview ready. Ask follow-on questions in the host chat.";
}
app.ontoolresult = (params) => {
    const value = params._meta?.[previewMetaKey] as MemoryPreview | undefined;
    if (value?.schemaVersion === 1 && typeof value.snapshotId === "string")
        render(value);
    else
        report(
            new Error(
                "No compatible memory UI model; use the tool's text answer.",
            ),
        );
};
app.onhostcontextchanged = (context) => {
    if (context.styles?.variables)
        applyHostStyleVariables(context.styles.variables);
};
app.connect()
    .then(() => {
        const context = app.getHostContext();
        if (context?.styles?.variables)
            applyHostStyleVariables(context.styles.variables);
    })
    .catch(report);
