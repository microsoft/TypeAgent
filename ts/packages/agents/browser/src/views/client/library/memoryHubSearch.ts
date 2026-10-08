// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubEvidence,
    MemoryHubEvidenceContent,
    MemoryHubEvidenceRequest,
    MemoryHubSearchRequest,
    MemoryHubSearchResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import {
    getMemoryHubViewPreferences,
    subscribeMemoryHubViewPreferences,
    type MemoryHubViewMode,
    type MemoryHubViewPreferences,
} from "./memoryHubViewPreferences";
import {
    isMemoryHubWebEvidence,
    readMemoryHubSearchInsights,
    renderMemoryHubWebGroups,
} from "./memoryHubSearchViews";
import "./memoryHubPhase2.css";
import {
    icon,
    iconButton,
    setIconButton,
    watchSlowRequest,
} from "./memoryHubUi";
import { renderMarkdownInto } from "./utils/markdownView";

export type MemoryHubSearchOptions = {
    scope: () => string | undefined;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onOpenProcedure: (corpusId: string, procedureId: string) => void;
    onError: (error: unknown) => void;
    onQueryChanged?: (query: string) => void;
    onNotify?: (message: string) => void;
};
const RECENT_KEY = "memoryHub.recentQueries";

function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
}
function action(text: string, handler: () => void) {
    const value = node("button", text);
    value.type = "button";
    value.addEventListener("click", handler);
    return value;
}
function recentQueries(): string[] {
    try {
        const values: unknown = JSON.parse(
            localStorage.getItem(RECENT_KEY) ?? "[]",
        );
        if (
            !Array.isArray(values) ||
            values.some((value) => typeof value !== "string")
        ) {
            console.warn("Ignoring malformed recent memory search queries.");
            return [];
        }
        return values.slice(0, 8);
    } catch (error) {
        console.warn("Could not read recent memory search queries.", error);
        return [];
    }
}
function exactRequest(evidence: MemoryHubEvidence): MemoryHubEvidenceRequest {
    if (
        (evidence.kind === "source" || evidence.kind === "view") &&
        !evidence.revisionId
    )
        throw new Error(
            "Exact source revision is unavailable; latest content is not substituted.",
        );
    if (
        evidence.kind === "procedure" &&
        evidence.procedureVersion === undefined
    )
        throw new Error(
            "Exact procedure version is unavailable; latest content is not substituted.",
        );
    return {
        corpusId: evidence.corpusId,
        kind: evidence.kind,
        objectId: evidence.objectId,
        ...(evidence.revisionId ? { revisionId: evidence.revisionId } : {}),
        ...(evidence.procedureVersion !== undefined
            ? { procedureVersion: evidence.procedureVersion }
            : {}),
    };
}
function provenanceText(evidence: MemoryHubEvidence): string {
    const identity =
        evidence.kind === "view"
            ? `${evidence.viewKind} v${evidence.viewVersion} @ ${evidence.revisionId} · ${evidence.viewProvenance} · ${evidence.review} · ${evidence.freshness} · derived, not independent corroboration`
            : evidence.kind === "procedure"
              ? `Procedure version ${evidence.procedureVersion ?? "unavailable"}`
              : evidence.kind === "source"
                ? "Captured source revision"
                : "Conversation event";
    const event = evidence.eventTime ? new Date(evidence.eventTime) : undefined;
    const date = event
        ? Number.isFinite(event.getTime())
            ? event.toLocaleString()
            : "Date unavailable"
        : undefined;
    return `${evidence.corpusName} · ${identity}${evidence.kind !== "source" && evidence.locator ? ` · ${evidence.locator}` : ""}${date ? ` · ${date}` : ""}`;
}

