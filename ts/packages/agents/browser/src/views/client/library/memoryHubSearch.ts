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
import { hubNotifications } from "./memoryHubNotifications";
import type { UnderstandingRequest } from "@typeagent/memory-service";
import {
    mountMemoryHubUnderstanding,
    toSourceUnderstandingRequest,
} from "./memoryHubUnderstanding";

export type MemoryHubSearchOptions = {
    queryInput: HTMLInputElement | HTMLTextAreaElement;
    scope: () => string | undefined;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onOpenView?: (corpusId: string, viewId: string, revisionId: string) => void;
    onError: (error: unknown) => void;
    onQueryChanged?: (query: string) => void;
    onNotify?: (message: string) => void;
    onUnderstand?: (request: UnderstandingRequest) => void;
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
        (evidence.kind === "source" ||
            evidence.kind === "view" ||
            evidence.kind === "event") &&
        !evidence.revisionId
    )
        throw new Error(
            "Exact source revision is unavailable; latest content is not substituted.",
        );
    return {
        corpusId: evidence.corpusId,
        kind: evidence.kind,
        objectId: evidence.objectId,
        ...(evidence.revisionId ? { revisionId: evidence.revisionId } : {}),
        ...(evidence.kind === "source" && sourceRange(evidence.locator)
            ? { locator: evidence.locator }
            : {}),
    };
}
function sourceRange(locator?: string): string | undefined {
    return /^(?:chars:\d+-\d+|indexed:\d+:[0-9a-f]{64}:\d+-\d+)$/.test(
        locator ?? "",
    )
        ? locator
        : undefined;
}
function overlayProvenance(
    evidence: MemoryHubEvidence,
    locator = evidence.locator,
) {
    const retained =
        evidence.kind === "source" ? sourceRange(evidence.locator) : locator;
    return `${provenanceText(evidence)} · ${evidence.objectId}${evidence.revisionId ? ` @ ${evidence.revisionId}` : ""}${retained ? ` · ${retained}` : ""}`;
}
function provenanceText(evidence: MemoryHubEvidence): string {
    const identity =
        evidence.kind === "view"
            ? `${evidence.viewKind} v${evidence.viewVersion} @ ${evidence.revisionId} · ${evidence.viewProvenance} · ${evidence.review} · ${evidence.freshness} · derived, not independent corroboration`
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
    root.setAttribute("aria-label", "Ask or Explain");
    const form = node("form", undefined, "phase2-controls");
    const query = options.queryInput;
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
    const viewKind = node("select");
    const retrieval = node("select");
    const checkpoint = node("input");
    checkpoint.setAttribute("aria-label", "Required knowledge checkpoint");
    checkpoint.placeholder = "Optional exact checkpoint ID";
    retrieval.setAttribute("aria-label", "Answer retrieval policy");
    for (const [value, label] of [
        ["", "Available sources and knowledge (default)"],
        ["sourcesOnly", "Sources only (diagnostic)"],
        ["sourcesAndViews", "Sources and views (strict)"],
    ]) {
        const option = node("option", label);
        option.value = value;
        retrieval.append(option);
    }
    viewKind.setAttribute("aria-label", "Derived view kind");
    for (const [value, label] of [
        ["", "All derived views"],
        ["projectBrief", "Project briefs"],
        ["timeline", "Evidence-linked timelines"],
        ["wiki", "Knowledge wikis"],
        ["troubleshootingGuide", "Troubleshooting guides"],
        ["schemaView", "Schema-defined questions"],
    ]) {
        const option = node("option", label);
        option.value = value;
        viewKind.append(option);
    }
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
    const submit = node("button", "Apply filters");
    submit.type = "submit";
    submit.classList.add("primary");
    const intent = node("select");
    intent.name = "intent";
    intent.setAttribute("aria-label", "Response mode");
    for (const [value, label] of [
        ["auto", "Automatic (recommended)"],
        ["find", "Find sources"],
        ["ask", "Ask for an answer"],
    ]) {
        const option = node("option", label);
        option.value = value;
        intent.append(option);
    }
    const dateNote = node(
        "small",
        "Dates mean source capture, view creation or conversation event time. Unknown dates are excluded when filtering.",
    );
    const filters = node("details", undefined, "hub-filters");
    const filtersSummary = node("summary");
    filtersSummary.append(icon("fa-sliders"), "Filters");
    const filterPanel = node("div", undefined, "phase2-filter-panel");
    const filterFields = node("div", undefined, "phase2-controls");
    filterFields.append(
        field("Response mode", intent),
        sourceTypesField,
        field("Tags", tags),
        field("From (UTC)", from),
        field("Through (UTC)", to),
        field("Conversations", conversation),
        field("Derived view kind", viewKind),
        field("Answer retrieval", retrieval),
        field("Require ready knowledge checkpoint", checkpoint),
    );
    filterPanel.append(filterFields, dateNote, submit);
    filters.append(filtersSummary, filterPanel);
    const historyDialog = node("dialog", undefined, "phase2-history-dialog");
    historyDialog.setAttribute("aria-label", "Query history");
    const historyHeading = node("div", undefined, "phase2-dialog-heading");
    const historyClose = iconButton("fa-xmark", "Close history", () =>
        historyDialog.close(),
    );
    historyHeading.append(node("h2", "Past queries"), historyClose);
    const historyLinks = node("div", undefined, "phase2-context-list");
    historyDialog.append(
        historyHeading,
        node(
            "p",
            "Previous queries on this device. Choose one to run it again.",
        ),
        historyLinks,
    );
    const historyButton = action("History", () => {
        renderRecent();
        historyDialog.showModal();
    });
    historyButton.prepend(icon("fa-clock"), " ");
    historyButton.className = "phase2-text-action";
    historyButton.setAttribute("aria-haspopup", "dialog");
    historyDialog.addEventListener("close", () => historyButton.focus());
    form.append(historyButton, filters);
    const recent = node("section", undefined, "phase2-sidecard");
    recent.setAttribute("aria-label", "Past queries");
    const status = node(
        "div",
        "Enter a question or describe what you want to find.",
        "phase2-status",
    );
    status.setAttribute("role", "status");
    const answer = node("section", undefined, "phase2-answer");
    answer.hidden = true;
    const layout = node("div", undefined, "phase2-controls");
    layout.setAttribute("aria-label", "Evidence view");
    const layoutNote = node("p", undefined, "phase2-layout-note");
    const results = node("div", undefined, "phase2-results");
    const resultPager = node(
        "nav",
        undefined,
        "phase2-controls phase2-result-pager",
    );
    resultPager.setAttribute("aria-label", "Evidence pages");
    const pageStatus = node("span");
    pageStatus.setAttribute("role", "status");
    const previousPage = action("Previous page", () => changePage(-1));
    const nextPage = action("Next page", () => changePage(1));
    resultPager.append(previousPage, pageStatus, nextPage);
    const insights = node("aside", undefined, "phase2-search-insights");
    insights.setAttribute("aria-label", "Related context");
    const preferenceStatus = node("p");
    preferenceStatus.setAttribute("role", "status");
    let preferredMode: MemoryHubViewMode = "list";
    let preferences: MemoryHubViewPreferences | undefined;
    const viewButtons = new Map<MemoryHubViewMode, HTMLButtonElement>();
    for (const mode of ["list", "grid", "timeline", "domain"] as const) {
        const label = mode[0].toUpperCase() + mode.slice(1);
        const button = action(label, () => {
            preferredMode = mode;
            renderResult();
        });
        if (mode === "list" || mode === "grid")
            setIconButton(
                button,
                mode === "list" ? "fa-list" : "fa-grip",
                `${label} view`,
            );
        viewButtons.set(mode, button);
        layout.append(button);
    }
    const dialog = node("dialog", undefined, "phase2-source-dialog");
    dialog.setAttribute("aria-label", "Exact cited evidence");
    const dialogTitle = node("h2");
    const dialogHeading = node("div", undefined, "phase2-dialog-heading");
    const dialogMode = node("p", undefined, "phase2-dialog-mode");
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
    setIconButton(close, "fa-xmark", "Close evidence");
    dialogHeading.append(dialogTitle, close);
    const provenance = node("details", undefined, "phase2-provenance");
    provenance.append(
        node("summary", "Source details and provenance"),
        evidenceDescription,
        evidenceMeta,
        management,
    );
    const preview = node("div", undefined, "phase2-source-preview");
    const previewCaption = node("p");
    preview.append(
        previewCaption,
        evidenceStatus,
        sourceToggle,
        originalView,
        original,
        pager,
    );
    const explanation = node("div", undefined, "phase2-source-explanation");
    explanation.append(
        node(
            "p",
            "Based only on this captured source revision.",
            "phase2-dialog-intro",
        ),
    );
    explanation.hidden = true;
    const overlayActions = node("div", undefined, "phase2-overlay-actions");
    dialog.append(
        dialogMode,
        dialogHeading,
        preview,
        explanation,
        provenance,
        overlayActions,
    );
    const reading = node("div", undefined, "phase2-search-reading");
    const evidenceHeading = node("h3", "Supporting evidence");
    const evidenceTools = node("div", undefined, "phase2-evidence-heading");
    evidenceTools.append(evidenceHeading, layout);
    reading.append(
        answer,
        evidenceTools,
        layoutNote,
        preferenceStatus,
        results,
        resultPager,
    );
    const resultLayout = node("div", undefined, "phase2-result-layout");
    resultLayout.append(reading, insights);
    root.append(form, status, resultLayout, dialog, historyDialog);
    host.append(root);
    let result: MemoryHubSearchResult | undefined;
    let submitted: MemoryHubSearchRequest | undefined;
    let searchElapsedMs: number | undefined;
    let resultPage = 0;
    let understandingEnabled = false;
    const pageSize = 25;

    function changePage(delta: number) {
        if (!result) return;
        resultPage = Math.max(
            0,
            Math.min(
                Math.ceil(result.matches.length / pageSize) - 1,
                resultPage + delta,
            ),
        );
        renderResult();
        evidenceHeading.tabIndex = -1;
        evidenceHeading.focus({ preventScroll: true });
        evidenceHeading.scrollIntoView?.({ block: "start" });
    }
    function preparedId(request: MemoryHubSearchRequest): string | undefined {
        const scope = (value: MemoryHubSearchRequest) => {
            const {
                generateAnswer: _answer,
                prepareUnderstanding: _prepare,
                evidenceSnapshotId: _snapshot,
                ...rest
            } = value;
            return JSON.stringify(rest);
        };
        return submitted && scope(submitted) === scope(request)
            ? result?.evidenceSnapshotId
            : undefined;
    }
    let searchVersion = 0;
    let evidenceVersion = 0;
    let disposed = false;
    let selectedEvidence: MemoryHubEvidence | undefined;
    let evidencePage: MemoryHubEvidenceContent | undefined;
    let offsets = [0];
    let pageIndex = 0;
    let returnFocus: HTMLElement | undefined;
    const explanationPanel = mountMemoryHubUnderstanding(explanation, {
        presentation: "overlay",
        scope: options.scope,
        onError: options.onError,
        onQueryChanged: () => {},
        onResults: () => dialog.close(),
        onEvidence: (value, focus) => openEvidence(value, focus),
        onGraph: () => openFullExplanation(),
    });
    function canExplain(evidence: MemoryHubEvidence) {
        return (
            understandingEnabled &&
            evidence.kind === "source" &&
            !!evidence.revisionId &&
            evidence.corpusId !== "fixedBrowserMemory"
        );
    }
    function explanationRequest() {
        if (!selectedEvidence)
            throw new Error("No source is selected for explanation.");
        return toSourceUnderstandingRequest(
            selectedEvidence,
            submitted?.query ?? query.value.trim(),
        );
    }
    function openFullExplanation() {
        const request = explanationRequest();
        dialog.close();
        options.onUnderstand?.(request);
    }
    function renderOverlayActions(explaining: boolean) {
        overlayActions.replaceChildren();
        if (!selectedEvidence || !canExplain(selectedEvidence)) return;
        const switchAction = action(
            explaining ? "Preview captured source" : "Explain this",
            () => {
                if (!selectedEvidence) return;
                if (explaining) openEvidence(selectedEvidence, switchAction);
                else openExplanation(selectedEvidence, switchAction);
            },
        );
        switchAction.className = "phase2-link";
        overlayActions.append(switchAction);
        if (explaining)
            overlayActions.append(
                action("Open full explanation", openFullExplanation),
            );
    }
    function prepareOverlay(
        evidence: MemoryHubEvidence,
        focus: HTMLElement,
        explaining: boolean,
    ) {
        evidenceVersion++;
        if (!dialog.open || !dialog.contains(focus)) returnFocus = focus;
        selectedEvidence = evidence;
        dialogTitle.textContent = evidence.title;
        dialog.setAttribute(
            "aria-label",
            explaining ? "Document explanation" : "Exact cited evidence",
        );
        dialogMode.textContent = explaining
            ? "Document explanation"
            : "Captured revision preview";
        evidenceMeta.textContent = overlayProvenance(evidence);
        preview.hidden = explaining;
        previewCaption.textContent =
            evidence.kind === "source"
                ? sourceRange(evidence.locator)
                    ? "Captured passage from this exact revision."
                    : "Full captured document. An exact passage location is unavailable."
                : "Read-only captured evidence.";
        explanation.hidden = !explaining;
        provenance.open = false;
        latestManagement(evidence);
        renderOverlayActions(explaining);
        if (!dialog.open) dialog.showModal();
    }
    function openExplanation(evidence: MemoryHubEvidence, focus: HTMLElement) {
        if (!canExplain(evidence)) return;
        try {
            prepareOverlay(evidence, focus, true);
            void explanationPanel.show(explanationRequest());
        } catch (error) {
            report(error, evidenceStatus);
        }
    }
    function preferenceError(error: unknown) {
        report(error, preferenceStatus);
    }
    function applyPreferences(value: MemoryHubViewPreferences) {
        const defaultChanged =
            !preferences ||
            preferences.defaultViewMode !== value.defaultViewMode;
        preferences = value;
        if (defaultChanged) preferredMode = value.defaultViewMode;
        hubNotifications.set("view-preferences", {
            title: "View preferences",
            page: "settings",
            messages: value.notices,
        });
        renderResult();
    }
    const unsubscribePreferences = subscribeMemoryHubViewPreferences(
        applyPreferences,
        preferenceError,
    );

    function renderRecent() {
        const normalize = (value: string) =>
            value.trim().replace(/\s+/g, " ").toLowerCase();
        const active = new Set([
            normalize(submitted?.query ?? ""),
            normalize(query.value),
        ]);
        const queries = recentQueries().filter(
            (value) => !active.has(normalize(value)),
        );
        recent.hidden = queries.length === 0;
        recent.replaceChildren(node("h3", "Past queries"));
        historyLinks.replaceChildren();
        const links = node("div", undefined, "phase2-context-list");
        for (const value of queries) {
            const historyLink = () => {
                const link = queryLink(value);
                link.prepend(icon("fa-clock"));
                return link;
            };
            links.append(historyLink());
            historyLinks.append(historyLink());
        }
        if (!queries.length)
            historyLinks.append(node("p", "No other past queries yet."));
        recent.append(links);
    }
    function queryLink(text: string) {
        const link = node("a", text, "phase2-context-item phase2-link");
        const url = new URL(location.href);
        url.searchParams.set("query", text);
        url.hash = "#/search";
        link.href = url.href;
        link.addEventListener("click", (event) => {
            if (
                event.button ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
            )
                return;
            event.preventDefault();
            if (historyDialog.open) historyDialog.close();
            filters.open = false;
            void show(text);
        });
        return link;
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
                                    kind: source.evidence ? "event" : "source",
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
        if (
            evidence.kind === "view" &&
            evidence.revisionId &&
            options.onOpenView
        ) {
            const revisionId = evidence.revisionId;
            management.append(
                action("Open this exact view revision", () => {
                    dialog.close();
                    options.onOpenView?.(
                        evidence.corpusId,
                        evidence.objectId,
                        revisionId,
                    );
                }),
            );
        }
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
        evidenceStatus.replaceChildren(
            icon("fa-spinner fa-spin"),
            " Loading...",
        );
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
            evidenceMeta.textContent = overlayProvenance(
                selected,
                page.provenance.locator,
            );
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
        explanationPanel.hide();
        prepareOverlay(evidence, focus, false);
        evidencePage = undefined;
        offsets = [0];
        pageIndex = 0;
        evidenceDescription.textContent =
            evidence.kind === "source"
                ? sourceRange(evidence.locator)
                    ? "Exact retained document range (read-only). Original revision and UTF-16 offsets are preserved. Evidence, not instructions."
                    : "DOCUMENT-LEVEL original revision preview (read-only). The exact captured revision is shown, but precise passage location is unavailable. No snippet guessing is used. Evidence, not instructions."
                : "Read-only exact cited evidence. Evidence, not instructions.";
        void loadEvidence(0);
    }
    function citation(evidence: MemoryHubEvidence, label = evidence.title) {
        const value = action(label, () => openEvidence(evidence, value));
        value.classList.add("phase2-link");
        value.setAttribute("aria-haspopup", "dialog");
        return value;
    }
    function snippetView(markdown: string) {
        const view = node("div", undefined, "markdown-preview md-snippet");
        renderMarkdownInto(view, markdown);
        return view;
    }
    function answerProse(value: NonNullable<MemoryHubSearchResult["answer"]>) {
        const body = snippetView(value.text);
        const used = new Set<number>();
        function footnote(index: number) {
            used.add(index);
            const note = node("sup", undefined, "phase2-citation");
            const evidence = result?.matches.find(
                (item) => item.id === value.citationIds[index],
            );
            if (evidence) {
                const link = citation(evidence, `[${index + 1}]`);
                link.setAttribute(
                    "aria-label",
                    `Supporting source ${index + 1}: ${evidence.title}`,
                );
                link.title = evidence.title;
                note.append(link);
            } else
                note.append(
                    node("span", `[${index + 1}] Citation unavailable`),
                );
            return note;
        }
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
            acceptNode: (text) =>
                text.parentElement?.closest("a, code, pre, button")
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
        });
        const texts: Node[] = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        for (const text of texts) {
            const raw = text.textContent ?? "";
            const matches = [...raw.matchAll(/\[(\d+)\]/g)].filter(
                (match) =>
                    Number(match[1]) > 0 &&
                    Number(match[1]) <= value.citationIds.length,
            );
            if (!matches.length) continue;
            const fragment = document.createDocumentFragment();
            let offset = 0;
            for (const match of matches) {
                fragment.append(
                    raw.slice(offset, match.index),
                    footnote(Number(match[1]) - 1),
                );
                offset = match.index! + match[0].length;
            }
            fragment.append(raw.slice(offset));
            text.parentNode?.replaceChild(fragment, text);
        }
        const remaining = node("p", undefined, "phase2-answer-citations");
        remaining.setAttribute("aria-label", "Answer sources");
        for (let index = 0; index < value.citationIds.length; index++)
            if (!used.has(index)) remaining.append(footnote(index));
        if (remaining.childNodes.length) body.append(remaining);
        return body;
    }
    function evidenceCard(evidence: MemoryHubEvidence) {
        const card = node("article", undefined, "phase2-source-card");
        const header = node("div", undefined, "phase2-source-header");
        const identity = node("div", undefined, "phase2-source-identity");
        const title = node("h3");
        title.append(citation(evidence));
        const citationIndex =
            result?.answer?.citationIds.indexOf(evidence.id) ?? -1;
        if (citationIndex >= 0)
            title.append(
                node("span", `[${citationIndex + 1}]`, "phase2-source-index"),
            );
        identity.append(
            title,
            node(
                "p",
                `${evidence.kind}${evidence.sourceType ? ` (${evidence.sourceType})` : ""} · ${provenanceText(evidence)}`,
                "phase2-evidence-meta",
            ),
        );
        const actions = node("div", undefined, "phase2-source-actions");
        const preview = citation(evidence, "Preview");
        preview.className = "phase2-source-action";
        preview.prepend(icon("fa-eye"));
        preview.title = "Preview exact cited evidence";
        actions.append(preview);
        if (
            understandingEnabled &&
            options.onUnderstand &&
            evidence.kind === "source" &&
            evidence.revisionId &&
            evidence.corpusId !== "fixedBrowserMemory"
        ) {
            const explain = action("Explain this", () => {
                openExplanation(evidence, explain);
            });
            explain.setAttribute("aria-haspopup", "dialog");
            explain.className = "phase2-source-action phase2-explain-source";
            explain.prepend(icon("fa-wand-magic-sparkles"));
            actions.append(explain);
        }
        header.append(identity, actions);
        const passage = node("section", undefined, "phase2-source-passage");
        passage.append(
            node(
                "p",
                evidence.kind === "view"
                    ? "Derived excerpt"
                    : evidence.kind === "conversation" ||
                        evidence.kind === "event"
                      ? "Conversation excerpt"
                      : "Captured passage",
                "phase2-source-label",
            ),
            snippetView(evidence.snippet),
        );
        card.append(header, passage);
        if (
            evidence.synopsis?.status === "ready" &&
            evidence.synopsis.freshness === "fresh" &&
            evidence.synopsis.preview
        ) {
            const summary = node("section", undefined, "phase2-source-summary");
            summary.setAttribute(
                "aria-label",
                "AI description (navigation only, not citation evidence)",
            );
            const heading = node(
                "div",
                undefined,
                "phase2-source-summary-heading",
            );
            heading.append(
                node("span", "AI description"),
                node("small", "Navigation only"),
            );
            summary.append(heading, node("p", evidence.synopsis.preview));
            card.append(summary);
        }
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
            node("p", "Answer + sources", "phase2-answer-eyebrow"),
            node(
                "h3",
                result.answer.status === "noAnswer"
                    ? "No grounded answer"
                    : result.answer.mode === "synthesized"
                      ? "From your memory"
                      : "Extractive evidence summary",
            ),
            answerProse(result.answer),
        );
        const followUps = node("div", undefined, "phase2-controls");
        for (const value of result.answer.followUps)
            followUps.append(queryLink(value));
        answer.append(followUps);
        for (const reference of result.answer.derivedReferences ?? []) {
            answer.append(
                action(
                    `Maintained knowledge · ${reference.viewId} @ ${reference.revisionId}${reference.sectionId ? ` · ${reference.sectionId}` : ""} · ${reference.state}`,
                    () =>
                        options.onOpenView?.(
                            reference.corpusId,
                            reference.viewId,
                            reference.revisionId,
                        ),
                ),
            );
        }
        for (const reference of result.answer.assertionReferences ?? []) {
            answer.append(
                action(
                    `User assertion · ${reference.assertionOrigin} · ${reference.viewId} @ ${reference.revisionId} · candidate ${reference.candidateId} (not independent source evidence)`,
                    () =>
                        options.onOpenView?.(
                            reference.corpusId,
                            reference.viewId,
                            reference.revisionId,
                        ),
                ),
            );
        }
    }
    function sidecard(title: string) {
        const card = node("section", undefined, "phase2-sidecard");
        card.append(node("h3", title));
        insights.append(card);
        return card;
    }
    function renderScopeInsights() {
        const scopeCard = sidecard("Memory scope");
        scopeCard.append(
            node(
                "strong",
                submitted?.corpusId
                    ? (result?.matches.find(
                          (item) => item.corpusId === submitted?.corpusId,
                      )?.corpusName ?? "Selected collection")
                    : "All memory",
            ),
            node(
                "p",
                `${result?.matches.length ?? 0} returned evidence results. Bounded selection, not a corpus total.`,
            ),
        );
        renderRecent();
        insights.append(recent);
        return scopeCard;
    }
    function renderInsights() {
        insights.replaceChildren();
        const scopeCard = renderScopeInsights();
        if (
            !result ||
            !("insights" in result) ||
            result.insights === undefined
        ) {
            sidecard("Related context").append(
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
                    "Related context scope does not match the submitted query. Browser-memory insights cannot stand in for All memory or a named corpus.",
                );
            if (value.status !== "available") {
                sidecard("Related context").append(
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
            scopeCard.append(
                node(
                    "p",
                    value.provider === "canonical"
                        ? "Canonical typed metadata from a bounded returned-source selection, not corpus-wide statistics."
                        : "Web query insights — fixed Browser memory only.",
                ),
            );
            if (value.message)
                scopeCard.append(
                    node("p", value.message, "phase2-insight-notice"),
                );
            const topicCard = sidecard("Top Topics");
            const topics = node("div", undefined, "phase2-context-list");
            for (const topic of value.topTopics)
                topics.append(
                    Object.assign(queryLink(topic), {
                        className: "phase2-context-item phase2-link",
                    }),
                );
            if (!value.topTopics.length)
                topics.append(
                    node("p", "No topics returned in typed query metadata."),
                );
            topicCard.append(topics);
            const entities = sidecard("Related Entities");
            const grid = node("div", undefined, "phase2-context-list");
            for (const entity of value.relatedEntities) {
                const card = node("div", undefined, "phase2-context-entity");
                const title = queryLink(entity.name);
                title.className = "phase2-context-item phase2-link";
                const meta = [
                    entity.type,
                    preferences?.showConfidenceScores &&
                    entity.confidence !== undefined
                        ? `confidence ${Math.round(entity.confidence * 100)}%`
                        : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                card.append(title, node("small", meta));
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
        } catch (error) {
            const message = node("p");
            insights.append(message);
            report(error, message);
        }
    }
    function renderResult() {
        resultLayout.hidden = !result;
        if (!result) {
            root.insertBefore(recent, resultLayout);
            renderRecent();
            resultPager.hidden = layout.hidden = true;
            return;
        }
        resultPager.hidden = result.matches.length <= pageSize;
        layout.hidden = !result.matches.length;
        const hasWeb = result.matches.some(isMemoryHubWebEvidence);
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
                : ""
            : "";
        const messages = [
            ...result.warnings,
            ...result.matches.flatMap(({ title, synopsis }) =>
                synopsis &&
                (synopsis.status !== "ready" || synopsis.freshness !== "fresh")
                    ? [
                          `${title}: generated description ${synopsis.status} · ${synopsis.freshness}. The description is not shown; captured evidence remains available.`,
                      ]
                    : [],
            ),
            ...(webMode && !hasWeb
                ? [
                      "The preferred web view requires web evidence. Using List for this result.",
                  ]
                : []),
            ...result.errors.map(
                (error) =>
                    `${error.corpusId} · ${error.operation}: ${error.message}`,
            ),
        ];
        hubNotifications.set("search", {
            title: result.errors.length
                ? "Ask or Explain: partial results"
                : "Ask or Explain",
            page: "search",
            context: `Query: ${result.query} · ${submitted?.corpusId ?? "All memory"}`,
            messages,
        });
        status.textContent = `${result.matches.length} returned evidence results (bounded, not a full total)${result.resolvedIntent ? ` · ${result.resolvedIntent === "ask" ? "Answer and sources" : "Find sources"}${submitted?.intent === "auto" ? " (chosen automatically)" : ""}` : ""}${searchElapsedMs === undefined ? "" : ` · Ready in ${(searchElapsedMs / 1000).toFixed(1)}s`}`;
        renderAnswer();
        renderInsights();
        renderResultPage(result, mode);
    }
    function renderResultPage(
        result: MemoryHubSearchResult,
        mode: MemoryHubViewMode,
    ) {
        const pageCount = Math.max(
            1,
            Math.ceil(result.matches.length / pageSize),
        );
        resultPage = Math.min(resultPage, pageCount - 1);
        const start = resultPage * pageSize;
        const pageMatches = result.matches.slice(start, start + pageSize);
        pageStatus.textContent = `Page ${resultPage + 1} of ${pageCount} · ${start + 1}-${start + pageMatches.length} of ${result.matches.length} returned`;
        previousPage.disabled = resultPage === 0;
        nextPage.disabled = resultPage === pageCount - 1;
        results.replaceChildren(
            ...(mode === "timeline" || mode === "domain"
                ? renderMemoryHubWebGroups(pageMatches, mode, evidenceCard)
                : pageMatches.map(evidenceCard)),
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
        if (!text)
            throw new Error("Enter a question or request before continuing.");
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
            intent:
                intent.value === "find"
                    ? "find"
                    : intent.value === "ask"
                      ? "ask"
                      : "auto",
            ...(intent.value === "find" || intent.value === "ask"
                ? { generateAnswer: intent.value === "ask" }
                : {}),
            ...(retrieval.value === "sourcesOnly" ||
            retrieval.value === "sourcesAndViews"
                ? { retrievalPolicy: retrieval.value }
                : {}),
            ...(checkpoint.value.trim()
                ? { knowledgeCheckpointId: checkpoint.value.trim() }
                : {}),
            ...(viewKind.value === "timeline" ||
            viewKind.value === "wiki" ||
            viewKind.value === "projectBrief" ||
            viewKind.value === "troubleshootingGuide" ||
            viewKind.value === "schemaView"
                ? { viewKinds: [viewKind.value] }
                : {}),
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
        const snapshotId = preparedId(request);
        if (snapshotId)
            request = { ...request, evidenceSnapshotId: snapshotId };
        const version = ++searchVersion;
        const queryChanged = submitted?.query !== request.query;
        submitted = request;
        searchElapsedMs = undefined;
        result = undefined;
        resultPage = 0;
        results.replaceChildren();
        insights.replaceChildren();
        renderResult();
        answer.hidden = true;
        hubNotifications.clear("search");
        hubNotifications.clear("search-completion");
        const started = performance.now();
        status.textContent =
            request.intent === "auto"
                ? "Choosing the best response, then finding supporting memory…"
                : request.generateAnswer || request.intent === "ask"
                  ? "Finding evidence and preparing an answer…"
                  : "Finding sources without generating an answer…";
        submit.disabled = true;
        const stopWatching = watchSlowRequest(status, () => {
            searchVersion++;
            submit.disabled = false;
            status.textContent = "Request cancelled. Results were not loaded.";
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
            if (
                request.intent === "auto" &&
                response.resolvedIntent !== "find" &&
                response.resolvedIntent !== "ask"
            )
                throw new Error(
                    "This host does not support automatic response selection. Choose Find or Ask under Filters, or restart the updated service.",
                );
            result = response;
            searchElapsedMs = performance.now() - started;
            saveRecent(request.query);
            renderResult();
            if (
                preferences?.enableNotifications &&
                response.errors.length === 0
            )
                options.onNotify?.(
                    `Ask or Explain completed: ${response.matches.length} returned evidence results.`,
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
        filters.open = false;
        try {
            void search(readRequest());
        } catch (error) {
            report(error, status);
        }
    });
    dialog.addEventListener("close", () => {
        evidenceVersion++;
        explanationPanel.hide();
        if (returnFocus?.isConnected) returnFocus.focus();
        else query.focus();
    });
    const dismissFilters = (event: Event) => {
        if (event.target instanceof Node && !filters.contains(event.target))
            filters.open = false;
    };
    document.addEventListener("click", dismissFilters);
    filters.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            filters.open = false;
            filtersSummary.focus();
            event.preventDefault();
        }
    });
    query.addEventListener("input", renderRecent);
    renderRecent();
    try {
        applyPreferences(getMemoryHubViewPreferences());
    } catch (error) {
        preferenceError(error);
        renderResult();
    }
    return {
        show,
        setUnderstandingEnabled(enabled: boolean) {
            understandingEnabled = enabled && !!options.onUnderstand;
            if (result) renderResult();
        },
        inspect(evidence: MemoryHubEvidence, focus: HTMLElement, owner = root) {
            owner.append(dialog);
            openEvidence(evidence, focus);
        },
        scopeChanged() {
            explanationPanel.scopeChanged();
            if (historyDialog.open) historyDialog.close();
            searchVersion++;
            evidenceVersion++;
            result = undefined;
            resultPage = 0;
            results.replaceChildren();
            insights.replaceChildren();
            renderResult();
            answer.hidden = true;
            hubNotifications.clear("search");
            hubNotifications.clear("search-completion");
            submit.disabled = false;
            status.textContent =
                "Scope changed. Submit your request again to load evidence for this scope.";
            if (dialog.open) dialog.close();
            selectedEvidence = undefined;
            evidencePage = undefined;
            original.textContent = "";
            originalView.replaceChildren();
        },
        dispose() {
            disposed = true;
            searchVersion++;
            evidenceVersion++;
            unsubscribePreferences();
            query.removeEventListener("input", renderRecent);
            document.removeEventListener("click", dismissFilters);
            explanationPanel.dispose();
            if (historyDialog.open) historyDialog.close();
            historyDialog.remove();
            if (dialog.open) dialog.close();
            dialog.remove();
            root.remove();
        },
    };
}
