// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryCenterActivity,
    MemoryCenterActivityFilter,
    MemoryCenterContent,
    MemoryCenterCorpusStatus,
    MemoryCenterForgetPreview,
    MemoryCenterInvokeFunctions,
    MemoryCenterJob,
    MemoryCenterKnowledge,
    MemoryCenterKnowledgeSuppression,
    MemoryCenterPage,
    MemoryCenterSource,
} from "@typeagent/browser-control-rpc/serviceTypes";
import { invokeMemory } from "./viewClient";
import { renderMarkdown } from "./utils/markdownRenderer";
import { renderMermaidIn } from "./utils/mermaidView";
import { renderMathIn } from "./utils/mathView";
import { canEditWysiwyg } from "./utils/wysiwygEligibility";
import { icon, iconButton, setIconButton } from "./memoryHubUi";

const PAGE_SIZE = 25;
const CONTENT_PAGE_SIZE = 12_000;

type MethodName = keyof MemoryCenterInvokeFunctions;
type MethodParams<M extends MethodName> = Parameters<
    MemoryCenterInvokeFunctions[M]
>[0];
type MethodResult<M extends MethodName> = Awaited<
    ReturnType<MemoryCenterInvokeFunctions[M]>
>;

export interface MemoryManagementHost {
    scope(): string | undefined;
    sources(params: {
        query?: string;
        pageSize: number;
        continuationToken?: string;
    }): Promise<MemoryCenterPage<MemoryCenterSource>>;

    corpusName?(corpusId: string): string;
    error?(message: string, offline: boolean): void;
    status?(indexing: boolean): void;
    changed(): Promise<void>;
    openSource(corpusId: string, sourceId: string): void;

    sourceForgotten?(corpusId: string, sourceId: string, title: string): void;
    buildViews?(
        corpusId: string,
        sources: Array<{ sourceId: string; revisionId: string }>,
    ): void | Promise<void>;
}

