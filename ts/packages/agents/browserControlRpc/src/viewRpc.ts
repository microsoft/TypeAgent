// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    BrowserAgentInvokeFunctions,
    MemoryCenterInvokeFunctions,
    MemoryCenterCorpus,
    MemoryCenterPage,
    MemoryCenterProcedureSummary,
    MemoryCenterSource,
    MemoryCenterCorpusStatus,
} from "./serviceTypes.js";
import type { BrowserCapturePage } from "./browserControl.js";
import type { MemoryHubRunbookFunctions } from "./runbookViewTypes.js";
import type { MemoryHubRunbookImportFunctions } from "./runbookImportViewTypes.js";
export type * from "./runbookViewTypes.js";
export type * from "./runbookImportViewTypes.js";

export type MemoryHubSearchRequest = {
    query: string;
    corpusId?: string;
    limit?: number;
    generateAnswer?: boolean;
    sourceTypes?: MemoryCenterSource["sourceType"][];
    tags?: string[];
    dateFrom?: string;
    dateTo?: string;
    conversationScope?: "none" | "current" | "all";
};

export type MemoryHubEvidence = {
    id: string;
    kind: "source" | "procedure" | "conversation";
    corpusId: string;
    corpusName: string;
    objectId: string;
    title: string;
    snippet: string;
    score: number;
    rank: number;
    sourceId?: string;
    revisionId?: string;
    sourceType?: MemoryCenterSource["sourceType"];
    locator?: string;
    canonicalUri?: string;
    procedureVersion?: number;
    procedureState?: "saved" | "stale" | "archived";
    conversationId?: string;
    turnId?: string;
    eventTime?: string;
    authoritative?: boolean;
};

export type MemoryHubAnswer = {
    status?: "answered" | "noAnswer";
    text: string;
    mode: "synthesized" | "extractive";
    citationIds: string[];
    followUps: string[];
};

export type MemoryHubSearchResult = {
    query: string;
    matches: MemoryHubEvidence[];
    answer?: MemoryHubAnswer;
    ranking: "reciprocal-rank-fusion";
    warnings: string[];
    errors: MemoryHubError[];
    insights?: MemoryHubSearchInsights;
};

export type MemoryHubSearchInsights = {
    provider: "canonical" | "fixedBrowserMemory";
    status: "available" | "unsupported" | "unavailable";
    corpusId?: string;
    topTopics: string[];
    relatedEntities: Array<{ name: string; type: string; confidence?: number }>;
    message?: string;
};

export type MemoryHubEvidenceRequest = {
    corpusId: string;
    kind: MemoryHubEvidence["kind"];
    objectId: string;
    revisionId?: string;
    procedureVersion?: number;
    offset?: number;
};

export type MemoryHubEvidenceContent = {
    title: string;
    content: string;
    offset: number;
    totalChars: number;
    nextOffset?: number;
    provenance: MemoryHubEvidenceRequest & {
        conversationId?: string;
        turnId?: string;
        locator?: string;
    };
};

export type MemoryHubGraphSource = {
    corpusId: string;
    sourceId: string;
    title?: string;
};
export type MemoryHubKnowledgeKind =
    | "entities"
    | "topics"
    | "relationships"
    | "sources";
export type MemoryHubKnowledgeItem = {
    id: string;
    title: string;
    subtitle?: string;
    mentions?: number;
    sources: MemoryHubGraphSource[];
};
export type MemoryHubKnowledgeRequest = {
    corpusId?: string;
    browserOnly?: boolean;
    kind: MemoryHubKnowledgeKind;
    query?: string;
    sort?: "name" | "mentions";
    offset?: number;
    pageSize?: number;
};
export type MemoryHubKnowledgePage = {
    items: MemoryHubKnowledgeItem[];
    total: number;
    errors: MemoryHubError[];
};
export type MemoryHubExploreResult = {
    corpora: MemoryCenterCorpusStatus[];
    counts: {
        sources: number;
        entities: number;
        topics: number;
        relationships: number;
        procedures: number;
    };
    entities: Array<{
        id: string;
        name: string;
        types: string[];
        mentionCount: number;
        sources: MemoryHubGraphSource[];
    }>;
    topics: Array<{
        id: string;
        name: string;
        mentionCount: number;
        sources: MemoryHubGraphSource[];
    }>;
    relationships: Array<{
        id: string;
        fromId: string;
        toId: string;
        type: string;
        fromName?: string;
        toName?: string;
        count: number;
        sources: MemoryHubGraphSource[];
    }>;
    omittedEntities: number;
    contributingSources?: MemoryHubGraphSource[];
    contributingSourceCount?: number;
    errors: MemoryHubError[];
};

