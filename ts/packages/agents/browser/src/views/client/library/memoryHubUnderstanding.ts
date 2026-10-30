// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hubNotifications } from "./memoryHubNotifications";
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
import { renderMarkdownInto } from "./utils/markdownView";
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
            "A focused explanation needs one document collection with no search filters or conversations. Keep Results for this scope; filters have not been removed.",
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

export function toSourceUnderstandingRequest(
    source: MemoryHubEvidence,
    question: string,
): UnderstandingRequest {
    if (
        source.kind !== "source" ||
        !source.revisionId ||
        source.corpusId === "fixedBrowserMemory"
    )
        throw new Error(
            "This evidence does not support an exact document explanation.",
        );
    return {
        corpusId: source.corpusId,
        question,
        source: { sourceId: source.objectId, revisionId: source.revisionId },
        retrievalPolicy: "sourcesOnly",
        selection: { mode: "only", modules: ["explanation", "sources"] },
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
    question.setAttribute("aria-label", "Ask or Explain");
    question.placeholder = "Ask or Explain";
    const submit = node("button", "Ask or Explain");
    submit.type = "submit";
    form.append(question, submit, button("Back to Results", options.onResults));
    const status = node("p");
    status.setAttribute("role", "status");
    const grid = node("div", undefined, "understanding-grid");
    const main = node("div", undefined, "understanding-reading");
    const prose = node("article", undefined, "understanding-prose");
    const modules = node("div", undefined, "understanding-modules");
    const follow = node("section", undefined, "understanding-follow");
    follow.append(
        node("h3", "Keep going, without starting over"),
        node(
            "p",
            "Keep this question in context. Each answer checks the evidence again.",
        ),
    );
    const followForm = node("form");
    const draft = node("textarea");
    draft.required = true;
    draft.maxLength = 2000;
    draft.setAttribute("aria-label", "Ask a follow-on question");
    const followSubmit = node("button", "Ask more");
    followSubmit.className = "primary";
    followSubmit.type = "submit";
    followForm.append(draft, followSubmit);
    const suggestions = node("div", undefined, "understanding-suggestions");
    follow.append(suggestions, followForm);
    follow.hidden = true;
    const rail = node("aside", undefined, "understanding-rail");
    rail.setAttribute("aria-label", "Sources and related context");
    main.append(prose, follow, modules);
    grid.append(main, rail);
    const documentScope = node("p", undefined, "understanding-document-scope");
    documentScope.hidden = true;
    root.append(form, documentScope, status, grid);
    host.append(root);
    let result: UnderstandingResult | undefined;
    let input: UnderstandingRequest | undefined;
    let operationScope: string | undefined;
    let operationCorpus: string | undefined;
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
        return (
            !disposed &&
            token === version &&
            scope === operationCorpus &&
            operationScope === options.scope()
        );
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
        const paragraph = node(
            "div",
            undefined,
            "understanding-claim markdown-preview md-snippet",
        );
        renderMarkdownInto(paragraph, value.text);
        const citations = node("span", undefined, "understanding-citations");
        for (const id of value.evidenceIds) citations.append(" ", cite(id));
        paragraph.append(citations);
        return paragraph;
    }
    function sourceRail() {
        const scope = node(
            "section",
            undefined,
            "understanding-card understanding-scope",
        );
        const count =
            result?.citations.filter((item) => item.kind === "source").length ??
            0;
        scope.append(
            node("small", "Source scope", "understanding-eyebrow"),
            node("h3", "One selected collection"),
            node(
                "p",
                `${count} returned source passage${count === 1 ? "" : "s"}`,
            ),
            node(
                "p",
                "Retained evidence, not a live audit. Missing evidence is not proof of absence.",
            ),
        );
        const sources = node(
            "section",
            undefined,
            "understanding-card understanding-sources",
        );
        sources.append(
            node("h3", "Sources"),
            node("p", "Inspect the originals behind this explanation."),
        );
        rail.replaceChildren(scope, sources);
        for (const citation of result?.citations ?? []) {
            const card = node("section", undefined, "understanding-source");
            const title =
                citation.kind === "source"
                    ? citation.source.title
                    : citation.kind === "userAssertion"
                      ? "User assertion"
                      : "Maintained interpretation";
            const open = button(title, () => openCitation(citation, open));
            open.className = "understanding-source-title";
            const details = node("details");
            details.append(node("summary", "Matched passage and provenance"));
            card.append(
                node(
                    "small",
                    `${citation.id} · ${citation.kind === "source" ? "Original source" : "Maintained knowledge"}`,
                    "understanding-eyebrow",
                ),
                open,
                details,
            );
            details.append(
                node(
                    "small",
                    citation.kind === "source"
                        ? `Exact retained revision · ${citation.source.revisionId}`
                        : `${citation.reference.state} · not independent corroboration`,
                ),
            );
            if (citation.kind === "source")
                details.append(node("p", citation.source.snippet));
            sources.append(card);
        }
        if (!result?.citations.length)
            sources.append(node("p", "No supporting sources returned."));
    }
    function render() {
        prose.replaceChildren();
        const answer = result?.answer;
        if (answer) {
            const labels = {
                answered: "Grounded explanation",
                partial: "Partial explanation",
                noAnswer: "No grounded answer",
                needsClarification: "Clarification needed",
            };
            const badge = node(
                "span",
                labels[answer.status],
                "understanding-badge",
            );
            badge.dataset.status = answer.status;
            prose.append(
                badge,
                node("h2", answer.title),
                claim(answer.summary),
            );
            for (const section of answer.sections) {
                prose.append(node("h3", section.title));
                for (const value of section.claims) prose.append(claim(value));
            }
            if (answer.unknowns.length) {
                const unknowns = node(
                    "section",
                    undefined,
                    "understanding-unknowns",
                );
                const list = node("ul");
                for (const text of answer.unknowns)
                    list.append(node("li", text));
                unknowns.append(node("h3", "Still unknown"), list);
                prose.append(unknowns);
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
        if (request.corpusId !== options.scope() && !request.source) {
            report(
                new Error(
                    "Collection changed. Start a new understanding in the selected collection.",
                ),
            );
            return;
        }
        controller.abort();
        hubNotifications.clear("understanding");
        moduleControllers.clear();
        moduleVersions.clear();
        moduleSlots.clear();
        controller = new AbortController();
        operationScope = options.scope();
        operationCorpus = request.corpusId;
        if (
            input?.source?.sourceId !== request.source?.sourceId ||
            input?.source?.revisionId !== request.source?.revisionId
        ) {
            result = undefined;
            render();
            follow.hidden = true;
        }
        input = request;
        documentScope.hidden = !request.source;
        documentScope.textContent = request.source
            ? "Explaining one document at its exact captured revision. Follow-up questions stay within this document."
            : "";
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
                    hubNotifications.set("understanding", {
                        title: "Ask or Explain",
                        page: "understanding",
                        context: response.question,
                        messages: response.warnings,
                    });
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
            corpusId: input?.source ? input.corpusId : (options.scope() ?? ""),
            question: question.value.trim(),
            ...(input?.source
                ? { source: input.source, selection: input.selection }
                : {}),
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
                    request.retrievalPolicy !== input?.retrievalPolicy ||
                    request.source?.sourceId !== input?.source?.sourceId ||
                    request.source?.revisionId !== input?.source?.revisionId)
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
            hubNotifications.clear("understanding");
            this.hide();
            moduleVersions.clear();
            moduleSlots.clear();
            moduleControllers.clear();
            result = undefined;
            input = undefined;
            documentScope.hidden = true;
            documentScope.textContent = "";
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