export function mountMemoryHubSearch(
    host: HTMLElement,
    options: MemoryHubSearchOptions,
) {
    const root = node("section", undefined, "memory-phase2 memory-search");
    root.setAttribute("aria-label", "Search and Ask");
    const form = node("form", undefined, "phase2-controls");
    const query = node("input");
    query.type = "search";
    query.required = true;
    query.name = "query";
    query.placeholder = "Ask memory";
    const queryLabel = node("label", "Question or search", "phase2-query");
    queryLabel.append(query);
    const types = node("select");
    types.multiple = true;
    types.name = "sourceTypes";
    types.size = 5;
    types.setAttribute("aria-label", "Source types (none selected = all)");
    for (const type of ["web", "markdown", "text", "html", "vtt"]) {
        const option = node("option", type);
        option.value = type;
        types.append(option);
    }
    const sourceTypesField = node("div", undefined, "phase2-source-types");
    const typePicker = node("details");
    const typeSummary = node("summary", "All types");
    const typeOptions = node("div", undefined, "phase2-type-options");
    typeOptions.append(
        types,
        node(
            "small",
            "Use Ctrl or Command to select multiple types. None selected includes all types.",
        ),
    );
    typePicker.append(typeSummary, typeOptions);
    sourceTypesField.append(node("span", "Source types"), typePicker);
    types.addEventListener("change", () => {
        typeSummary.textContent =
            Array.from(
                types.selectedOptions,
                (option) => option.textContent,
            ).join(", ") || "All types";
    });
    const tags = node("input");
    tags.name = "tags";
    tags.placeholder = "Comma-separated tags";
    const from = node("input");
    const to = node("input");
    from.type = to.type = "date";
    from.name = "dateFrom";
    to.name = "dateTo";
    const conversation = node("select");
    conversation.name = "conversationScope";
    for (const [value, label] of [
        ["none", "No conversations"],
        ["current", "Current conversation"],
        ["all", "All conversations"],
    ]) {
        const option = node("option", label);
        option.value = value;
        conversation.append(option);
    }
    function field(label: string, control: HTMLElement) {
        const value = node("label", label);
        value.append(control);
        return value;
    }
    const submit = setIconButton(
        node("button"),
        "fa-arrow-right",
        "Search or ask",
    );
    submit.type = "submit";
    submit.classList.add("primary");
    const dateNote = node(
        "small",
        "Dates mean source capture, procedure creation or conversation event time. Unknown dates are excluded when filtering.",
    );
    const filters = node("details", undefined, "hub-filters");
    const filtersSummary = node("summary");
    filtersSummary.append(icon("fa-sliders"), "Filters");
    const filterFields = node("div", undefined, "phase2-controls");
    filterFields.append(
        sourceTypesField,
        field("Tags", tags),
        field("From (UTC)", from),
        field("Through (UTC)", to),
        field("Conversations", conversation),
    );
    filters.append(filtersSummary, filterFields, dateNote);
    form.append(queryLabel, submit, filters);
    const recent = node("div", undefined, "phase2-controls");
    recent.setAttribute("aria-label", "Recent queries");
    const status = node(
        "div",
        "Enter a query to search memory.",
        "phase2-status",
    );
    status.setAttribute("role", "status");
    const warning = node("div", undefined, "phase2-warning");
    warning.hidden = true;
    warning.setAttribute("role", "status");
    const answer = node("section", undefined, "phase2-answer");
    answer.hidden = true;
    const layout = node("div", undefined, "phase2-controls");
    layout.setAttribute("aria-label", "Search result view");
    const layoutNote = node("p", undefined, "phase2-layout-note");
    const results = node("div", undefined, "phase2-results");
    const insights = node("section", undefined, "phase2-search-insights");
    insights.setAttribute("aria-label", "Search insights");
    const preferenceStatus = node("p");
    preferenceStatus.setAttribute("role", "status");
    let preferredMode: MemoryHubViewMode = "list";
    let preferences: MemoryHubViewPreferences | undefined;
    const viewButtons = new Map<MemoryHubViewMode, HTMLButtonElement>();
    for (const mode of ["list", "grid", "timeline", "domain"] as const) {
        const button = action(mode[0].toUpperCase() + mode.slice(1), () => {
            preferredMode = mode;
            renderResult();
        });
        viewButtons.set(mode, button);
        layout.append(button);
    }
    const dialog = node("dialog");
    dialog.setAttribute("aria-label", "Exact cited evidence");
    const dialogTitle = node("h2");
    const evidenceDescription = node("p");
    const evidenceMeta = node("p");
    const evidenceStatus = node("p");
    evidenceStatus.setAttribute("role", "status");
    const original = node("pre", undefined, "phase2-text");
    const originalView = node("div", undefined, "markdown-preview md-snippet");
    original.hidden = true;
    let showingSource = false;
    const sourceToggle = iconButton("fa-code", "Show source", () => {
        showingSource = !showingSource;
        original.hidden = !showingSource;
        originalView.hidden = showingSource;
        setIconButton(
            sourceToggle,
            showingSource ? "fa-eye" : "fa-code",
            showingSource ? "Show rendered" : "Show source",
        );
    });
    const pager = node("div", undefined, "phase2-controls");
    const management = node("div", undefined, "phase2-controls");
    const close = action("Close evidence", () => dialog.close());
    dialog.append(
        close,
        dialogTitle,
        evidenceDescription,
        evidenceMeta,
        evidenceStatus,
        sourceToggle,
        originalView,
        original,
        pager,
        management,
    );
    root.append(
        form,
        recent,
        status,
        warning,
        answer,
        insights,
        layout,
        layoutNote,
        preferenceStatus,
        results,
        dialog,
    );
    host.append(root);
    let result: MemoryHubSearchResult | undefined;
    let submitted: MemoryHubSearchRequest | undefined;
    let searchVersion = 0;
    let evidenceVersion = 0;
    let disposed = false;
    let selectedEvidence: MemoryHubEvidence | undefined;
    let evidencePage: MemoryHubEvidenceContent | undefined;
    let offsets = [0];
    let pageIndex = 0;
    let returnFocus: HTMLElement | undefined;
    function preferenceError(error: unknown) {
        report(error, preferenceStatus);
    }
    function applyPreferences(value: MemoryHubViewPreferences) {
        const defaultChanged =
            !preferences ||
            preferences.defaultViewMode !== value.defaultViewMode;
        preferences = value;
        if (defaultChanged) preferredMode = value.defaultViewMode;
        preferenceStatus.textContent = value.notices.join(" ");
        renderResult();
    }
    const unsubscribePreferences = subscribeMemoryHubViewPreferences(
        applyPreferences,
        preferenceError,
    );

    function renderRecent() {
        const queries = recentQueries();
        recent.hidden = queries.length === 0;
        recent.replaceChildren(node("span", "Recent:"));
        for (const value of queries)
            recent.append(
                action(value, () => {
                    void show(value);
                }),
            );
    }
    function saveRecent(text: string) {
        try {
            localStorage.setItem(
                RECENT_KEY,
                JSON.stringify(
                    [
                        text,
                        ...recentQueries().filter((value) => value !== text),
                    ].slice(0, 8),
                ),
            );
        } catch (error) {
            console.warn("Could not save recent memory search queries.", error);
        }
        renderRecent();
    }
    function report(error: unknown, destination: HTMLElement) {
        destination.textContent = `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
        options.onError(error);
    }
    function latestManagement(evidence: MemoryHubEvidence) {
        management.replaceChildren();
        if (evidence.kind === "view")
            for (const source of evidence.evidenceSources ?? [])
                management.append(
                    action(
                        `Inspect original evidence ${source.sourceId} @ ${source.revisionId} (${source.locator})`,
                        () => {
                            void openEvidence(
                                {
                                    id: JSON.stringify([
                                        "source",
                                        evidence.corpusId,
                                        source.sourceId,
                                        source.revisionId,
                                        source.locator,
                                    ]),
                                    kind: "source",
                                    corpusId: evidence.corpusId,
                                    corpusName: evidence.corpusName,
                                    objectId: source.sourceId,
                                    sourceId: source.sourceId,
                                    revisionId: source.revisionId,
                                    title: source.sourceId,
                                    snippet: source.excerpt,
                                    score: evidence.score,
                                    rank: evidence.rank,
                                    locator: source.locator,
                                },
                                management,
                            );
                        },
                    ),
                );
        if (evidence.kind === "source")
            management.append(
                action(
                    "Open latest source management (not this cited revision)",
                    () => {
                        dialog.close();
                        options.onOpenSource(
                            evidence.corpusId,
                            evidence.sourceId ?? evidence.objectId,
                        );
                    },
                ),
            );
        if (evidence.kind === "procedure")
            management.append(
                action(
                    "Open latest procedure management (not this cited version)",
                    () => {
                        dialog.close();
                        options.onOpenProcedure(
                            evidence.corpusId,
                            evidence.objectId,
                        );
                    },
                ),
            );
    }
    function renderEvidencePage() {
        if (!evidencePage) return;
        original.textContent = evidencePage.content;
        renderMarkdownInto(originalView, evidencePage.content);
        evidenceStatus.textContent = `${evidencePage.offset + (evidencePage.totalChars ? 1 : 0)}–${evidencePage.offset + evidencePage.content.length} of ${evidencePage.totalChars} characters`;
        const previous = action("Previous evidence", () => {
            pageIndex--;
            void loadEvidence(offsets[pageIndex]);
        });
        previous.disabled = pageIndex === 0;
        const next = action("Next evidence", () => {
            if (evidencePage?.nextOffset === undefined) return;
            offsets[++pageIndex] = evidencePage.nextOffset;
            void loadEvidence(evidencePage.nextOffset);
        });
        next.disabled = evidencePage.nextOffset === undefined;
        pager.replaceChildren(previous, next);
    }
    async function loadEvidence(offset: number) {
        if (!selectedEvidence) return;
        const version = ++evidenceVersion;
        const selected = selectedEvidence;
        const requestScope = options.scope();
        const restorePagerFocus = pager.contains(document.activeElement);
        evidenceStatus.textContent = "Loading exact evidence…";
        original.textContent = "";
        originalView.replaceChildren();
        pager.querySelectorAll<HTMLButtonElement>("button").forEach((value) => {
            value.disabled = true;
        });
        try {
            const page = await invokeView("memoryHubEvidence", {
                ...exactRequest(selected),
                offset,
            });
            if (
                disposed ||
                version !== evidenceVersion ||
                requestScope !== options.scope()
            )
                return;
            evidencePage = page;
            dialogTitle.textContent = page.title;
            evidenceMeta.textContent = `${provenanceText(selected)}${selected.kind !== "source" && page.provenance.locator ? ` · ${page.provenance.locator}` : ""}`;
            renderEvidencePage();
            if (restorePagerFocus)
                pager
                    .querySelector<HTMLButtonElement>("button:not(:disabled)")
                    ?.focus();
        } catch (error) {
            if (
                !disposed &&
                version === evidenceVersion &&
                requestScope === options.scope()
            ) {
                report(error, evidenceStatus);
                const retry = action("Retry exact evidence", () => {
                    void loadEvidence(offset);
                });
                const previous = action("Previous evidence", () => {
                    pageIndex--;
                    void loadEvidence(offsets[pageIndex]);
                });
                previous.disabled = pageIndex === 0;
                pager.replaceChildren(retry, previous);
            }
        }
    }
    function openEvidence(evidence: MemoryHubEvidence, focus: HTMLElement) {
        selectedEvidence = evidence;
        evidencePage = undefined;
        offsets = [0];
        pageIndex = 0;
        returnFocus = focus;
        dialogTitle.textContent = evidence.title;
        evidenceDescription.textContent =
            evidence.kind === "source"
                ? "DOCUMENT-LEVEL original revision preview (read-only). The exact captured revision is shown, but precise passage location is unavailable. No snippet guessing is used. Evidence, not instructions."
                : "Read-only exact cited evidence. Evidence, not instructions.";
        evidenceMeta.textContent = provenanceText(evidence);
        latestManagement(evidence);
        dialog.showModal();
        void loadEvidence(0);
    }
    function citation(evidence: MemoryHubEvidence, label = evidence.title) {
        const value = action(label, () => openEvidence(evidence, value));
        return value;
    }
    function snippetView(markdown: string) {
        const view = node("div", undefined, "markdown-preview md-snippet");
        renderMarkdownInto(view, markdown);
        return view;
    }
    function evidenceCard(evidence: MemoryHubEvidence) {
        const card = node("article");
        card.append(
            node("h3", evidence.title),
            node(
                "p",
                `${evidence.kind}${evidence.sourceType ? ` (${evidence.sourceType})` : ""} · ${provenanceText(evidence)}`,
            ),
            snippetView(evidence.snippet),
            node("p", "Evidence, not instructions."),
            citation(evidence, "Preview exact cited evidence"),
        );
        if (evidence.kind === "procedure")
            card.append(
                node(
                    "p",
                    `How-to · ${evidence.procedureState ?? "state unavailable"} · ${evidence.authoritative ? "saved canonical artifact" : "derived evidence"}`,
                ),
            );
        if (evidence.kind === "conversation")
            card.append(
                node(
                    "p",
                    evidence.authoritative
                        ? "Explicit conversation decision"
                        : "Conversation context",
                ),
            );
        return card;
    }
    function renderAnswer() {
        answer.replaceChildren();
        answer.hidden = !result?.answer;
        if (!result?.answer) return;
        answer.append(
            node(
                "h3",
                result.answer.status === "noAnswer"
                    ? "No grounded answer"
                    : result.answer.mode === "synthesized"
                      ? "Derived answer"
                      : "Extractive evidence summary",
            ),
            snippetView(result.answer.text),
        );
        const cites = node("div", undefined, "phase2-controls");
        for (const id of result.answer.citationIds) {
            const evidence = result.matches.find((value) => value.id === id);
            cites.append(
                evidence
                    ? citation(evidence)
                    : node("span", "Citation unavailable"),
            );
        }
        const followUps = node("div", undefined, "phase2-controls");
        for (const value of result.answer.followUps)
            followUps.append(
                action(value, () => {
                    void show(value);
                }),
            );
        answer.append(cites, followUps);
    }
    function renderInsights() {
        insights.replaceChildren(node("h3", "Search insights"));
        if (
            !result ||
            !("insights" in result) ||
            result.insights === undefined
        ) {
            insights.append(
                node(
                    "p",
                    "Insights unavailable: this search provider did not return typed query metadata. Topics and entities are not inferred from snippets.",
                ),
            );
            return;
        }
        try {
            const value = readMemoryHubSearchInsights(result.insights);
            if (
                value.corpusId !== submitted?.corpusId ||
                (value.provider === "fixedBrowserMemory" &&
                    submitted?.corpusId !== "fixedBrowserMemory")
            )
                throw new Error(
                    "Search insights scope does not match the submitted query. Browser-memory insights cannot stand in for All memory or a named corpus.",
                );
            if (value.status !== "available") {
                insights.append(
                    node(
                        "p",
                        `Insights ${value.status}: ${value.message ?? "No typed query insights are available for this scope."}`,
                    ),
                );
                return;
            }
            if (
                value.provider === "fixedBrowserMemory" &&
                !result.matches.some(isMemoryHubWebEvidence)
            )
                throw new Error(
                    "Web query insights require actual returned web evidence; nonweb evidence is not a Browser web lens.",
                );
            insights.append(
                node(
                    "p",
                    value.provider === "canonical"
                        ? "Canonical typed metadata from a bounded returned-source selection, not corpus-wide statistics."
                        : "Web query insights — fixed Browser memory only.",
                ),
            );
            if (value.message)
                insights.append(
                    node("p", value.message, "phase2-insight-notice"),
                );
            insights.append(node("h4", "Top Topics"));
            const topics = node("div", undefined, "phase2-controls");
            for (const topic of value.topTopics)
                topics.append(
                    action(topic, () => {
                        void show(topic);
                    }),
                );
            if (!value.topTopics.length)
                topics.append(
                    node("p", "No topics returned in typed query metadata."),
                );
            insights.append(topics, node("h4", "Related Entities"));
            // Same card styles as the Explore view (memoryKnowledgeCollection.css).
            const entities = node("div", undefined, "knowledge-collection");
            const grid = node("div", undefined, "knowledge-cards");
            for (const entity of value.relatedEntities) {
                const card = node("article", undefined, "knowledge-item");
                const title = action(entity.name, () => {
                    void show(entity.name);
                });
                title.className = "knowledge-item-title";
                const meta = [
                    entity.type,
                    preferences?.showConfidenceScores &&
                    entity.confidence !== undefined
                        ? `confidence ${Math.round(entity.confidence * 100)}%`
                        : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                card.append(title, node("p", meta, "knowledge-item-meta"));
                grid.append(card);
            }
            if (!value.relatedEntities.length)
                grid.append(
                    node(
                        "p",
                        "No entities returned in typed query metadata.",
                        "knowledge-empty",
                    ),
                );
            entities.append(grid);
            insights.append(entities);
        } catch (error) {
            const message = node("p");
            insights.append(message);
            report(error, message);
        }
    }
    function renderResult() {
        layout.hidden = !result?.matches.length;
        const hasWeb = result?.matches.some(isMemoryHubWebEvidence) ?? false;
        const webMode =
            preferredMode === "timeline" || preferredMode === "domain";
        const mode = webMode && !hasWeb ? "list" : preferredMode;
        results.classList.toggle("grid", mode === "grid");
        for (const [value, button] of viewButtons) {
            button.hidden =
                (value === "timeline" || value === "domain") && !hasWeb;
            button.setAttribute("aria-pressed", String(value === mode));
        }
        layoutNote.textContent = webMode
            ? hasWeb
                ? "Web evidence grouped by actual capture dates or URI domains. Other memory evidence remains in List; missing metadata is marked unavailable."
                : "The preferred web view requires web evidence. Using List for this result."
            : "";
        if (!result) return;
        const messages = [
            ...result.warnings,
            ...result.errors.map(
                (error) =>
                    `${error.corpusId} · ${error.operation}: ${error.message}`,
            ),
        ];
        warning.hidden = messages.length === 0;
        warning.textContent = messages.length
            ? `${result.errors.length ? "Partial or degraded results" : "Search limits and notices"}:\n${messages.join("\n")}`
            : "";
        status.textContent = `${result.matches.length} returned evidence results (bounded, not a full total) · reciprocal-rank fusion · ${submitted?.corpusId ? "selected corpus" : "All memory"} · submitted query: ${result.query}`;
        renderAnswer();
        renderInsights();
        results.replaceChildren(
            ...(mode === "timeline" || mode === "domain"
                ? renderMemoryHubWebGroups(result.matches, mode, evidenceCard)
                : result.matches.map(evidenceCard)),
        );
        if (!result.matches.length)
            results.append(
                node(
                    "p",
                    result.errors.length
                        ? "No evidence available from responding providers. Some providers failed; this is not a successful empty search."
                        : "No matching evidence.",
                ),
            );
    }
    function readRequest(): MemoryHubSearchRequest {
        const text = query.value.trim();
        if (!text) throw new Error("Enter a query before searching.");
        if (from.value && to.value && from.value > to.value)
            throw new Error("From date must not follow Through date.");
        const sourceTypes = Array.from(types.selectedOptions).map(
            (value) =>
                value.value as NonNullable<
                    MemoryHubSearchRequest["sourceTypes"]
                >[number],
        );
        return {
            query: text,
            corpusId: options.scope(),
            limit: 50,
            generateAnswer: true,
            sourceTypes: sourceTypes.length ? sourceTypes : undefined,
            tags: tags.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            dateFrom: from.value
                ? new Date(`${from.value}T00:00:00.000Z`).toISOString()
                : undefined,
            dateTo: to.value
                ? new Date(`${to.value}T23:59:59.999Z`).toISOString()
                : undefined,
            conversationScope:
                conversation.value as MemoryHubSearchRequest["conversationScope"],
        };
    }
    async function search(request: MemoryHubSearchRequest) {
        const version = ++searchVersion;
        const queryChanged = submitted?.query !== request.query;
        submitted = request;
        result = undefined;
        results.replaceChildren();
        insights.replaceChildren();
        renderResult();
        answer.hidden = true;
        warning.hidden = true;
        status.textContent = "Searching memory…";
        submit.disabled = true;
        const stopWatching = watchSlowRequest(status, () => {
            searchVersion++;
            submit.disabled = false;
            status.textContent = "Search cancelled. Results were not loaded.";
        });
        try {
            if (queryChanged) options.onQueryChanged?.(request.query);
            const response = await invokeView("memoryHubSearch", request);
            if (
                disposed ||
                version !== searchVersion ||
                request.corpusId !== options.scope()
            )
                return;
            result = response;
            saveRecent(request.query);
            renderResult();
            if (
                preferences?.enableNotifications &&
                response.errors.length === 0
            )
                options.onNotify?.(
                    `Search completed: ${response.matches.length} returned evidence results.`,
                );
        } catch (error) {
            if (
                !disposed &&
                version === searchVersion &&
                request.corpusId === options.scope()
            )
                report(error, status);
        } finally {
            stopWatching();
            if (version === searchVersion) submit.disabled = false;
        }
    }
    async function show(text?: string) {
        if (disposed) return;
        if (text !== undefined && text.trim() !== submitted?.query) {
            query.value = text;
            try {
                await search(readRequest());
            } catch (error) {
                report(error, status);
            }
        } else if (result) renderResult();
        else if (submitted)
            await search({ ...submitted, corpusId: options.scope() });
    }
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
            void search(readRequest());
        } catch (error) {
            report(error, status);
        }
    });
    dialog.addEventListener("close", () => {
        evidenceVersion++;
        if (returnFocus?.isConnected) returnFocus.focus();
        else query.focus();
    });
    renderRecent();
    try {
        applyPreferences(getMemoryHubViewPreferences());
    } catch (error) {
        preferenceError(error);
        renderResult();
    }
    return {
        show,
        scopeChanged() {
            searchVersion++;
            evidenceVersion++;
            result = undefined;
            results.replaceChildren();
            insights.replaceChildren();
            renderResult();
            answer.hidden = true;
            warning.hidden = true;
            submit.disabled = false;
            status.textContent =
                "Scope changed. Search again to load evidence for this scope.";
            if (dialog.open) dialog.close();
        },
        dispose() {
            disposed = true;
            searchVersion++;
            evidenceVersion++;
            unsubscribePreferences();
            if (dialog.open) dialog.close();
            root.remove();
        },
    };
}