export type MemoryHubChangeReceipt = {
    changeId: string;
    corpusId: string;
    operation: "replace" | "forget" | "suppress" | "restore";
    createdAt: string;
    outcome: "committed";
    sourceId?: string;
    previousRevisionId?: string;
    revisionId?: string;
    counts: { sources: number; revisions: number; knowledge: number };
};

export type MemoryHubInboxItem = {
    id: string;
    fingerprint: string;
    kind:
        | "candidate"
        | "staleProcedure"
        | "job"
        | "skillDraft"
        | "bindingDrift"
        | "runbookWarning";
    corpusId: string;
    corpusName: string;
    objectId: string;
    title: string;
    reason: string;
    updatedAt: string;
    severity: "attention" | "info";
    sourceId?: string;
    jobState?: "failed" | "partial";
    skillRevisionId?: string;
};

export type MemoryHubError = {
    corpusId: string;
    operation:
        | "candidates"
        | "procedures"
        | "jobs"
        | "sources"
        | "search"
        | "conversations"
        | "answer"
        | "graph"
        | "changes"
        | "skills"
        | "bindings"
        | "runbooks";
    message: string;
};

export type MemoryHubSnapshot = {
    corpora: MemoryCenterCorpus[];
    inbox: MemoryHubInboxItem[];
    procedures: Array<MemoryCenterProcedureSummary & { corpusName: string }>;
    errors: MemoryHubError[];
};

export type MemoryHubFunctions = {
    memoryHubKnowledge(
        params: MemoryHubKnowledgeRequest,
    ): Promise<MemoryHubKnowledgePage>;
    memoryHubSearch(
        params: MemoryHubSearchRequest,
    ): Promise<MemoryHubSearchResult>;
    memoryHubEvidence(
        params: MemoryHubEvidenceRequest,
    ): Promise<MemoryHubEvidenceContent>;
    memoryHubExplore(params: {
        corpusId?: string;
        maxNodes?: number;
    }): Promise<MemoryHubExploreResult>;
    memoryHubChanges(params: {
        corpusId?: string;
        pageSize?: number;
        continuationToken?: string;
    }): Promise<
        MemoryCenterPage<MemoryHubChangeReceipt> & { errors: MemoryHubError[] }
    >;
    memoryHubCapturePages(params: {}): Promise<{ pages: BrowserCapturePage[] }>;
    memoryHubCapturePage(params: {
        pageId: string;
        expectedUrl: string;
    }): Promise<{ corpusId: string; sourceId: string; warnings: string[] }>;
    memoryHubSnapshot(params: {
        corpusId?: string;
    }): Promise<MemoryHubSnapshot>;
    memoryHubSources(params: {
        corpusId?: string;
        query?: string;
        sourceTypes?: MemoryCenterSource["sourceType"][];
        pageSize?: number;
        continuationToken?: string;
    }): Promise<
        MemoryCenterPage<MemoryCenterSource> & {
            errors: MemoryHubError[];
        }
    >;
};

export type ViewInvokeFunctions = MemoryCenterInvokeFunctions &
    MemoryHubFunctions &
    MemoryHubRunbookFunctions & {
        [M in keyof MemoryHubRunbookImportFunctions]: MemoryHubRunbookImportFunctions[M];
    } & Pick<
        BrowserAgentInvokeFunctions,
        | "getAnalyticsData"
        | "getTopicTimelines"
        | "getKnowledgeGraphStatus"
        | "rebuildKnowledgeGraph"
        | "getEntityNeighborhood"
        | "getEntityNeighborhoodLayoutData"
        | "getGlobalImportanceLayer"
        | "getImportanceStatistics"
        | "getTopicImportanceLayer"
        | "getTopicDetails"
        | "getEntityDetails"
        | "getViewportBasedNeighborhood"
        | "importWebsiteDataWithProgress"
        | "importHtmlFolder"
    > & {
        searchWebMemories(params: {
            query: string;
            generateAnswer?: boolean;
            includeRelatedEntities?: boolean;
            enableAdvancedSearch?: boolean;
            limit?: number;
            minScore?: number;
            searchScope?: "current_page" | "all_indexed";
            metadata?: { url?: string };
            url?: string;
            domain?: string;
            source?: string;
            pageType?: string;
            eventType?: "visited" | "bookmarked" | "captured" | "imported";
            dateFrom?: string;
            dateTo?: string;
        }): ReturnType<BrowserAgentInvokeFunctions["searchWebMemories"]>;
        getLibraryStats(params: {}): Promise<unknown>;
        buildKnowledgeGraph(params: {}): Promise<unknown>;
        getGlobalGraphLayoutData(params: {
            maxNodes?: number;
            includeConnectivity?: boolean;
        }): Promise<unknown>;
        getAutoIndexSetting(params: {}): Promise<boolean>;
        listAutomations(params: {}): Promise<unknown>;
        getAutomation(params: { id: string }): Promise<unknown>;
        validateAutomation(params: { id: string }): Promise<unknown>;
        approveAutomation(params: { id: string }): Promise<unknown>;
        disableAutomation(params: { id: string }): Promise<unknown>;
        deleteAutomation(params: { id: string }): Promise<unknown>;
        getFileImportProgress(params: { importId: string }): Promise<{
            importId: string;
            progress?: unknown;
            state?: unknown;
        }>;
        cancelImport(params: { importId: string }): Promise<ViewCancelResult>;
        cancelFileImport(params: {
            importId: string;
        }): Promise<ViewCancelResult>;
    };

