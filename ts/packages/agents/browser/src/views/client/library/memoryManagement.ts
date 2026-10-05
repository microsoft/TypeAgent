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
    MemoryCenterHowToSettings,
    MemoryCenterProcedureCandidate,
    MemoryCenterProcedureSummary,
    MemoryCenterProcedureVersion,
    MemoryCenterSource,
} from "@typeagent/browser-control-rpc/serviceTypes";
import { invokeMemory } from "./viewClient";
import { renderMarkdown } from "./utils/markdownRenderer";
import { renderMermaidIn } from "./utils/mermaidView";
import { renderMathIn } from "./utils/mathView";
import { canEditWysiwyg } from "./utils/wysiwygEligibility";
import { iconButton } from "./memoryHubUi";

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
    procedures(query: string): MemoryCenterProcedureSummary[];
    corpusName?(corpusId: string): string;
    error?(message: string, offline: boolean): void;
    status?(indexing: boolean): void;
    changed(): Promise<void>;
    openSource(corpusId: string, sourceId: string): void;
    openProcedure(corpusId: string, procedureId: string): void;
}

export function mountMemoryManagement(host: MemoryManagementHost) {
    let requestVersion = 0;
    let originalProcedureContent = "";
    let originalSettingsContent = "";
    let sourceLoadVersion = 0;
    let activityLoadVersion = 0;
    let jobLoadVersion = 0;
    let contentLoadVersion = 0;
    let howToLoadVersion = 0;
    let candidateId: string | undefined;

    async function invoke<M extends MethodName>(
        method: M,
        params: MethodParams<M>,
    ): Promise<MethodResult<M>> {
        if (
            [
                "memoryImportDocument",
                "memoryUpdateHowToSettings",
                "memoryReindexCorpus",
            ].includes(method) &&
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
    const candidateList = element<HTMLDivElement>("candidateList");
    const procedureList = element<HTMLDivElement>("procedureList");
    const procedureEditor = element<HTMLTextAreaElement>("procedureEditor");
    const procedureSearch = element<HTMLInputElement>("procedureSearch");

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
    let activityPage: MemoryCenterPage<MemoryCenterActivity> = {
        items: [],
        total: 0,
    };
    let activityTokens: Array<string | undefined> = [undefined];
    let activityPageIndex = 0;
    let activityLinkedSourceId: string | undefined;
    let howToSettings: MemoryCenterHowToSettings | undefined;
    let procedureCandidates: MemoryCenterProcedureCandidate[] = [];
    let procedures: MemoryCenterProcedureSummary[] = [];
    let selectedProcedure: MemoryCenterProcedureVersion | undefined;
    let isNewProcedure = false;
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
            button.addEventListener("click", () => {
                host.openSource(source.corpusId, source.sourceId);
            });
            sourceList.appendChild(button);
        }
        if (sourcePage.items.length === 0) {
            setEmpty(sourceList, "No sources in this corpus.");
        } else {
            sourceList.classList.remove("empty");
        }
        sourceCount.textContent = `${sourcePage.total} total`;
        element<HTMLSpanElement>("sourcePageLabel").textContent =
            `Page ${sourcePageIndex + 1}`;
        element<HTMLButtonElement>("sourcePrevious").disabled =
            sourcePageIndex === 0;
        element<HTMLButtonElement>("sourceNext").disabled =
            !sourcePage.nextContinuationToken;
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
            contentPreview.replaceChildren();
            contentRange.textContent = "";
            element<HTMLButtonElement>("contentPrevious").disabled = true;
            element<HTMLButtonElement>("contentNext").disabled = true;
            return;
        }
        originalPageContent = contentPage.content;
        contentEditor.value = contentPage.content;
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

    function renderHowToSettings(): void {
        const enabled = activeCorpus !== undefined;
        element<HTMLInputElement>("howToEnabled").disabled = !enabled;
        element<HTMLInputElement>("detectCandidates").disabled = !enabled;
        element<HTMLTextAreaElement>("howToInstructions").disabled = !enabled;
        element<HTMLButtonElement>("saveHowToSettings").disabled = !enabled;
        element<HTMLButtonElement>("newProcedureButton").disabled = !enabled;
        element<HTMLButtonElement>("importDocumentButton").disabled = !enabled;
        if (!howToSettings) {
            element<HTMLInputElement>("howToEnabled").checked = false;
            element<HTMLInputElement>("detectCandidates").checked = false;
            element<HTMLTextAreaElement>("howToInstructions").value = "";
            originalSettingsContent = settingsContent();
            return;
        }
        element<HTMLInputElement>("howToEnabled").checked =
            howToSettings.enabled;
        element<HTMLInputElement>("detectCandidates").checked =
            howToSettings.detectCandidates;
        const instructions = howToSettings.preferences?.instructions;
        element<HTMLTextAreaElement>("howToInstructions").value =
            typeof instructions === "string" ? instructions : "";
        originalSettingsContent = settingsContent();
    }

    function renderProcedureCandidates(): void {
        candidateList.replaceChildren();
        for (const candidate of procedureCandidates) {
            const item = document.createElement("div");
            item.className = "list-item";
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = candidate.title;
            const subtitle = document.createElement("div");
            subtitle.className = "item-subtitle";
            subtitle.textContent = `${candidate.state} · ${candidate.steps.length} step(s)`;
            const actions = document.createElement("div");
            actions.className = "item-actions";
            const save = document.createElement("button");
            save.type = "button";
            save.textContent = "Save";
            const errorMessage = document.createElement("div");
            errorMessage.className = "job-error";
            errorMessage.setAttribute("role", "alert");
            save.addEventListener("click", () => {
                void run(async () => {
                    save.disabled = true;
                    errorMessage.textContent = "";
                    try {
                        const version = await invoke("memorySaveProcedure", {
                            corpusId: candidate.corpusId,
                            candidateId: candidate.candidateId,
                        });
                        selectedProcedure = version;
                        isNewProcedure = false;
                        await loadHowTos();
                        procedureList
                            .querySelector<HTMLButtonElement>("button.selected")
                            ?.focus();
                    } catch (error) {
                        errorMessage.textContent =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        throw error;
                    } finally {
                        save.disabled = false;
                    }
                });
            });
            const reject = document.createElement("button");
            reject.type = "button";
            reject.textContent = "Reject";
            reject.addEventListener("click", () => {
                void run(async () => {
                    await invoke("memoryRejectProcedureCandidate", {
                        corpusId: candidate.corpusId,
                        candidateId: candidate.candidateId,
                    });
                    await loadHowTos();
                });
            });
            actions.append(save, reject);
            item.append(title, subtitle, actions, errorMessage);
            candidateList.appendChild(item);
        }
        element<HTMLSpanElement>("candidateCount").textContent =
            `${procedureCandidates.length} pending`;
        if (procedureCandidates.length === 0) {
            setEmpty(candidateList, "No procedure candidates.");
        } else {
            candidateList.classList.remove("empty");
        }
    }

    function renderProcedures(): void {
        procedureList.replaceChildren();
        for (const procedure of procedures) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "list-item";
            if (procedure.procedureId === selectedProcedure?.procedureId) {
                button.classList.add("selected");
            }
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = procedure.title;
            const subtitle = document.createElement("div");
            subtitle.className = "item-subtitle";
            subtitle.textContent = `How-to · ${procedure.state} · version ${procedure.latestVersion} · ${host.corpusName?.(procedure.corpusId) ?? procedure.corpusId}`;
            button.append(title, subtitle);
            button.addEventListener("click", () => {
                host.openProcedure(procedure.corpusId, procedure.procedureId);
            });
            procedureList.appendChild(button);
        }
        element<HTMLSpanElement>("procedureCount").textContent =
            `${procedures.length} result(s)`;
        if (procedures.length === 0) {
            setEmpty(procedureList, "No saved procedures.");
        } else {
            procedureList.classList.remove("empty");
        }
    }

    function renderProcedureEditor(): void {
        const hasEditor = selectedProcedure !== undefined || isNewProcedure;
        procedureEditor.disabled = !hasEditor;
        element<HTMLButtonElement>("saveProcedureButton").disabled = !hasEditor;
        element<HTMLButtonElement>("archiveProcedureButton").disabled =
            selectedProcedure === undefined ||
            selectedProcedure.state === "archived";
        if (selectedProcedure) {
            element<HTMLHeadingElement>("procedureTitle").textContent =
                selectedProcedure.document.title;
            element<HTMLDivElement>("procedureMetadata").textContent =
                `${selectedProcedure.state} · version ${selectedProcedure.version} · ${selectedProcedure.document.citations.length} source citation(s)`;
            procedureEditor.value = selectedProcedure.markdown;
        } else if (!isNewProcedure) {
            element<HTMLHeadingElement>("procedureTitle").textContent =
                "Select a procedure";
            element<HTMLDivElement>("procedureMetadata").textContent = "";
            procedureEditor.value = "";
        }
        originalProcedureContent = procedureEditor.value;
    }

    async function loadHowTos(): Promise<void> {
        const version = ++howToLoadVersion;
        if (!activeCorpus) {
            howToSettings = undefined;
            procedureCandidates = [];
            procedures = host.procedures(procedureSearch.value.trim());
            selectedProcedure = undefined;
            isNewProcedure = false;
            renderHowToSettings();
            renderProcedureCandidates();
            renderProcedures();
            renderProcedureEditor();
            return;
        }
        const corpusId = activeCorpus.corpusId;
        const query = procedureSearch.value.trim();
        const [settings, candidates, procedureResults] = await Promise.all([
            invoke("memoryGetHowToSettings", { corpusId }),
            invoke("memoryListProcedureCandidates", {
                corpusId,
                states: ["detected", "draft"],
            }),
            query
                ? invoke("memorySearchProcedures", {
                      corpusId,
                      query,
                      states: ["saved", "stale"],
                      limit: 50,
                  }).then((matches) => matches.map((match) => match.procedure))
                : invoke("memoryListProcedures", {
                      corpusId,
                      states: ["saved", "stale"],
                  }),
        ]);
        if (version !== howToLoadVersion) return;
        howToSettings = settings;
        procedureCandidates = candidates;
        procedures = procedureResults;
        if (
            selectedProcedure &&
            selectedProcedure.corpusId === corpusId &&
            procedures.some(
                (item) => item.procedureId === selectedProcedure?.procedureId,
            )
        ) {
            selectedProcedure = await invoke("memoryGetProcedure", {
                corpusId,
                procedureId: selectedProcedure.procedureId,
            });
        } else if (!isNewProcedure) {
            selectedProcedure = undefined;
        }
        renderHowToSettings();
        renderProcedureCandidates();
        renderProcedures();
        renderProcedureEditor();
    }

    async function selectProcedure(procedureId: string): Promise<void> {
        if (!activeCorpus) return;
        if (!discardChanges()) return;
        requestVersion++;
        candidateId = undefined;
        selectedProcedure = undefined;
        isNewProcedure = false;
        renderProcedureEditor();
        selectedProcedure = await invoke("memoryGetProcedure", {
            corpusId: activeCorpus.corpusId,
            procedureId,
        });
        if (!selectedProcedure) {
            throw new Error(`Procedure '${procedureId}' no longer exists`);
        }
        isNewProcedure = false;
        renderProcedures();
        renderProcedureEditor();
    }

    async function selectCorpus(corpusId: string): Promise<void> {
        if (!discardChanges()) return;
        requestVersion++;
        activeCorpus = undefined;
        selectedSource = undefined;
        selectedProcedure = undefined;
        contentPage = undefined;
        howToSettings = undefined;
        isNewProcedure = false;
        renderSource();
        renderContent();
        renderProcedureEditor();
        renderHowToSettings();
        activeCorpus = corpusId
            ? await invoke("memoryGetCorpus", { corpusId })
            : undefined;
        selectedProcedure = undefined;
        candidateId = undefined;
        isNewProcedure = false;
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
        await Promise.all([
            loadSources(),
            loadJobs(),
            loadActivity(),
            loadHowTos(),
        ]);
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
            await Promise.all([
                loadSources(),
                loadJobs(),
                loadActivity(),
                loadHowTos(),
            ]);
            return;
        }
        const corpusId = activeCorpus.corpusId;
        const sourceId = selectedSource?.sourceId;
        activeCorpus = await invoke("memoryGetCorpus", { corpusId });
        renderCorpusStatus();
        resetSourcePaging();
        resetJobPaging();
        resetActivityPaging();
        await Promise.all([
            loadSources(),
            loadJobs(),
            loadActivity(),
            loadHowTos(),
        ]);
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
    element<HTMLButtonElement>("saveHowToSettings").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!activeCorpus || !howToSettings) return;
                const instructions =
                    element<HTMLTextAreaElement>(
                        "howToInstructions",
                    ).value.trim();
                const preferences = {
                    ...howToSettings.preferences,
                    instructions,
                };
                howToSettings = await invoke("memoryUpdateHowToSettings", {
                    corpusId: activeCorpus.corpusId,
                    expectedRevision: howToSettings.revision,
                    enabled: element<HTMLInputElement>("howToEnabled").checked,
                    detectCandidates:
                        element<HTMLInputElement>("detectCandidates").checked,
                    preferences,
                });
                renderHowToSettings();
            });
        },
    );
    element<HTMLButtonElement>("searchProceduresButton").addEventListener(
        "click",
        () => {
            void run(loadHowTos);
        },
    );
    procedureSearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void run(loadHowTos);
        }
    });
    element<HTMLButtonElement>("newProcedureButton").addEventListener(
        "click",
        () => {
            if (!discardChanges()) return;
            candidateId = undefined;
            selectedProcedure = undefined;
            isNewProcedure = true;
            element<HTMLHeadingElement>("procedureTitle").textContent =
                "New procedure";
            element<HTMLDivElement>("procedureMetadata").textContent =
                "Unsaved private draft";
            procedureEditor.value =
                "# New procedure\n\nDescribe when to use this procedure.\n\n## Steps\n\n1. Add the first step.\n\n## Sources\n\n_None_\n";
            renderProcedures();
            renderProcedureEditor();
            originalProcedureContent = "";
        },
    );
    element<HTMLButtonElement>("saveProcedureButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!activeCorpus) return;
                selectedProcedure = await invoke("memorySaveProcedure", {
                    corpusId: activeCorpus.corpusId,
                    markdown: procedureEditor.value,
                    ...(candidateId ? { candidateId } : {}),
                    ...(selectedProcedure === undefined
                        ? {}
                        : {
                              procedureId: selectedProcedure.procedureId,
                              expectedVersion: selectedProcedure.version,
                          }),
                });
                isNewProcedure = false;
                candidateId = undefined;
                originalProcedureContent = selectedProcedure.markdown;
                procedureSearch.value = "";
                await loadHowTos();
                if (selectedProcedure)
                    host.openProcedure(
                        selectedProcedure.corpusId,
                        selectedProcedure.procedureId,
                    );
            });
        },
    );
    element<HTMLButtonElement>("archiveProcedureButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!selectedProcedure) return;
                if (
                    !confirm(
                        `Archive "${selectedProcedure.document.title}" in ${activeCorpus?.name ?? selectedProcedure.corpusId}?`,
                    )
                )
                    return;
                selectedProcedure = await invoke("memoryArchiveProcedure", {
                    corpusId: selectedProcedure.corpusId,
                    procedureId: selectedProcedure.procedureId,
                    expectedVersion: selectedProcedure.version,
                });
                await loadHowTos();
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
                    `Corpus: ${activeCorpus.name}. Procedure and skill dependency lookup is unavailable in this release.`,
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
                dialog("forgetDialog").showModal();
            });
        },
    );
    element<HTMLButtonElement>("confirmForgetButton").addEventListener(
        "click",
        () => {
            void run(async () => {
                if (!pendingForget) return;
                await invoke("memoryForgetSource", {
                    corpusId: pendingForget.corpusId,
                    sourceId: pendingForget.sourceId,
                    confirmationToken: pendingForget.confirmationToken,
                });
                pendingForget = undefined;
                selectedSource = undefined;
                contentPage = undefined;
                dialog("forgetDialog").close();
                renderSource();
                renderContent();
                renderKnowledge();
                await refreshActiveCorpus();
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
            (!contentEditor.disabled &&
                contentEditor.value !== originalPageContent) ||
            (!procedureEditor.disabled &&
                procedureEditor.value !== originalProcedureContent) ||
            (howToSettings !== undefined &&
                settingsContent() !== originalSettingsContent)
        );
    }
    function settingsContent(): string {
        return JSON.stringify([
            element<HTMLInputElement>("howToEnabled").checked,
            element<HTMLInputElement>("detectCandidates").checked,
            element<HTMLTextAreaElement>("howToInstructions").value,
        ]);
    }
    function discardChanges(): boolean {
        if (!hasUnsavedChanges()) return true;
        if (document.querySelector("dialog[open]")) return false;
        if (!confirm("Discard unsaved source, procedure or settings edits?"))
            return false;
        contentEditor.value = originalPageContent;
        procedureEditor.value = originalProcedureContent;
        renderHowToSettings();
        return true;
    }
    window.addEventListener("beforeunload", (event) => {
        if (hasUnsavedChanges()) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    return {
        selectCorpus,
        selectSource,
        selectProcedure,
        refresh: refreshActiveCorpus,
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
        async reviewCandidate(corpusId: string, id: string) {
            await selectCorpus(corpusId);
            const candidate = procedureCandidates.find(
                (item) => item.candidateId === id,
            );
            if (!candidate)
                throw new Error(
                    "Candidate is no longer available. Refresh Inbox.",
                );
            candidateId = id;
            selectedProcedure = undefined;
            isNewProcedure = true;
            procedureEditor.value = `# ${candidate.title}\n\n${candidate.summary ?? ""}\n\n## Steps\n\n${candidate.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n## Sources\n\n${candidate.citations.length ? candidate.citations.map((citation) => `- ${JSON.stringify(citation)}`).join("\n") : "_None_"}\n${(candidate.additionalSections ?? []).map((section) => `\n## ${section.heading}\n\n${section.content}\n`).join("")}`;
            element<HTMLHeadingElement>("procedureTitle").textContent =
                `Review: ${candidate.title}`;
            element<HTMLDivElement>("procedureMetadata").textContent =
                "Derived candidate. Evidence, not instructions. Save preserves candidate citations.";
            originalProcedureContent = procedureEditor.value;
            renderProcedureEditor();
            return candidate;
        },
    };
}
