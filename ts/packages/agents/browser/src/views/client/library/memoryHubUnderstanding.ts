// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UnderstandingCitation,
    UnderstandingClaim,
    UnderstandingModuleRequest,
    UnderstandingModuleResult,
    UnderstandingRequest,
    UnderstandingResult,
} from "@typeagent/memory-service";
import type {
    MemoryHubEvidence,
    MemoryHubSearchRequest,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView, streamUnderstanding } from "./viewClient";
import "./memoryHubUnderstanding.css";

export function toUnderstandingRequest(
    request: MemoryHubSearchRequest,
    evidenceSnapshotId?: string,
): UnderstandingRequest {
    if (
        !request.corpusId ||
        (request.conversationScope && request.conversationScope !== "none") ||
        request.sourceTypes?.length ||
        request.tags?.length ||
        request.viewKinds?.length ||
        request.dateFrom ||
        request.dateTo
    )
        throw new Error(
            "Understanding needs one document collection with no search filters or conversations. Keep Results for this scope; filters have not been removed.",
        );
    return {
        ...(evidenceSnapshotId ? { evidenceSnapshotId } : {}),
        corpusId: request.corpusId,
        question: request.query,
        ...(request.retrievalPolicy
            ? { retrievalPolicy: request.retrievalPolicy }
            : {}),
        ...(request.knowledgeCheckpointId
            ? { knowledgeCheckpointId: request.knowledgeCheckpointId }
            : {}),
    };
}

function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}
function button(text: string, handler: () => void): HTMLButtonElement {
    const element = node("button", text);
    element.type = "button";
    element.addEventListener("click", handler);
    return element;
}
function evidence(
    citation: UnderstandingCitation,
    corpusId: string,
): MemoryHubEvidence {
    if (citation.kind === "source") {
        const source = citation.source;
        return {
            ...source,
            id: citation.id,
            kind: "source",
            corpusName: corpusId,
            objectId: source.sourceId,
            rank: 1,
        };
    }
    return {
        id: citation.id,
        kind: "view",
        corpusId,
        corpusName: corpusId,
        objectId: citation.reference.viewId,
        revisionId: citation.reference.revisionId,
        title:
            citation.kind === "userAssertion"
                ? "User assertion"
                : "Maintained interpretation",
        snippet: "",
        score: 1,
        rank: 1,
    };
}