export type ViewCancelResult = {
    success: boolean;
    cancelled: boolean;
    error?: string;
};

export type ViewMethod = keyof ViewInvokeFunctions;
export const viewMethods = [
    "memoryHubStartRunbookImport",
    "memoryHubRunbookBatches",
    "memoryHubRunbookBatch",
    "memoryHubRetryRunbookBatch",
    "memoryHubCancelRunbookBatch",
    "memoryHubRunbookJobs",
    "memoryHubRunbooks",
    "memoryHubRunbook",
    "memoryHubSaveRunbook",
    "memoryHubRunbookHistory",
    "memoryHubRunbookOriginal",
    "memoryHubRunbookUsedBy",
    "memoryHubSuggestBindings",
    "memoryHubAcceptBinding",
    "memoryHubPreviewSkill",
    "memoryHubPublishSkill",
    "memoryHubSkillAction",
    "memoryHubSkillFile",
    "memoryHubCompareRunbook",
    "memoryHubSynthesizeRunbook",
    "memoryHubReadRunbookAsset",
    "memoryHubSearch",
    "memoryHubEvidence",
    "memoryHubExplore",
    "memoryHubKnowledge",
    "memoryHubChanges",
    "memoryHubCapturePage",
    "memoryHubCapturePages",
    "memoryHubSnapshot",
    "memoryHubSources",
    "memoryCreateCorpus",
    "memoryViewCapabilities",
    "memoryListViews",
    "memoryGetView",
    "memorySaveViewDraft",
    "memoryArchiveView",
    "memoryViewHistory",
    "memoryBuildViews",
    "memoryGetViewBuild",
    "memoryListViewBuilds",
    "memoryCancelViewBuild",
    "memoryRetryViewBuild",
    "memoryGetViewConflict",
    "memoryResolveViewConflict",
    "memoryListCorpora",
    "memoryGetCorpus",
    "memoryListSources",
    "memoryGetSource",
    "memoryGetSourceContent",
    "memoryGetSourceKnowledge",
    "memoryListSourceKnowledgeSuppressions",
    "memorySuppressSourceKnowledge",
    "memoryRestoreSourceKnowledge",
    "memoryImportDocument",
    "memoryReplaceSource",
    "memoryPreviewForgetSource",
    "memoryForgetSource",
    "memoryReindexCorpus",
    "memoryReindexSource",
    "memoryListJobs",
    "memoryCancelJob",
    "memoryGetHowToSettings",
    "memoryUpdateHowToSettings",
    "memoryCreateProcedureCandidate",
    "memoryListProcedureCandidates",
    "memoryRejectProcedureCandidate",
    "memorySaveProcedure",
    "memoryListProcedures",
    "memoryGetProcedure",
    "memorySearchProcedures",
    "memoryArchiveProcedure",
    "memoryListActivity",
    "memoryForgetActivity",
    "getLibraryStats",
    "getAnalyticsData",
    "searchWebMemories",
    "getTopicTimelines",
    "getKnowledgeGraphStatus",
    "buildKnowledgeGraph",
    "rebuildKnowledgeGraph",
    "getGlobalGraphLayoutData",
    "getEntityNeighborhood",
    "getEntityNeighborhoodLayoutData",
    "getGlobalImportanceLayer",
    "getImportanceStatistics",
    "getTopicImportanceLayer",
    "getTopicDetails",
    "getEntityDetails",
    "getViewportBasedNeighborhood",
    "importWebsiteDataWithProgress",
    "importHtmlFolder",
    "getAutoIndexSetting",
    "listAutomations",
    "getAutomation",
    "validateAutomation",
    "approveAutomation",
    "disableAutomation",
    "deleteAutomation",
    "getFileImportProgress",
    "cancelImport",
    "cancelFileImport",
] as const satisfies readonly ViewMethod[];
export type ViewRequest = {
    [M in ViewMethod]: {
        method: M;
        params: Parameters<ViewInvokeFunctions[M]>[0];
    };
}[ViewMethod];

export type ViewResponse<T = unknown> =
    | { success: true; data: T }
    | { success: false; error: string };

export type ViewEvent = {
    type: "importProgress" | "knowledgeExtractionProgress";
    data: unknown;
    timestamp: string;
};

export type ViewCallFunctions = {
    viewEvent(event: ViewEvent): void;
};
