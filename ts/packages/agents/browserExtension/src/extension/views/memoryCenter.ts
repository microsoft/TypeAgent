// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryCenterActivity,
    MemoryCenterActivityFilter,
    MemoryCenterContent,
    MemoryCenterCorpus,
    MemoryCenterCorpusStatus,
    MemoryCenterForgetPreview,
    MemoryCenterInvokeFunctions,
    MemoryCenterJob,
    MemoryCenterKnowledge,
    MemoryCenterPage,
    MemoryCenterSource,
} from "@typeagent/browser-control-rpc/serviceTypes";
import { createChromeRpcClient } from "./chromeRpcClient";
import { createElectronRpcClient } from "./electronRpcClient";

const ACTIVE_CORPUS_KEY = "memoryCenter.activeCorpusId";
const PAGE_SIZE = 25;
const CONTENT_PAGE_SIZE = 12_000;
const rpcClient =
    typeof chrome !== "undefined" && chrome.runtime
        ? createChromeRpcClient<MemoryCenterInvokeFunctions>()
        : createElectronRpcClient<MemoryCenterInvokeFunctions>();
if (rpcClient === undefined) {
    throw new Error("Memory Center RPC transport is not available");
}
const rpc = rpcClient.rpc;

type MethodName = keyof MemoryCenterInvokeFunctions;
type MethodParams<M extends MethodName> = Parameters<
    MemoryCenterInvokeFunctions[M]
>[0];
type MethodResult<M extends MethodName> = Awaited<
    ReturnType<MemoryCenterInvokeFunctions[M]>
>;

function invoke<M extends MethodName>(
    method: M,
    params: MethodParams<M>,
): Promise<MethodResult<M>> {
    return rpc.invoke(method, params) as Promise<MethodResult<M>>;
}

function element<T extends HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) {
        throw new Error(`Memory Center element '${id}' was not found`);
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
const jobList = element<HTMLDivElement>("jobList");
const activityList = element<HTMLDivElement>("activityList");
const errorBanner = element<HTMLDivElement>("errorBanner");
const connectionState = element<HTMLDivElement>("connectionState");

let corpora: MemoryCenterCorpus[] = [];
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
        connectionState.textContent = "Unavailable";
        setError(error);
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
    for (const corpus of corpora) {
        const option = document.createElement("option");
        option.value = corpus.corpusId;
        option.textContent = `${corpus.name} (${corpus.documentCount})`;
        corpusSelect.appendChild(option);
    }
    if (activeCorpus) {
        corpusSelect.value = activeCorpus.corpusId;
    }
    if (corpora.length === 0) {
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
        if (source.sourceId === selectedSource?.sourceId) {
            button.classList.add("selected");
        }
        const title = document.createElement("div");
        title.className = "item-title";
        title.textContent = source.title;
        const subtitle = document.createElement("div");
        subtitle.className = "item-subtitle";
        subtitle.textContent = `${source.sourceType} · ${source.revisions.length} revision(s)`;
        button.append(title, subtitle);
        button.addEventListener("click", () => {
            void run(() => selectSource(source.sourceId));
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
        appendDefinition("Metadata", JSON.stringify(selectedSource.metadata));
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
            `${revision.revisionId} · ${revision.state}${pipeline} · ${indexedAt}`,
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
        actions.className = "item-actions";
        const sourceId = activity.linkedSourceIds?.[0];
        if (sourceId) {
            const open = document.createElement("button");
            open.type = "button";
            open.textContent = "Linked page";
            open.addEventListener("click", () => {
                void run(async () => {
                    if (activeCorpus?.corpusId !== activity.corpusId) {
                        await selectCorpus(activity.corpusId);
                    }
                    await selectSource(sourceId);
                });
            });
            actions.appendChild(open);
        }
        const forget = document.createElement("button");
        forget.type = "button";
        forget.textContent = "Delete event";
        forget.addEventListener("click", () => {
            void run(async () => {
                await invoke("memoryForgetActivity", {
                    eventIds: [activity.eventId],
                });
                await loadActivity();
            });
        });
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
                  eventTypes: [eventType as MemoryCenterActivity["eventType"]],
              }),
        ...(source === undefined ? {} : { sources: [source] }),
        ...(pageType === undefined ? {} : { pageTypes: [pageType] }),
        ...(activityLinkedSourceId === undefined
            ? {}
            : { sourceIds: [activityLinkedSourceId] }),
    };
}