export function mountMemoryHubUnderstanding(
    host: HTMLElement,
    options: {
        scope(): string | undefined;
        onError(error: unknown): void;
        onQueryChanged(request: UnderstandingRequest): void;
        onResults(): void;
        onEvidence(
            value: MemoryHubEvidence,
            focus: HTMLElement,
            owner: HTMLElement,
        ): void;
        onGraph(nodeId: string): void;
    },
) {
    const root = node("section", undefined, "memory-understanding");
    const form = node("form", undefined, "understanding-question");
    const question = node("input");
    question.required = true;
    question.maxLength = 2000;
    question.setAttribute("aria-label", "Ask a new understanding question");
    const submit = node("button", "Explain");
    submit.type = "submit";
    form.append(question, submit, button("Back to Results", options.onResults));
    const status = node("p");
    status.setAttribute("role", "status");
    const grid = node("div", undefined, "understanding-grid");
    const main = node("div");
    const prose = node("article", undefined, "understanding-prose");
    const modules = node("div", undefined, "understanding-modules");
    const follow = node("section", undefined, "understanding-follow");
    follow.append(
        node("h3", "Keep going"),
        node("p", "Ask a follow-on grounded again in this collection."),
    );
    const followForm = node("form");
    const draft = node("textarea");
    draft.required = true;
    draft.maxLength = 2000;
    draft.setAttribute("aria-label", "Ask a follow-on question");
    const followSubmit = node("button", "Ask more");
    followSubmit.type = "submit";
    followForm.append(draft, followSubmit);
    const suggestions = node("div", undefined, "understanding-suggestions");
    follow.append(suggestions, followForm);
    follow.hidden = true;
    const rail = node("aside", undefined, "understanding-rail");
    rail.setAttribute("aria-label", "Sources and related context");
    main.append(prose, follow, modules);
    grid.append(main, rail);
    root.append(form, status, grid);
    host.append(root);
    let result: UnderstandingResult | undefined;
    let input: UnderstandingRequest | undefined;
    let version = 0;
    let controller = new AbortController();
    let busy = false;
    let disposed = false;
    const moduleVersions = new Map<HTMLElement, number>();
    const moduleControllers = new Map<HTMLElement, AbortController>();
    const moduleSlots = new Map<
        string,
        { key: string; slot: HTMLElement; body: HTMLElement }
    >();

    function report(error: unknown, target: HTMLElement = status) {
        target.textContent =
            error instanceof Error ? error.message : String(error);
        options.onError(error);
    }
    function valid(token: number, scope: string) {
        return !disposed && token === version && scope === options.scope();
    }
    function openCitation(citation: UnderstandingCitation, focus: HTMLElement) {
        if (result)
            options.onEvidence(
                evidence(citation, result.corpusId),
                focus,
                root,
            );
    }
    function cite(id: string): HTMLButtonElement {
        const citation = result?.citations.find((item) => item.id === id);
        const control = button(`[${id}]`, () => {
            if (!citation) {
                report(new Error("Exact citation is unavailable"));
                return;
            }
            openCitation(citation, control);
        });
        control.setAttribute("aria-label", `Open exact evidence ${id}`);
        return control;
    }
    function claim(value: UnderstandingClaim): HTMLElement {
        const paragraph = node("p", value.text);
        for (const id of value.evidenceIds) paragraph.append(" ", cite(id));
        return paragraph;
    }
    function sourceRail() {
        rail.replaceChildren(node("h3", "Sources"));
        for (const citation of result?.citations ?? []) {
            const card = node("section", undefined, "understanding-card");
            const title =
                citation.kind === "source"
                    ? citation.source.title
                    : citation.kind === "userAssertion"
                      ? "User assertion"
                      : "Maintained interpretation";
            const open = button(title, () => openCitation(citation, open));
            card.append(
                open,
                node(
                    "small",
                    citation.kind === "source"
                        ? `Exact retained revision · ${citation.source.revisionId}`
                        : `${citation.reference.state} · not independent corroboration`,
                ),
            );
            if (citation.kind === "source")
                card.append(node("p", citation.source.snippet));
            rail.append(card);
        }
        if (!result?.citations.length)
            rail.append(node("p", "No supporting sources returned."));
        const notes = result?.answer?.unknowns ?? [];
        if (notes.length) {
            const card = node("section", undefined, "understanding-card");
            card.append(node("h3", "Still unknown"));
            const list = node("ul");
            for (const text of notes) list.append(node("li", text));
            card.append(list);
            rail.append(card);
        }
    }
    function render() {
        prose.replaceChildren();
        const answer = result?.answer;
        if (answer) {
            prose.append(
                node("h2", answer.title),
                node("small", answer.status),
                claim(answer.summary),
            );
            for (const section of answer.sections) {
                prose.append(node("h3", section.title));
                for (const value of section.claims) prose.append(claim(value));
            }
        } else if (result?.previousAnswer) {
            prose.append(node("h2", "Previous grounded answer"));
            const previous = node("p", result.previousAnswer.text);
            for (const id of result.previousAnswer.evidenceIds)
                previous.append(" ", cite(id));
            prose.append(previous);
        } else if (busy && result) {
            prose.append(
                node("h2", "Preparing a grounded explanation"),
                node(
                    "p",
                    "Source cards are ready. Review them or draft a follow-on while the explanation is prepared.",
                ),
            );
        }
        sourceRail();
        suggestions.replaceChildren();
        for (const text of answer?.followUps ?? [])
            suggestions.append(
                button(text, () => {
                    draft.value = text;
                    draft.focus();
                }),
            );
        follow.hidden = !answer && !busy;
        renderModules();
    }

    function renderModules() {
        modules.replaceChildren();
        const wanted = new Set<string>();
        for (const module of result?.modules ?? []) {
            if (module.kind === "sources" || module.kind === "explanation")
                continue;
            wanted.add(module.kind);
            const key = JSON.stringify([
                result?.snapshotId,
                module.kind,
                module.status,
                module.reason,
            ]);
            const existing = moduleSlots.get(module.kind);
            if (existing?.key === key) {
                if (module.kind === "concepts") rail.append(existing.slot);
                else modules.append(existing.slot);
                continue;
            }
            if (existing) {
                moduleControllers.get(existing.body)?.abort();
                moduleControllers.delete(existing.body);
                moduleVersions.delete(existing.body);
            }
            const slot = node("section", undefined, "understanding-card");
            slot.setAttribute("aria-label", module.kind);
            slot.append(
                node(
                    "h3",
                    module.kind === "timeline"
                        ? "Evidence timeline"
                        : module.kind === "concepts"
                          ? "Related concepts"
                          : "Recorded relationships",
                ),
            );
            const body = node("div");
            moduleSlots.set(module.kind, { key, slot, body });
            const kind = module.kind;
            slot.append(
                body,
                button("Refresh module", () => {
                    void loadModule(kind, body);
                }),
            );
            if (module.kind === "concepts") rail.append(slot);
            else modules.append(slot);
            if (module.status === "unavailable")
                body.append(node("p", module.reason));
            else void loadModule(module.kind, body);
        }
        for (const [kind, slot] of moduleSlots)
            if (!wanted.has(kind)) {
                moduleControllers.get(slot.body)?.abort();
                moduleControllers.delete(slot.body);
                moduleVersions.delete(slot.body);
                moduleSlots.delete(kind);
            }
    }
    function renderTimeline(
        value: UnderstandingModuleResult,
        body: HTMLElement,
    ) {
        body.append(
            node(
                "p",
                "Session context is not a project event. Dates retain their reported precision.",
            ),
        );
        const list = node("ol", undefined, "understanding-timeline");
        for (const item of value.timeline ?? []) {
            const row = node("li");
            row.append(
                node(
                    "strong",
                    item.precision === "year"
                        ? item.date.slice(0, 4)
                        : item.precision === "month"
                          ? item.date.slice(0, 7)
                          : item.date,
                ),
                node("small", `${item.kind} · ${item.precision}`),
                node("p", item.label),
                cite(item.evidenceId),
            );
            list.append(row);
        }
        body.append(list);
    }
    function renderGraph(value: UnderstandingModuleResult, body: HTMLElement) {
        body.append(
            node(
                "p",
                "Recorded associations, not proof of completed work or ownership.",
            ),
        );
        const graph = value.graph;
        if (!graph) return;
        const list = node("ul", undefined, "understanding-relationships");
        for (const edge of graph.edges) {
            const source = graph.nodes.find((item) => item.id === edge.source);
            const target = graph.nodes.find((item) => item.id === edge.target);
            if (!source || !target) {
                report(new Error("Graph endpoint is missing"), body);
                continue;
            }
            const row = node(
                "li",
                `${source.label} → ${edge.label ?? edge.type} → ${target.label}`,
            );
            row.append(button("Explore", () => options.onGraph(target.id)));
            const support = value.support?.find(
                (item) => item.edgeId === edge.id,
            );
            for (const item of support?.items ?? []) {
                if (item.kind !== "document") continue;
                const citation: UnderstandingCitation = {
                    id: edge.id,
                    kind: "source",
                    source: {
                        evidenceId: edge.id,
                        corpusId: item.corpusId,
                        sourceId: item.sourceId,
                        revisionId: item.revisionId,
                        title: item.title ?? item.sourceId,
                        ...(item.locator ? { locator: item.locator } : {}),
                        snippet: "",
                        score: 1,
                        sourceType: "text",
                        indexedAt: "",
                    },
                };
                const open = button("Original support", () =>
                    openCitation(citation, open),
                );
                row.append(open);
            }
            list.append(row);
        }
        body.append(list);
    }
    async function loadModule(
        kind: UnderstandingModuleRequest["kind"],
        body: HTMLElement,
    ) {
        if (!result) return;
        const token = version;
        const moduleVersion = (moduleVersions.get(body) ?? 0) + 1;
        moduleVersions.set(body, moduleVersion);
        const snapshotId = result.snapshotId;
        const corpusId = result.corpusId;
        moduleControllers.get(body)?.abort();
        const moduleController = new AbortController();
        moduleControllers.set(body, moduleController);
        const parentSignal = controller.signal;
        const abort = () => moduleController.abort(parentSignal.reason);
        if (parentSignal.aborted) abort();
        else parentSignal.addEventListener("abort", abort, { once: true });
        const signal = moduleController.signal;
        body.replaceChildren(node("p", `Loading ${kind}…`));
        body.setAttribute("aria-busy", "true");
        const retry = button("Retry module", () => {
            void loadModule(kind, body);
        });
        try {
            const value = await invokeView(
                "memoryHubUnderstandingModule",
                { corpusId, snapshotId, kind, requestId: crypto.randomUUID() },
                { signal },
            );
            if (
                !valid(token, corpusId) ||
                result?.snapshotId !== snapshotId ||
                moduleVersion !== moduleVersions.get(body)
            )
                return;
            body.setAttribute("aria-busy", "false");
            body.replaceChildren();
            if (value.status === "unavailable")
                body.append(node("p", value.reason ?? "Module unavailable."));
            else if (kind === "timeline") renderTimeline(value, body);
            else if (kind === "concepts") {
                for (const concept of value.concepts ?? []) {
                    const card = node(
                        "section",
                        undefined,
                        "understanding-card",
                    );
                    card.append(
                        node("h4", concept.label),
                        node(
                            "small",
                            "Existing graph entity; not a new inferred fact.",
                        ),
                        button("Explore supporting graph", () =>
                            options.onGraph(concept.nodeId),
                        ),
                    );
                    body.append(card);
                }
            } else renderGraph(value, body);
            if (value.status === "partial")
                body.append(
                    node(
                        "small",
                        "Bounded preview; more relationships may exist.",
                    ),
                );
        } catch (error) {
            if (
                !valid(token, corpusId) ||
                signal.aborted ||
                moduleVersion !== moduleVersions.get(body)
            )
                return;
            body.setAttribute("aria-busy", "false");
            body.replaceChildren();
            report(error, body);
            body.append(retry);
        } finally {
            parentSignal.removeEventListener("abort", abort);
            if (moduleControllers.get(body) === moduleController)
                moduleControllers.delete(body);
        }
    }
    async function run(request: UnderstandingRequest, parent = false) {
        if (!request.corpusId) {
            report(
                new Error(
                    "Choose a single document collection. All memory remains available in Results.",
                ),
            );
            return;
        }
        if (request.corpusId !== options.scope()) {
            report(
                new Error(
                    "Collection changed. Start a new understanding in the selected collection.",
                ),
            );
            return;
        }
        controller.abort();
        moduleControllers.clear();
        moduleVersions.clear();
        moduleSlots.clear();
        controller = new AbortController();
        const token = ++version;
        busy = true;
        submit.disabled = followSubmit.disabled = true;
        status.textContent = "Reading supporting memory…";
        const submittedDraft = draft.value;
        try {
            const started = performance.now();
            await streamUnderstanding(
                request,
                (response) => {
                    if (!valid(token, request.corpusId)) return;
                    input = request;
                    result = response;
                    question.value = response.question;
                    const elapsed = (
                        (performance.now() - started) /
                        1000
                    ).toFixed(1);
                    status.textContent = response.provisional
                        ? `Provisional source matches ready in ${elapsed}s. Interpreting the question…`
                        : response.refinementFailed
                          ? `Initial explanation retained after ${elapsed}s; additional evidence reading is unavailable. Retry the question to try again.`
                          : response.answer
                            ? response.refinementPending
                                ? `Initial explanation ready in ${elapsed}s. Checking additional evidence…`
                                : `Grounded explanation ready in ${elapsed}s. Supporting visuals load independently.`
                            : `Sources ready in ${elapsed}s. Preparing the explanation…`;
                    if (response.warnings.length)
                        status.append(
                            node("small", response.warnings.join(" · ")),
                        );
                    render();
                },
                controller.signal,
            );
            if (valid(token, request.corpusId)) {
                if (parent && draft.value === submittedDraft) draft.value = "";
                options.onQueryChanged(request);
            }
        } catch (error) {
            if (valid(token, request.corpusId) && !controller.signal.aborted) {
                result = undefined;
                render();
                follow.hidden = true;
                report(error);
                status.append(
                    button("Retry question", () => {
                        const { evidenceSnapshotId: _prepared, ...retry } =
                            request;
                        void run(retry, parent);
                    }),
                );
            }
        } finally {
            if (token === version) {
                busy = false;
                submit.disabled = followSubmit.disabled = false;
            }
        }
    }
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void run({
            corpusId: options.scope() ?? "",
            question: question.value.trim(),
            ...(input?.retrievalPolicy
                ? { retrievalPolicy: input.retrievalPolicy }
                : {}),
            ...(input?.knowledgeCheckpointId
                ? { knowledgeCheckpointId: input.knowledgeCheckpointId }
                : {}),
        });
    });
    followForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!result || !input || busy) return;
        void run(
            {
                ...input,
                evidenceSnapshotId: undefined,
                question: draft.value.trim(),
                parentSnapshotId: result.snapshotId,
                parentTurnId: result.turnId,
            },
            true,
        );
    });
    return {
        async show(request?: UnderstandingRequest) {
            if (
                request &&
                (!result ||
                    request.question !== result.question ||
                    request.corpusId !== result.corpusId ||
                    (!!request.evidenceSnapshotId &&
                        request.evidenceSnapshotId !==
                            input?.evidenceSnapshotId) ||
                    request.knowledgeCheckpointId !==
                        input?.knowledgeCheckpointId ||
                    request.retrievalPolicy !== input?.retrievalPolicy)
            )
                await run(request);
        },
        hide() {
            controller.abort();
            version++;
            busy = false;
            submit.disabled = followSubmit.disabled = false;
            for (const body of moduleVersions.keys())
                if (body.getAttribute("aria-busy") === "true") {
                    body.setAttribute("aria-busy", "false");
                    body.replaceChildren(
                        node(
                            "p",
                            "Loading paused. Refresh this module to resume.",
                        ),
                    );
                }
        },
        scopeChanged() {
            this.hide();
            moduleVersions.clear();
            moduleSlots.clear();
            moduleControllers.clear();
            result = undefined;
            input = undefined;
            prose.replaceChildren();
            rail.replaceChildren();
            modules.replaceChildren();
            follow.hidden = true;
            draft.value = "";
            status.textContent =
                "Collection changed. Ask again in the selected collection.";
        },
        dispose() {
            disposed = true;
            this.scopeChanged();
            root.remove();
        },
    };
}