export function mountMemoryManagement(host: MemoryManagementHost) {
    let requestVersion = 0;

    let sourceLoadVersion = 0;
    let activityLoadVersion = 0;
    let jobLoadVersion = 0;
    let contentLoadVersion = 0;

    async function invoke<M extends MethodName>(
        method: M,
        params: MethodParams<M>,
    ): Promise<MethodResult<M>> {
        if (
            ["memoryImportDocument", "memoryReindexCorpus"].includes(method) &&
            (!host.scope() ||
                (params as { corpusId?: string }).corpusId !== host.scope())
        ) {
            throw new Error(
                "Select the named target corpus before this operation.",
            );
        }
        const version = requestVersion;
        const result = await invokeMemory(method, params);
        if (
            /^memory(Create|Import|Replace|Forget|Reindex|Cancel|Save|Archive|Reject|Update|Suppress|Restore)/.test(
                method,
            )
        ) {
            await host.changed();
        }
        if (version !== requestVersion) throw new Error("Superseded request");
        return result as MethodResult<M>;
    }

    function element<T extends HTMLElement>(id: string): T {
        const value = document.getElementById(id);
        if (!value) {
            throw new Error(`Memory management element '${id}' was not found`);
        }
        return value as T;
    }

    const corpusSelect = element<HTMLSelectElement>("corpusSelect");
    const corpusStatus = element<HTMLDivElement>("corpusStatus");
    const sourceList = element<HTMLDivElement>("sourceList");
    const sourceCount = element<HTMLSpanElement>("sourceCount");
    const buildSelection = new Map<string, MemoryCenterSource>();
    const selectionBar = document.createElement("div");
    selectionBar.className = "hub-source-selection";
    selectionBar.hidden = true;
    const selectionCount = document.createElement("span");
    const buildSelected = document.createElement("button");
    buildSelected.type = "button";
    buildSelected.className = "primary";
    buildSelected.append(icon("fa-plus"), "Build views");
    buildSelected.onclick = () => {
        void run(async () => {
            const selected = [...buildSelection.values()];
            if (!selected.length || !host.buildViews) return;
            await host.buildViews(
                selected[0].corpusId,
                selected.map((source) => ({
                    sourceId: source.sourceId,
                    revisionId: source.activeRevisionId,
                })),
            );
        });
    };
    const clearSelected = document.createElement("button");
    clearSelected.type = "button";
    setIconButton(clearSelected, "fa-xmark", "Clear selection");
    clearSelected.onclick = () => {
        buildSelection.clear();
        renderSources();
    };
    selectionBar.append(selectionCount, buildSelected, clearSelected);
    if (host.buildViews) sourceList.before(selectionBar);
    const sourceTitle = element<HTMLHeadingElement>("sourceTitle");
    const sourceMetadata = element<HTMLDListElement>("sourceMetadata");
    const revisionList = element<HTMLDivElement>("revisionList");
    const contentEditor = element<HTMLTextAreaElement>("contentEditor");
    const contentRange = element<HTMLSpanElement>("contentRange");
    const sourceFilter = element<HTMLInputElement>("sourceFilter");
    const entityList = element<HTMLDivElement>("entityList");
    const topicList = element<HTMLDivElement>("topicList");
    const relationshipList = element<HTMLDivElement>("relationshipList");
    const suppressionList = element<HTMLDivElement>("suppressionList");
    const contentPreview = element<HTMLDivElement>("contentPreview");
    const contentWysiwyg = element<HTMLDivElement>("contentWysiwyg");
    let wysiwyg: { destroy(): Promise<void> } | undefined;
    let wysiwygTicket = 0;
    const jobList = element<HTMLDivElement>("jobList");
    const activityList = element<HTMLDivElement>("activityList");
    const errorBanner = element<HTMLDivElement>("errorBanner");
    const connectionState = element<HTMLDivElement>("connectionState");

    let activeCorpus: MemoryCenterCorpusStatus | undefined;
    let selectedSource: MemoryCenterSource | undefined;
    let sourcePage: MemoryCenterPage<MemoryCenterSource> = {
        items: [],
        total: 0,
    };
    let sourceTokens: Array<string | undefined> = [undefined];
    let sourcePageIndex = 0;
    let contentPage: MemoryCenterContent | undefined;
    let contentOffsets = [0];
    let contentPageIndex = 0;
    let originalPageContent = "";
    let jobPage: MemoryCenterPage<MemoryCenterJob> = { items: [], total: 0 };
    let jobTokens: Array<string | undefined> = [undefined];
    let jobPageIndex = 0;
    let pendingReplacement: string | undefined;
    let pendingForget: MemoryCenterForgetPreview | undefined;
    let forgetting = false;
    let activityPage: MemoryCenterPage<MemoryCenterActivity> = {
        items: [],
        total: 0,
    };
    let activityTokens: Array<string | undefined> = [undefined];
    let activityPageIndex = 0;
    let activityLinkedSourceId: string | undefined;

    let knowledgeSuppressions: MemoryCenterKnowledgeSuppression[] = [];
    let knowledgeCurationAvailable = true;

    function setError(error?: unknown): void {
        if (error === undefined) {
            errorBanner.textContent = "";
            errorBanner.classList.add("hidden");
            return;
        }
        errorBanner.textContent =
            error instanceof Error ? error.message : String(error);
        errorBanner.classList.remove("hidden");
    }

    async function run(action: () => Promise<void>): Promise<void> {
        setError();
        try {
            await action();
            connectionState.textContent = "Connected";
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === "Superseded request"
            )
                return;
            const message =
                error instanceof Error ? error.message : String(error);
            const offline = /unavailable|disconnected|offline|fetch/i.test(
                message,
            );
            host.error?.(message, offline);
            connectionState.textContent =
                /unavailable|disconnected|offline|fetch/i.test(message)
                    ? "Offline"
                    : "Connected · operation failed";
            setError(`Operation failed: ${message}`);
        }
    }

    function appendDefinition(label: string, value: string): void {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        sourceMetadata.append(term, description);
    }

    function appendTextItem(
        parent: HTMLElement,
        text: string,
        className: string,
    ): void {
        const item = document.createElement("div");
        item.className = className;
        item.textContent = text;
        parent.appendChild(item);
    }

    function setEmpty(parent: HTMLElement, message: string): void {
        parent.replaceChildren();
        parent.classList.add("empty");
        parent.textContent = message;
    }

    function resetSourcePaging(): void {
        sourceTokens = [undefined];
        sourcePageIndex = 0;
    }

    function resetJobPaging(): void {
        jobTokens = [undefined];
        jobPageIndex = 0;
    }

    function resetActivityPaging(): void {
        activityTokens = [undefined];
        activityPageIndex = 0;
    }

    function renderCorpora(): void {
        corpusSelect.replaceChildren();
        if (activeCorpus) {
            const option = document.createElement("option");
            option.value = activeCorpus.corpusId;
            option.textContent = `${activeCorpus.name} (${activeCorpus.documentCount})`;
            corpusSelect.appendChild(option);
            corpusSelect.value = activeCorpus.corpusId;
        } else {
            const option = document.createElement("option");
            option.textContent = "No corpora";
            option.disabled = true;
            option.selected = true;
            corpusSelect.appendChild(option);
        }
    }

    function renderCorpusStatus(): void {
        if (!activeCorpus) {
            corpusStatus.textContent = "Create a corpus to get started.";
            return;
        }
        corpusStatus.textContent = [
            activeCorpus.status,
            `${activeCorpus.sourceCount} sources`,
            `${activeCorpus.readyRevisionCount}/${activeCorpus.revisionCount} revisions ready`,
            `${activeCorpus.activeJobCount} active jobs`,
        ].join(" · ");
    }

    function renderSources(): void {
        sourceList.replaceChildren();
        let removedSelection = false;
        for (const source of sourcePage.items) {
            const key = JSON.stringify([source.corpusId, source.sourceId]);
            const previous = buildSelection.get(key);
            if (!previous) continue;
            const ready = source.revisions.some(
                (revision) =>
                    revision.revisionId === source.activeRevisionId &&
                    revision.state === "ready",
            );
            if (
                !ready ||
                previous.activeRevisionId !== source.activeRevisionId
            ) {
                buildSelection.delete(key);
                removedSelection = true;
            } else buildSelection.set(key, source);
        }
        if (removedSelection) {
            errorBanner.textContent =
                "A selected source changed or is no longer ready. Review the selection before building views.";
            errorBanner.hidden = false;
        }
        for (const source of sourcePage.items) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "list-item";
            button.dataset.corpusId = source.corpusId;
            button.dataset.sourceId = source.sourceId;
            if (
                source.sourceId === selectedSource?.sourceId &&
                source.corpusId === selectedSource?.corpusId
            ) {
                button.classList.add("selected");
            }
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = source.title;
            const subtitle = document.createElement("div");
            subtitle.className = "item-subtitle";
            subtitle.textContent = `${source.sourceType} · ${source.revisions.find((revision) => revision.revisionId === source.activeRevisionId)?.state ?? "unknown revision state"} · ${host.corpusName?.(source.corpusId) ?? source.corpusId} · ${source.revisions.length} revision(s)`;
            button.append(title, subtitle);
            appendSourceSynopsis(button, source);
            button.addEventListener("click", () => {
                host.openSource(source.corpusId, source.sourceId);
            });
            if (host.buildViews) {
                const row = document.createElement("div");
                row.className = "hub-selectable-source";
                const selection = document.createElement("input");
                selection.type = "checkbox";
                selection.setAttribute(
                    "aria-label",
                    `Select ${source.title} for a view build`,
                );
                const key = JSON.stringify([source.corpusId, source.sourceId]);
                selection.checked = buildSelection.has(key);
                const ready =
                    source.revisions.find(
                        (revision) =>
                            revision.revisionId === source.activeRevisionId,
                    )?.state === "ready";
                const selectedCorpus = [...buildSelection.values()][0]
                    ?.corpusId;
                selection.disabled =
                    !ready ||
                    (selectedCorpus !== undefined &&
                        selectedCorpus !== source.corpusId) ||
                    (!selection.checked && buildSelection.size >= 32);
                selection.onchange = () => {
                    if (selection.checked) buildSelection.set(key, source);
                    else buildSelection.delete(key);
                    renderSources();
                    sourceList
                        .querySelector<HTMLInputElement>(
                            `[data-selection-key="${encodeURIComponent(key)}"]`,
                        )
                        ?.focus();
                };
                selection.dataset.selectionKey = encodeURIComponent(key);
                row.append(selection, button);
                sourceList.append(row);
            } else sourceList.appendChild(button);
        }
        if (sourcePage.items.length === 0) {
            setEmpty(sourceList, "No sources in this corpus.");
        } else {
            sourceList.classList.remove("empty");
        }
        sourceCount.textContent = `${sourcePage.total} total`;
        selectionBar.hidden = buildSelection.size === 0;
        selectionCount.textContent = `${buildSelection.size} selected`;
        selectionCount.title =
            "Up to 32 sources from one collection per build.";
        element<HTMLSpanElement>("sourcePageLabel").textContent =
            `Page ${sourcePageIndex + 1}`;
        element<HTMLButtonElement>("sourcePrevious").disabled =
            sourcePageIndex === 0;
        element<HTMLButtonElement>("sourceNext").disabled =
            !sourcePage.nextContinuationToken;
    }

    function appendSourceSynopsis(
        button: HTMLElement,
        source: MemoryCenterSource,
    ): void {
        const synopsis = source.revisions.find(
            (revision) => revision.revisionId === source.activeRevisionId,
        )?.synopsis;
        if (!synopsis) return;
        const description = document.createElement("div");
        description.className = "item-subtitle";
        description.textContent =
            synopsis.freshness === "fresh" && synopsis.preview
                ? synopsis.preview
                : `Synopsis ${synopsis.status} · ${synopsis.freshness}`;
        button.append(description);
    }

    function renderSource(): void {
        const hasSource = selectedSource !== undefined;
        element<HTMLButtonElement>("reindexSourceButton").disabled = !hasSource;
        element<HTMLButtonElement>("forgetSourceButton").disabled = !hasSource;
        element<HTMLButtonElement>("replaceSourceButton").disabled = !hasSource;
        element<HTMLButtonElement>("showSourceActivity").disabled = !hasSource;
        contentEditor.disabled = !hasSource;
        sourceMetadata.replaceChildren();
        revisionList.replaceChildren();

        if (!selectedSource) {
            sourceTitle.textContent = "Select a source";
            revisionList.textContent = "No source selected.";
            revisionList.classList.add("empty");
            return;
        }

        sourceTitle.textContent = selectedSource.title;
        appendDefinition(
            "Corpus",
            host.corpusName?.(selectedSource.corpusId) ??
                selectedSource.corpusId,
        );
        appendDefinition("Source ID", selectedSource.sourceId);
        appendDefinition("Type", selectedSource.sourceType);
        appendDefinition("Active revision", selectedSource.activeRevisionId);
        const synopsis = selectedSource.revisions.find(
            (revision) =>
                revision.revisionId === selectedSource!.activeRevisionId,
        )?.synopsis;
        if (synopsis)
            appendDefinition(
                "Generated synopsis",
                `${synopsis.status} · ${synopsis.freshness}${synopsis.reason ? ` · ${synopsis.reason}` : ""}`,
            );
        if (selectedSource.canonicalUri) {
            appendDefinition("URI", selectedSource.canonicalUri);
        }
        if (selectedSource.tags?.length) {
            appendDefinition("Tags", selectedSource.tags.join(", "));
        }
        if (selectedSource.metadata) {
            appendDefinition(
                "Metadata",
                JSON.stringify(selectedSource.metadata),
            );
        }

        revisionList.classList.remove("empty");
        for (const revision of selectedSource.revisions) {
            const indexedAt = revision.indexedAt
                ? new Date(revision.indexedAt).toLocaleString()
                : "not indexed";
            const pipeline = revision.pipeline
                ? ` · ${revision.pipeline.mode}${revision.pipeline.maxCharsPerChunk === undefined ? "" : `, ${revision.pipeline.maxCharsPerChunk} chars/chunk`}`
                : "";
            appendTextItem(
                revisionList,
                `${revision.state} · ${indexedAt}`,
                "revision",
            );
            appendTextItem(
                revisionList,
                `${revision.revisionId} · ${revision.contentHash}${pipeline}`,
                "revision",
            );
        }
    }

    function activityMetadata(
        activity: MemoryCenterActivity,
        key: string,
    ): string | undefined {
        const value = activity.metadata?.[key];
        return typeof value === "string" ? value : undefined;
    }

    function renderActivity(): void {
        activityList.replaceChildren();
        for (const activity of activityPage.items) {
            const card = document.createElement("div");
            card.className = "activity-item";
            appendTextItem(
                card,
                `${activity.eventType} · ${activityMetadata(activity, "title") ?? activityMetadata(activity, "url") ?? "Untitled page"}`,
                "item-title",
            );
            appendTextItem(
                card,
                `${new Date(activity.eventTime).toLocaleString()} · ${activityMetadata(activity, "domain") ?? "unknown domain"} · ${activityMetadata(activity, "source") ?? "browser"}`,
                "item-subtitle",
            );
            const actions = document.createElement("div");
            actions.className = "item-actions hub-row-actions";
            card.classList.add("hub-hover-actions");
            const sourceId = activity.linkedSourceIds?.[0];
            if (sourceId) {
                actions.appendChild(
                    iconButton(
                        "fa-arrow-up-right-from-square",
                        "Open linked page",
                        () => host.openSource(activity.corpusId, sourceId),
                    ),
                );
            }
            const forget = iconButton(
                "fa-regular fa-trash-can",
                "Delete event",
                () => {
                    void run(async () => {
                        if (
                            !confirm(
                                "Delete this web activity event? Source content is not deleted.",
                            )
                        )
                            return;
                        await invoke("memoryForgetActivity", {
                            eventIds: [activity.eventId],
                        });
                        await loadActivity();
                    });
                },
                "danger",
            );
            actions.appendChild(forget);
            card.appendChild(actions);
            activityList.appendChild(card);
        }
        if (activityPage.items.length === 0) {
            setEmpty(activityList, "No matching web activity.");
        } else {
            activityList.classList.remove("empty");
        }
        element<HTMLSpanElement>("activityCount").textContent =
            `${activityPage.total} total`;
        element<HTMLSpanElement>("activityPageLabel").textContent =
            `Page ${activityPageIndex + 1}`;
        element<HTMLButtonElement>("activityPrevious").disabled =
            activityPageIndex === 0;
        element<HTMLButtonElement>("activityNext").disabled =
            !activityPage.nextContinuationToken;
    }

    function optionalInput(id: string): string | undefined {
        const value = element<HTMLInputElement>(id).value.trim();
        return value.length === 0 ? undefined : value;
    }

    function activityFilter(): MemoryCenterActivityFilter {
        const dateFrom = optionalInput("activityFrom");
        const dateTo = optionalInput("activityTo");
        const domain = optionalInput("activityDomain");
        const eventType =
            element<HTMLSelectElement>("activityType").value || undefined;
        const source = optionalInput("activitySource");
        const pageType = optionalInput("activityPageType");
        return {
            ...(dateFrom === undefined
                ? {}
                : { dateFrom: new Date(dateFrom).toISOString() }),
            ...(dateTo === undefined
                ? {}
                : { dateTo: new Date(dateTo).toISOString() }),
            ...(domain === undefined ? {} : { domains: [domain] }),
            ...(eventType === undefined
                ? {}
                : {
                      eventTypes: [
                          eventType as MemoryCenterActivity["eventType"],
                      ],
                  }),
            ...(source === undefined ? {} : { sources: [source] }),
            ...(pageType === undefined ? {} : { pageTypes: [pageType] }),
            ...(activityLinkedSourceId === undefined
                ? {}
                : { sourceIds: [activityLinkedSourceId] }),
        };
    }

    async function loadActivity(): Promise<void> {
        const version = ++activityLoadVersion;
        const result = await invoke("memoryListActivity", {
            ...activityFilter(),
            pageSize: PAGE_SIZE,
            continuationToken: activityTokens[activityPageIndex],
        });
        if (version !== activityLoadVersion) return;
        activityPage = result;
        if (activityPage.nextContinuationToken) {
            activityTokens[activityPageIndex + 1] =
                activityPage.nextContinuationToken;
        }
        renderActivity();
    }

    function renderContent(): void {
        if (!contentPage) {
            contentEditor.value = "";
            originalPageContent = contentEditor.value;
            contentPreview.replaceChildren();
            contentRange.textContent = "";
            element<HTMLButtonElement>("contentPrevious").disabled = true;
            element<HTMLButtonElement>("contentNext").disabled = true;
            return;
        }
        contentEditor.value = contentPage.content;
        // Textareas normalize CRLF and CR line endings to LF.
        originalPageContent = contentEditor.value;
        contentPreview.innerHTML = renderMarkdown(contentPage.content);
        void renderMermaidIn(contentPreview);
        void renderMathIn(contentPreview);
        const end = contentPage.offset + contentPage.content.length;
        contentRange.textContent = `${contentPage.offset + 1}-${end} of ${contentPage.totalChars} characters`;
        element<HTMLButtonElement>("contentPrevious").disabled =
            contentPageIndex === 0;
        element<HTMLButtonElement>("contentNext").disabled =
            contentPage.nextOffset === undefined;
        showContentMode("preview");
    }

    function stopWysiwyg(): void {
        wysiwygTicket++;
        const current = wysiwyg;
        wysiwyg = undefined;
        contentWysiwyg.classList.add("hidden");
        void current?.destroy().then(() => {
            if (!wysiwyg) contentWysiwyg.replaceChildren();
        });
    }

    // Only a single-page Markdown source can be edited visually, because the
    // editor serializes the whole document and replacement text is page-based.
    function wysiwygEligible(): boolean {
        return (
            selectedSource?.sourceType === "markdown" &&
            contentPage !== undefined &&
            contentPage.offset === 0 &&
            contentPage.nextOffset === undefined &&
            !contentEditor.disabled
        );
    }

    async function startWysiwyg(): Promise<void> {
        const ticket = ++wysiwygTicket;
        try {
            const { mountWysiwyg } = await import("./memoryHubWysiwyg");
            if (ticket !== wysiwygTicket) return;
            if (!canEditWysiwyg(contentEditor.value)) {
                contentWysiwyg.classList.add("hidden");
                contentEditor.classList.remove("hidden");
                return;
            }
            contentWysiwyg.replaceChildren();
            contentWysiwyg.classList.remove("hidden");
            contentEditor.classList.add("hidden");
            const instance = await mountWysiwyg(
                contentWysiwyg,
                contentEditor.value,
                (markdown) => {
                    if (markdown === contentEditor.value) return;
                    contentEditor.value = markdown;
                    contentEditor.dispatchEvent(new Event("input"));
                },
            );
            if (ticket !== wysiwygTicket) {
                await instance.destroy();
                return;
            }
            wysiwyg = instance;
        } catch (error) {
            console.warn("Visual Markdown editor unavailable.", error);
            if (ticket !== wysiwygTicket) return;
            contentWysiwyg.classList.add("hidden");
            contentEditor.classList.remove("hidden");
        }
    }

    function showContentMode(mode: "write" | "preview"): void {
        const preview = mode === "preview";
        contentEditor
            .closest(".detail-panel")
            ?.classList.toggle("mode-preview", preview);
        stopWysiwyg();
        if (preview) {
            contentPreview.innerHTML = renderMarkdown(contentEditor.value);
            void renderMermaidIn(contentPreview);
            void renderMathIn(contentPreview);
        }
        contentEditor.classList.toggle("hidden", preview);
        contentPreview.classList.toggle("hidden", !preview);
        if (!preview && wysiwygEligible()) void startWysiwyg();
        for (const [id, active] of [
            ["writeTab", !preview],
            ["previewTab", preview],
        ] as const) {
            const tab = element<HTMLButtonElement>(id);
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", String(active));
        }
    }

    function createKnowledgeChip(
        text: string,
        kind: MemoryCenterKnowledgeSuppression["kind"],
        name: string,
    ): HTMLDivElement {
        const chip = document.createElement("div");
        chip.className = "chip";
        const label = document.createElement("span");
        label.textContent = text;
        chip.appendChild(label);
        if (!knowledgeCurationAvailable) return chip;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-remove";
        remove.textContent = "×";
        remove.title = `Hide ${kind} from this source`;
        remove.setAttribute("aria-label", `Hide ${kind} ${name}`);
        remove.addEventListener("click", () => {
            void run(async () => {
                if (!activeCorpus || !selectedSource) return;
                await invoke("memorySuppressSourceKnowledge", {
                    corpusId: activeCorpus.corpusId,
                    sourceId: selectedSource.sourceId,
                    kind,
                    name,
                });
                await loadSourceKnowledge();
            });
        });
        chip.appendChild(remove);
        return chip;
    }

    function renderSuppressions(): void {
        suppressionList.replaceChildren();
        element<HTMLSpanElement>("suppressionCount").textContent =
            knowledgeSuppressions.length === 0
                ? ""
                : `(${knowledgeSuppressions.length})`;
        for (const suppression of knowledgeSuppressions) {
            const row = document.createElement("div");
            row.className = "revision";
            const label = document.createElement("span");
            label.textContent = `${suppression.name} · ${suppression.kind}`;
            const restore = document.createElement("button");
            restore.type = "button";
            restore.textContent = "Restore";
            restore.addEventListener("click", () => {
                void run(async () => {
                    if (!activeCorpus || !selectedSource) return;
                    await invoke("memoryRestoreSourceKnowledge", {
                        corpusId: activeCorpus.corpusId,
                        sourceId: selectedSource.sourceId,
                        kind: suppression.kind,
                        name: suppression.name,
                    });
                    await loadSourceKnowledge();
                });
            });
            row.append(label, restore);
            suppressionList.appendChild(row);
        }
        if (knowledgeSuppressions.length === 0)
            setEmpty(suppressionList, "None");
        else suppressionList.classList.remove("empty");
    }

    function renderKnowledge(knowledge?: MemoryCenterKnowledge): void {
        if (!knowledge) {
            knowledgeSuppressions = [];
            setEmpty(entityList, "No source selected.");
            setEmpty(topicList, "No source selected.");
            setEmpty(relationshipList, "No source selected.");
            renderSuppressions();
            return;
        }

        entityList.replaceChildren();
        for (const entity of knowledge.entities) {
            entityList.appendChild(
                createKnowledgeChip(
                    `${entity.name} (${entity.types.join(", ") || "entity"}) · ${entity.mentionCount}`,
                    "entity",
                    entity.name,
                ),
            );
        }
        entityList.classList.toggle("empty", knowledge.entities.length === 0);
        if (knowledge.entities.length === 0) entityList.textContent = "None";

        topicList.replaceChildren();
        for (const topic of knowledge.topics) {
            topicList.appendChild(
                createKnowledgeChip(
                    `${topic.name} · ${topic.mentionCount}`,
                    "topic",
                    topic.name,
                ),
            );
        }
        topicList.classList.toggle("empty", knowledge.topics.length === 0);
        if (knowledge.topics.length === 0) topicList.textContent = "None";

        relationshipList.replaceChildren();
        for (const relationship of knowledge.relationships) {
            appendTextItem(
                relationshipList,
                `${relationship.fromEntity} → ${relationship.relationshipType} → ${relationship.toEntity} (${relationship.count})`,
                "revision",
            );
        }
        relationshipList.classList.toggle(
            "empty",
            knowledge.relationships.length === 0,
        );
        if (knowledge.relationships.length === 0) {
            relationshipList.textContent = "None";
        }
        renderSuppressions();
    }

    async function loadSourceKnowledge(): Promise<void> {
        if (!activeCorpus || !selectedSource) return;
        const params = {
            corpusId: activeCorpus.corpusId,
            sourceId: selectedSource.sourceId,
        };
        const knowledge = await invoke("memoryGetSourceKnowledge", params);
        try {
            knowledgeSuppressions = await invoke(
                "memoryListSourceKnowledgeSuppressions",
                params,
            );
            knowledgeCurationAvailable = true;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            if (
                !message.includes(
                    "No invoke handler memoryListSourceKnowledgeSuppressions",
                ) &&
                !message.includes("Knowledge curation is unavailable")
            ) {
                throw error;
            }
            knowledgeSuppressions = [];
            knowledgeCurationAvailable = false;
        }
        renderKnowledge(knowledge);
    }

    function canCancel(job: MemoryCenterJob): boolean {
        return !["complete", "partial", "failed", "cancelled"].includes(
            job.state,
        );
    }

    function renderJobs(): void {
        jobList.replaceChildren();
        for (const job of jobPage.items) {
            const card = document.createElement("div");
            card.className = "job";
            appendTextItem(
                card,
                `${job.state} · ${job.progress.completed}/${job.progress.total ?? "?"}`,
                "job-state",
            );
            appendTextItem(
                card,
                `${host.corpusName?.(job.corpusId) ?? job.corpusId} · ${job.progress.stage ?? job.state}`,
                "item-subtitle",
            );
            if (job.progress.message) {
                appendTextItem(card, job.progress.message, "item-subtitle");
            }
            if (job.error) appendTextItem(card, job.error, "job-error");
            for (const warning of job.warnings) {
                appendTextItem(card, warning, "job-warning");
            }
            if (canCancel(job)) {
                card.appendChild(
                    iconButton("fa-ban", "Cancel job", () => {
                        void run(async () => {
                            await invoke("memoryCancelJob", {
                                jobId: job.jobId,
                            });
                            await loadJobs();
                        });
                    }),
                );
            }
            jobList.appendChild(card);
        }
        if (jobPage.items.length === 0) setEmpty(jobList, "No jobs.");
        else jobList.classList.remove("empty");
        element<HTMLSpanElement>("jobPageLabel").textContent =
            `Page ${jobPageIndex + 1} · ${jobPage.total} total`;
        element<HTMLButtonElement>("jobPrevious").disabled = jobPageIndex === 0;
        element<HTMLButtonElement>("jobNext").disabled =
            !jobPage.nextContinuationToken;
        host.status?.(
            jobPage.items.some(canCancel) ||
                Boolean(
                    host.scope() === activeCorpus?.corpusId &&
                        activeCorpus?.activeJobCount,
                ),
        );
    }

    async function selectCorpus(corpusId: string): Promise<void> {
        if (!discardChanges()) return;
        requestVersion++;
        activeCorpus = undefined;
        selectedSource = undefined;

        contentPage = undefined;

        renderSource();
        renderContent();

        activeCorpus = corpusId
            ? await invoke("memoryGetCorpus", { corpusId })
            : undefined;

        selectedSource = undefined;
        contentPage = undefined;
        resetSourcePaging();
        resetJobPaging();
        resetActivityPaging();
        renderCorpora();
        renderCorpusStatus();
        renderSource();
        renderContent();
        renderKnowledge();
        await Promise.all([loadSources(), loadJobs(), loadActivity()]);
    }

    async function loadSources(): Promise<void> {
        const params = {
            pageSize: PAGE_SIZE,
            continuationToken: sourceTokens[sourcePageIndex],
            ...(sourceFilter.value.trim()
                ? { query: sourceFilter.value.trim() }
                : {}),
        };
        const version = ++sourceLoadVersion;
        const scopeVersion = requestVersion;
        const result = await host.sources(params);
        if (version !== sourceLoadVersion || scopeVersion !== requestVersion)
            return;
        sourcePage = result;
        if (sourcePage.nextContinuationToken) {
            sourceTokens[sourcePageIndex + 1] =
                sourcePage.nextContinuationToken;
        }
        renderSources();
    }

    async function selectSource(sourceId: string): Promise<void> {
        if (!activeCorpus) return;
        if (!discardChanges()) return;
        requestVersion++;
        const corpusId = activeCorpus.corpusId;
        selectedSource = undefined;
        contentPage = undefined;
        renderSource();
        renderContent();
        selectedSource = await invoke("memoryGetSource", {
            corpusId,
            sourceId,
        });
        if (!selectedSource) {
            throw new Error(`Source '${sourceId}' no longer exists`);
        }
        contentOffsets = [0];
        contentPageIndex = 0;
        showContentMode("write");
        renderSources();
        renderSource();
        contentPage = await invoke("memoryGetSourceContent", {
            corpusId,
            sourceId,
            revisionId: selectedSource.activeRevisionId,
            offset: 0,
            maxChars: CONTENT_PAGE_SIZE,
        });
        renderContent();
        await loadSourceSynopsis(
            corpusId,
            sourceId,
            selectedSource.activeRevisionId,
        );
    }

    async function loadSourceSynopsis(
        corpusId: string,
        sourceId: string,
        revisionId: string,
    ): Promise<void> {
        if (
            !selectedSource?.revisions.find(
                (revision) => revision.revisionId === revisionId,
            )?.synopsis
        )
            return;
        const version = requestVersion;
        try {
            const synopsis = await invoke("memoryGetSourceSynopsis", {
                corpusId,
                sourceId,
                revisionId,
            });
            if (version !== requestVersion) return;
            if (synopsis.freshness === "fresh" && synopsis.overview)
                appendDefinition(
                    "Source overview (generated)",
                    synopsis.overview,
                );
            appendDefinition(
                "Synopsis provenance",
                `Retained revision ${synopsis.revisionId}; generated v${synopsis.generatedVersion}; ${synopsis.recipe}; ${synopsis.coverage.method}; scanned ${synopsis.coverage.scannedChars}/${synopsis.coverage.totalChars} UTF-16 characters`,
            );
            appendDefinition(
                "Synopsis limitations",
                synopsis.limitations.join(" "),
            );
            for (const evidence of synopsis.evidence)
                appendDefinition(
                    `Original retained UTF-16 ${evidence.start}-${evidence.end} (not indexed locator)`,
                    evidence.excerpt,
                );
        } catch (error) {
            if (version === requestVersion)
                appendDefinition(
                    "Synopsis unavailable",
                    error instanceof Error ? error.message : String(error),
                );
        }
    }

    async function loadContentPage(offset: number): Promise<void> {
        if (!activeCorpus || !selectedSource) return;
        const version = ++contentLoadVersion;
        const result = await invoke("memoryGetSourceContent", {
            corpusId: activeCorpus.corpusId,
            sourceId: selectedSource.sourceId,
            revisionId: selectedSource.activeRevisionId,
            offset,
            maxChars: CONTENT_PAGE_SIZE,
        });
        if (version !== contentLoadVersion) return;
        contentPage = result;
        renderContent();
    }

    async function loadJobs(): Promise<void> {
        const version = ++jobLoadVersion;
        const result = await invoke("memoryListJobs", {
            corpusId: host.scope(),
            pageSize: PAGE_SIZE,
            continuationToken: jobTokens[jobPageIndex],
        });
        if (version !== jobLoadVersion) return;
        jobPage = result;
        if (jobPage.nextContinuationToken) {
            jobTokens[jobPageIndex + 1] = jobPage.nextContinuationToken;
        }
        renderJobs();
    }

    async function collectReplacementText(): Promise<string> {
        if (!activeCorpus || !selectedSource || !contentPage) {
            throw new Error("Select a source before replacing it");
        }
        if (contentPage.totalChars === 0) {
            return contentEditor.value;
        }
        const pieces: string[] = [];
        let offset = 0;
        while (offset < contentPage.totalChars) {
            const page =
                offset === contentPage.offset
                    ? contentPage
                    : await invoke("memoryGetSourceContent", {
                          corpusId: activeCorpus.corpusId,
                          sourceId: selectedSource.sourceId,
                          revisionId: selectedSource.activeRevisionId,
                          offset,
                          maxChars: CONTENT_PAGE_SIZE,
                      });
            pieces.push(
                offset === contentPage.offset
                    ? contentEditor.value
                    : page.content,
            );
            if (page.nextOffset === undefined || page.nextOffset <= offset)
                break;
            offset = page.nextOffset;
        }
        return pieces.join("");
    }

    async function refreshActiveCorpus(): Promise<void> {
        if (!discardChanges()) return;
        if (!activeCorpus) {
            await Promise.all([loadSources(), loadJobs(), loadActivity()]);
            return;
        }
        const corpusId = activeCorpus.corpusId;
        const sourceId = selectedSource?.sourceId;
        activeCorpus = await invoke("memoryGetCorpus", { corpusId });
        renderCorpusStatus();
        resetSourcePaging();
        resetJobPaging();
        resetActivityPaging();
        await Promise.all([loadSources(), loadJobs(), loadActivity()]);
        if (sourceId) {
            await selectSource(sourceId);
        }
    }

    function dialog(id: string): HTMLDialogElement {
        return element<HTMLDialogElement>(id);
    }

    dialog("replaceDialog").addEventListener("close", () => {
        pendingReplacement = undefined;
        element<HTMLPreElement>("replacePreview").textContent = "";
    });
    dialog("forgetDialog").addEventListener("close", () => {
        pendingForget = undefined;
        element<HTMLDivElement>("forgetPreview").replaceChildren();
        element<HTMLParagraphElement>("forgetStatus").textContent = "";
    });
    dialog("forgetDialog").addEventListener("cancel", (event) => {
        if (forgetting) event.preventDefault();
    });

    element<HTMLButtonElement>("refreshButton").addEventListener(
        "click",
        () => {
            void run(refreshActiveCorpus);
        },
    );
    element<HTMLButtonElement>("refreshJobsButton").addEventListener(
        "click",
        () => {
            void run(loadJobs);
        },
    );
    element<HTMLButtonElement>("writeTab").addEventListener("click", () =>
        showContentMode("write"),
    );
    element<HTMLButtonElement>("previewTab").addEventListener("click", () =>
        showContentMode("preview"),
    );
    corpusSelect.addEventListener("change", () => {
        void run(() => selectCorpus(corpusSelect.value));
    });
    element<HTMLButtonElement>("createCorpusButton").addEventListener(
        "click",
        () => {
            dialog("createCorpusDialog").showModal();
        },
    );
    element<HTMLFormElement>("createCorpusForm").addEventListener(
        "submit",
        (event) => {
            event.preventDefault();
            void run(async () => {
                const name =
                    element<HTMLInputElement>("corpusName").value.trim();
                const description =
                    element<HTMLTextAreaElement>(
                        "corpusDescription",
                    ).value.trim();
                await invoke("memoryCreateCorpus", {
                    name,
                    description: description || undefined,
                });
                dialog("createCorpusDialog").close();
                element<HTMLFormElement>("createCorpusForm").reset();
                await selectCorpus(host.scope() ?? "");
            });
        },
    );
    element<HTMLButtonElement>("importDocumentButton").addEventListener(
        "click",
        () => {
            dialog("importDocumentDialog").showModal();
        },
    );
    element<HTMLFormElement>("importDocumentForm").addEventListener(
        "submit",
        (event) => {
            event.preventDefault();
            void run(async () => {
                if (!activeCorpus) return;
                const title =
                    element<HTMLInputElement>("importTitle").value.trim();
                const markdown =
                    element<HTMLTextAreaElement>("importMarkdown").value;
                const canonicalUri =
                    element<HTMLInputElement>("importUri").value.trim();
                const tags = element<HTMLInputElement>("importTags")
                    .value.split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean);
                await invoke("memoryImportDocument", {
                    corpusId: activeCorpus.corpusId,
                    title,
                    markdown,
                    ...(canonicalUri ? { canonicalUri } : {}),
                    ...(tags.length > 0 ? { tags } : {}),
                });
                dialog("importDocumentDialog").close();
                element<HTMLFormElement>("importDocumentForm").reset();
                await refreshActiveCorpus();
            });
        },
    );

    document
        .querySelectorAll<HTMLElement>("[data-close-dialog]")
        .forEach((button) => {
            button.addEventListener("click", () => {
                dialog(button.dataset.closeDialog ?? "").close();
            });
        });

    element<HTMLButtonElement>("sourcePrevious").addEventListener(
        "click",
        () => {
            if (sourcePageIndex === 0) return;
            sourcePageIndex -= 1;
            void run(loadSources);
        },
    );
    element<HTMLButtonElement>("sourceNext").addEventListener("click", () => {
        if (!sourcePage.nextContinuationToken) return;
        sourcePageIndex += 1;
        void run(loadSources);
    });
    async function applySourceFilter(): Promise<void> {
        sourcePageIndex = 0;
        sourceTokens = [undefined];
        await loadSources();
    }
    element<HTMLButtonElement>("applySourceFilter").addEventListener(
        "click",
        () => {
            void run(applySourceFilter);
        },
    );
    sourceFilter.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void run(applySourceFilter);
        }
    });
    element<HTMLButtonElement>("jobPrevious").addEventListener("click", () => {
        if (jobPageIndex === 0) return;
        jobPageIndex -= 1;
        void run(loadJobs);
    });
    element<HTMLButtonElement>("jobNext").addEventListener("click", () => {
        if (!jobPage.nextContinuationToken) return;
        jobPageIndex += 1;
        void run(loadJobs);
    });
    element<HTMLButtonElement>("activityPrevious").addEventListener(
        "click",
        () => {
            if (activityPageIndex === 0) return;
            activityPageIndex -= 1;
            void run(loadActivity);
        },
    );
    element<HTMLButtonElement>("activityNext").addEventListener("click", () => {
        if (!activityPage.nextContinuationToken) return;
        activityPageIndex += 1;
        void run(loadActivity);
    });
    element<HTMLButtonElement>("applyActivityFilter").addEventListener(
        "click",
        () => {
            activityLinkedSourceId = undefined;
            resetActivityPaging();
            void run(loadActivity);
        },
    );
    element<HTMLButtonElement>("showSourceActivity").addEventListener(
        "click",
        () => {
            if (!selectedSource) return;
            activityLinkedSourceId = selectedSource.sourceId;
            resetActivityPaging();
            void run(loadActivity);
        },
    );
    element<HTMLButtonElement>("forgetActivity").addEventListener(
        "click",
        () => {
            void run(async () => {
                const filter = activityFilter();
                if (
                    filter.dateFrom === undefined &&
                    filter.dateTo === undefined &&
                    filter.domains === undefined
                ) {
                    throw new Error(
                        "Choose a domain or time range before deleting matching events",
                    );
                }
                if (
                    !confirm(
                        "Delete matching web activity events? Source content is not deleted.",
                    )
                )
                    return;
                await invoke("memoryForgetActivity", filter);
                resetActivityPaging();
                await loadActivity();
            });
        },
    );
    element<HTMLButtonElement>("contentPrevious").addEventListener(
        "click",
        () => {
            if (!discardChanges()) return;
            if (contentPageIndex === 0) return;
            contentPageIndex -= 1;
            void run(() => loadContentPage(contentOffsets[contentPageIndex]));
        },
    );
    element<HTMLButtonElement>("contentNext").addEventListener("click", () => {
        if (!discardChanges()) return;
        if (contentPage?.nextOffset === undefined) return;
        contentPageIndex += 1;
        contentOffsets[contentPageIndex] = contentPage.nextOffset;
        void run(() => loadContentPage(contentOffsets[contentPageIndex]));
    });

    element<HTMLButtonElement>("replaceSourceButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                pendingReplacement = await collectReplacementText();
                const delta =
                    pendingReplacement.length - contentPage!.totalChars;
                element<HTMLParagraphElement>("replaceSummary").textContent =
                    `In ${activeCorpus!.name}, replace "${selectedSource!.title}" revision ${selectedSource!.activeRevisionId} with ${pendingReplacement.length} characters (${delta >= 0 ? "+" : ""}${delta})?`;
                const preview =
                    pendingReplacement.length > 2_000
                        ? `${pendingReplacement.slice(0, 2_000)}\n\n[Preview limited to 2,000 characters]`
                        : pendingReplacement;
                element<HTMLPreElement>("replacePreview").textContent = preview;
                dialog("replaceDialog").showModal();
            });
        },
    );
    element<HTMLButtonElement>("confirmReplaceButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (
                    !activeCorpus ||
                    !selectedSource ||
                    pendingReplacement === undefined
                )
                    return;
                await invoke("memoryReplaceSource", {
                    corpusId: activeCorpus.corpusId,
                    sourceId: selectedSource.sourceId,
                    expectedActiveRevisionId: selectedSource.activeRevisionId,
                    text: pendingReplacement,
                    retainRevisionHistory:
                        element<HTMLInputElement>("retainHistory").checked,
                });
                pendingReplacement = undefined;
                originalPageContent = contentEditor.value;
                dialog("replaceDialog").close();
                await refreshActiveCorpus();
            });
        },
    );

    element<HTMLButtonElement>("forgetSourceButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!activeCorpus || !selectedSource) return;
                pendingForget = await invoke("memoryPreviewForgetSource", {
                    corpusId: activeCorpus.corpusId,
                    sourceId: selectedSource.sourceId,
                });
                const preview = element<HTMLDivElement>("forgetPreview");
                preview.replaceChildren();
                appendTextItem(
                    preview,
                    `Collection: ${activeCorpus.name}. Source revisions and derived knowledge will be removed.`,
                    "",
                );
                appendTextItem(
                    preview,
                    `${pendingForget.revisionCount} revision(s), ${pendingForget.derivedEntityCount} entities, ${pendingForget.derivedTopicCount} topics, and ${pendingForget.derivedRelationshipCount} relationships will be removed.`,
                    "",
                );
                appendTextItem(
                    preview,
                    `Confirmation expires ${new Date(pendingForget.expiresAt).toLocaleString()}.`,
                    "item-subtitle",
                );
                element<HTMLParagraphElement>("forgetStatus").textContent = "";
                element<HTMLButtonElement>("confirmForgetButton").disabled =
                    false;
                dialog("forgetDialog").showModal();
            });
        },
    );
    element<HTMLButtonElement>("confirmForgetButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (forgetting) return;
                const confirmation = pendingForget;
                const status = element<HTMLParagraphElement>("forgetStatus");
                if (!confirmation) {
                    status.textContent =
                        "Reopen Forget source to obtain a new confirmation.";
                    throw new Error(status.textContent);
                }
                const title = selectedSource?.title ?? confirmation.sourceId;
                const confirm = element<HTMLButtonElement>(
                    "confirmForgetButton",
                );
                const cancel = dialog(
                    "forgetDialog",
                ).querySelector<HTMLButtonElement>("[data-close-dialog]")!;
                forgetting = true;
                let forgotten = false;
                confirm.disabled = true;
                cancel.disabled = true;
                confirm.textContent = "Forgetting...";
                dialog("forgetDialog").setAttribute("aria-busy", "true");
                status.textContent =
                    "Forgetting source and rebuilding the corpus index. This may take a while and cannot be cancelled once started.";
                try {
                    await invokeMemory("memoryForgetSource", {
                        corpusId: confirmation.corpusId,
                        sourceId: confirmation.sourceId,
                        confirmationToken: confirmation.confirmationToken,
                    });
                    forgotten = true;
                    pendingForget = undefined;
                    selectedSource = undefined;
                    contentPage = undefined;
                    renderSource();
                    renderContent();
                    renderKnowledge();
                    status.textContent =
                        "Source forgotten. Refreshing memory...";
                    await host.changed();
                    await refreshActiveCorpus();
                    dialog("forgetDialog").close();
                    host.sourceForgotten?.(
                        confirmation.corpusId,
                        confirmation.sourceId,
                        title,
                    );
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    status.textContent = `${forgotten ? "Source forgotten, but refresh failed" : "Could not forget source"}: ${message}`;
                    throw error;
                } finally {
                    forgetting = false;
                    confirm.disabled = forgotten;
                    cancel.disabled = false;
                    confirm.textContent = "Forget source";
                    dialog("forgetDialog").removeAttribute("aria-busy");
                }
            });
        },
    );

    element<HTMLButtonElement>("reindexCorpusButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!activeCorpus) return;
                await invoke("memoryReindexCorpus", {
                    corpusId: activeCorpus.corpusId,
                });
                await refreshActiveCorpus();
            });
        },
    );
    element<HTMLButtonElement>("reindexSourceButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!activeCorpus || !selectedSource) return;
                await invoke("memoryReindexSource", {
                    corpusId: activeCorpus.corpusId,
                    sourceId: selectedSource.sourceId,
                });
                await refreshActiveCorpus();
            });
        },
    );

    contentEditor.addEventListener("input", () => {
        element<HTMLButtonElement>("replaceSourceButton").disabled =
            !selectedSource || contentEditor.value === originalPageContent;
    });

    function hasUnsavedChanges(): boolean {
        return (
            !contentEditor.disabled &&
            contentEditor.value !== originalPageContent
        );
    }

    function discardChanges(): boolean {
        if (!hasUnsavedChanges()) return true;
        if (document.querySelector("dialog[open]")) return false;
        if (!confirm("Discard unsaved source edits?")) return false;
        contentEditor.value = originalPageContent;

        return true;
    }
    window.addEventListener("beforeunload", (event) => {
        if (forgetting || hasUnsavedChanges()) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    return {
        selectCorpus,
        selectSource,
        refresh: refreshActiveCorpus,
        clearBuildSelection(): void {
            buildSelection.clear();
            renderSources();
        },
        discardChanges,
        loadSourceKnowledge,
        focusSource(corpusId: string, sourceId: string): boolean {
            const row = Array.from(
                sourceList.querySelectorAll<HTMLButtonElement>("button"),
            ).find(
                (button) =>
                    button.dataset.corpusId === corpusId &&
                    button.dataset.sourceId === sourceId,
            );
            row?.focus();
            return row !== undefined;
        },
    };
}