async function loadActivity(): Promise<void> {
    activityPage = await invoke("memoryListActivity", {
        ...activityFilter(),
        pageSize: PAGE_SIZE,
        continuationToken: activityTokens[activityPageIndex],
    });
    if (activityPage.nextContinuationToken) {
        activityTokens[activityPageIndex + 1] =
            activityPage.nextContinuationToken;
    }
    renderActivity();
}

function renderContent(): void {
    if (!contentPage) {
        contentEditor.value = "";
        contentRange.textContent = "";
        element<HTMLButtonElement>("contentPrevious").disabled = true;
        element<HTMLButtonElement>("contentNext").disabled = true;
        return;
    }
    originalPageContent = contentPage.content;
    contentEditor.value = contentPage.content;
    const end = contentPage.offset + contentPage.content.length;
    contentRange.textContent = `${contentPage.offset + 1}-${end} of ${contentPage.totalChars} characters · revision ${contentPage.revisionId}`;
    element<HTMLButtonElement>("contentPrevious").disabled =
        contentPageIndex === 0;
    element<HTMLButtonElement>("contentNext").disabled =
        contentPage.nextOffset === undefined;
}

function renderKnowledge(knowledge?: MemoryCenterKnowledge): void {
    if (!knowledge) {
        setEmpty(entityList, "No source selected.");
        setEmpty(topicList, "No source selected.");
        setEmpty(relationshipList, "No source selected.");
        return;
    }

    entityList.replaceChildren();
    for (const entity of knowledge.entities) {
        appendTextItem(
            entityList,
            `${entity.name} (${entity.types.join(", ") || "entity"}) · ${entity.mentionCount}`,
            "chip",
        );
    }
    entityList.classList.toggle("empty", knowledge.entities.length === 0);
    if (knowledge.entities.length === 0) entityList.textContent = "None";

    topicList.replaceChildren();
    for (const topic of knowledge.topics) {
        appendTextItem(
            topicList,
            `${topic.name} · ${topic.mentionCount}`,
            "chip",
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
}

function canCancel(job: MemoryCenterJob): boolean {
    return !["complete", "partial", "failed", "cancelled"].includes(job.state);
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
        appendTextItem(card, job.jobId, "item-subtitle");
        if (job.progress.message) {
            appendTextItem(card, job.progress.message, "item-subtitle");
        }
        if (job.error) appendTextItem(card, job.error, "job-error");
        for (const warning of job.warnings) {
            appendTextItem(card, warning, "job-warning");
        }
        if (canCancel(job)) {
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", () => {
                void run(async () => {
                    await invoke("memoryCancelJob", { jobId: job.jobId });
                    await loadJobs();
                });
            });
            card.appendChild(cancel);
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
}

async function loadCorpora(preferredCorpusId?: string): Promise<void> {
    corpora = await invoke("memoryListCorpora", {});
    const stored = localStorage.getItem(ACTIVE_CORPUS_KEY);
    const corpusId =
        preferredCorpusId ??
        (stored && corpora.some((corpus) => corpus.corpusId === stored)
            ? stored
            : corpora[0]?.corpusId);
    if (!corpusId) {
        activeCorpus = undefined;
        selectedSource = undefined;
        sourcePage = { items: [], total: 0 };
        jobPage = { items: [], total: 0 };
        renderCorpora();
        renderCorpusStatus();
        renderSources();
        renderSource();
        renderContent();
        renderKnowledge();
        renderJobs();
        activityPage = { items: [], total: 0 };
        renderActivity();
        return;
    }
    await selectCorpus(corpusId);
}

async function selectCorpus(corpusId: string): Promise<void> {
    localStorage.setItem(ACTIVE_CORPUS_KEY, corpusId);
    activeCorpus = await invoke("memoryGetCorpus", { corpusId });
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
    if (!activeCorpus) return;
    sourcePage = await invoke("memoryListSources", {
        corpusId: activeCorpus.corpusId,
        pageSize: PAGE_SIZE,
        continuationToken: sourceTokens[sourcePageIndex],
        ...(sourceFilter.value.trim()
            ? { query: sourceFilter.value.trim() }
            : {}),
    });
    if (sourcePage.nextContinuationToken) {
        sourceTokens[sourcePageIndex + 1] = sourcePage.nextContinuationToken;
    }
    renderSources();
}

async function selectSource(sourceId: string): Promise<void> {
    if (!activeCorpus) return;
    const corpusId = activeCorpus.corpusId;
    selectedSource = await invoke("memoryGetSource", { corpusId, sourceId });
    if (!selectedSource) {
        throw new Error(`Source '${sourceId}' no longer exists`);
    }
    contentOffsets = [0];
    contentPageIndex = 0;
    renderSources();
    renderSource();
    const [content, knowledge] = await Promise.all([
        invoke("memoryGetSourceContent", {
            corpusId,
            sourceId,
            revisionId: selectedSource.activeRevisionId,
            offset: 0,
            maxChars: CONTENT_PAGE_SIZE,
        }),
        invoke("memoryGetSourceKnowledge", { corpusId, sourceId }),
    ]);
    contentPage = content;
    renderContent();
    renderKnowledge(knowledge);
}

async function loadContentPage(offset: number): Promise<void> {
    if (!activeCorpus || !selectedSource) return;
    contentPage = await invoke("memoryGetSourceContent", {
        corpusId: activeCorpus.corpusId,
        sourceId: selectedSource.sourceId,
        revisionId: selectedSource.activeRevisionId,
        offset,
        maxChars: CONTENT_PAGE_SIZE,
    });
    renderContent();
}

async function loadJobs(): Promise<void> {
    if (!activeCorpus) return;
    jobPage = await invoke("memoryListJobs", {
        corpusId: activeCorpus.corpusId,
        pageSize: PAGE_SIZE,
        continuationToken: jobTokens[jobPageIndex],
    });
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
            offset === contentPage.offset ? contentEditor.value : page.content,
        );
        if (page.nextOffset === undefined || page.nextOffset <= offset) break;
        offset = page.nextOffset;
    }
    return pieces.join("");
}

