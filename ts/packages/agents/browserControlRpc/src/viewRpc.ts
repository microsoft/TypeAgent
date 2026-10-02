// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    BrowserAgentInvokeFunctions,
    MemoryCenterInvokeFunctions,
} from "./serviceTypes.js";

export type ViewInvokeFunctions = MemoryCenterInvokeFunctions &
    Pick<
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
        | "getAllWebFlows"
        | "deleteWebFlow"
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
    "memoryCreateCorpus",
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
    "getAllWebFlows",
    "deleteWebFlow",
    "importWebsiteDataWithProgress",
    "importHtmlFolder",
    "getAutoIndexSetting",
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