async function refreshActiveCorpus(): Promise<void> {
    if (!activeCorpus) return;
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
});

element<HTMLButtonElement>("refreshButton").addEventListener("click", () => {
    void run(refreshActiveCorpus);
});
element<HTMLButtonElement>("refreshJobsButton").addEventListener(
    "click",
    () => {
        void run(loadJobs);
    },
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
            const name = element<HTMLInputElement>("corpusName").value.trim();
            const description =
                element<HTMLTextAreaElement>("corpusDescription").value.trim();
            const created = await invoke("memoryCreateCorpus", {
                name,
                description: description || undefined,
            });
            dialog("createCorpusDialog").close();
            element<HTMLFormElement>("createCorpusForm").reset();
            await loadCorpora(created.corpusId);
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

element<HTMLButtonElement>("sourcePrevious").addEventListener("click", () => {
    if (sourcePageIndex === 0) return;
    sourcePageIndex -= 1;
    void run(loadSources);
});
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
element<HTMLButtonElement>("activityPrevious").addEventListener("click", () => {
    if (activityPageIndex === 0) return;
    activityPageIndex -= 1;
    void run(loadActivity);
});
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
element<HTMLButtonElement>("forgetActivity").addEventListener("click", () => {
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
        await invoke("memoryForgetActivity", filter);
        resetActivityPaging();
        await loadActivity();
    });
});
element<HTMLButtonElement>("contentPrevious").addEventListener("click", () => {
    if (contentPageIndex === 0) return;
    contentPageIndex -= 1;
    void run(() => loadContentPage(contentOffsets[contentPageIndex]));
});
element<HTMLButtonElement>("contentNext").addEventListener("click", () => {
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
            const delta = pendingReplacement.length - contentPage!.totalChars;
            element<HTMLParagraphElement>("replaceSummary").textContent =
                `Replace revision ${selectedSource!.activeRevisionId} with ${pendingReplacement.length} characters (${delta >= 0 ? "+" : ""}${delta})?`;
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

void run(loadCorpora);
