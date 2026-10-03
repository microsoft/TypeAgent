// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    runbookProcedureDocumentSchema,
    runbookSaveSchema,
    runbookViewSchemas,
} from "./runbookViewSchemas.mjs";
import { runbookImportViewSchemas } from "./runbookImportSchemas.mjs";
import type {
    ViewMethod,
    ViewRequest,
} from "@typeagent/browser-control-rpc/viewRpc";

const text = z.string().min(1).max(8192);
const optionalText = text.optional();
const count = z.number().int().min(0).max(100000);
const optionalCount = count.optional();
const strings = z.array(text).max(10000);
const boolean = z.boolean().optional();
const empty = z.strictObject({});
const corpus = { corpusId: text };
const source = { ...corpus, sourceId: text };
const page = {
    pageSize: z.number().int().min(1).max(1000).optional(),
    continuationToken: optionalText,
};
const suppression = {
    ...source,
    kind: z.enum(["entity", "topic"]),
    name: text,
};
const procedureStates = z
    .array(z.enum(["saved", "stale", "archived"]))
    .optional();
const document = runbookProcedureDocumentSchema;
const activity = {
    dateFrom: optionalText,
    dateTo: optionalText,
    domains: strings.optional(),
    eventTypes: z
        .array(z.enum(["visited", "bookmarked", "captured", "imported"]))
        .optional(),
    sources: strings.optional(),
    sourceIds: strings.optional(),
    pageTypes: strings.optional(),
};
const neighborhood = {
    entityId: text,
    depth: z.number().int().min(0).max(10).optional(),
    maxNodes: optionalCount,
};
const graph = { maxNodes: optionalCount, includeConnectivity: boolean };
const importId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

// Each entry is an explicitly exposed domain operation, never a browser-control method.
const schemas: Record<ViewMethod, z.ZodType> = {
    ...runbookViewSchemas,
    ...runbookImportViewSchemas,
    memoryHubSearch: z.strictObject({
        query: text,
        corpusId: optionalText,
        limit: z.number().int().min(1).max(100).optional(),
        generateAnswer: boolean,
        sourceTypes: z
            .array(z.enum(["web", "markdown", "text", "html", "vtt"]))
            .max(5)
            .optional(),
        tags: z.array(text).max(100).optional(),
        dateFrom: z.iso.datetime({ offset: true }).optional(),
        dateTo: z.iso.datetime({ offset: true }).optional(),
        conversationScope: z.enum(["none", "current", "all"]).optional(),
    }),
    memoryHubEvidence: z.discriminatedUnion("kind", [
        z.strictObject({
            ...corpus,
            kind: z.literal("source"),
            objectId: text,
            revisionId: optionalText,
            offset: z
                .number()
                .int()
                .nonnegative()
                .max(Number.MAX_SAFE_INTEGER)
                .optional(),
        }),
        z.strictObject({
            ...corpus,
            kind: z.literal("procedure"),
            objectId: text,
            procedureVersion: z.number().int().positive().optional(),
            offset: z
                .number()
                .int()
                .nonnegative()
                .max(Number.MAX_SAFE_INTEGER)
                .optional(),
        }),
        z.strictObject({
            ...corpus,
            kind: z.literal("conversation"),
            objectId: text,
            offset: z
                .number()
                .int()
                .nonnegative()
                .max(Number.MAX_SAFE_INTEGER)
                .optional(),
        }),
    ]),
    memoryHubExplore: z.strictObject({
        corpusId: optionalText,
        maxNodes: z.number().int().min(1).max(5000).optional(),
    }),
    memoryHubKnowledge: z
        .strictObject({
            corpusId: optionalText,
            browserOnly: z.boolean().optional(),
            kind: z.enum(["entities", "topics", "relationships", "sources"]),
            query: z.string().max(512).optional(),
            sort: z.enum(["name", "mentions"]).optional(),
            offset: z
                .number()
                .int()
                .min(0)
                .max(Number.MAX_SAFE_INTEGER)
                .optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
        })
        .refine((value) => !value.browserOnly || !value.corpusId, {
            message: "Browser knowledge cannot use a selected corpus.",
        }),
    memoryHubChanges: z.strictObject({ corpusId: optionalText, ...page }),
    memoryHubCapturePages: empty,
    memoryHubCapturePage: z.strictObject({
        pageId: text,
        expectedUrl: z.url().max(8192),
    }),
    memoryHubSnapshot: z.strictObject({ corpusId: optionalText }),
    memoryHubSources: z.strictObject({
        corpusId: optionalText,
        ...page,
        query: optionalText,
        sourceTypes: z
            .array(z.enum(["web", "markdown", "text", "html", "vtt"]))
            .optional(),
    }),
    memoryCreateCorpus: z.strictObject({
        name: text,
        description: optionalText,
    }),
    memoryListCorpora: empty,
    memoryGetCorpus: z.strictObject(corpus),
    memoryListSources: z.strictObject({
        ...corpus,
        ...page,
        query: optionalText,
        sourceTypes: z
            .array(z.enum(["web", "markdown", "text", "html", "vtt"]))
            .optional(),
    }),
    memoryGetSource: z.strictObject(source),
    memoryGetSourceContent: z.strictObject({
        ...source,
        revisionId: optionalText,
        offset: optionalCount,
        maxChars: optionalCount,
    }),
    memoryGetSourceKnowledge: z.strictObject(source),
    memoryListSourceKnowledgeSuppressions: z.strictObject(source),
    memorySuppressSourceKnowledge: z.strictObject(suppression),
    memoryRestoreSourceKnowledge: z.strictObject(suppression),
    memoryImportDocument: z.strictObject({
        ...corpus,
        title: text,
        markdown: z.string().max(10000000),
        canonicalUri: optionalText,
        tags: strings.optional(),
    }),
    memoryReplaceSource: z.strictObject({
        ...source,
        expectedActiveRevisionId: text,
        text: z.string().max(10000000),
        retainRevisionHistory: boolean,
    }),
    memoryPreviewForgetSource: z.strictObject(source),
    memoryForgetSource: z.strictObject({ ...source, confirmationToken: text }),
    memoryReindexCorpus: z.strictObject(corpus),
    memoryReindexSource: z.strictObject(source),
    memoryListJobs: z.strictObject({
        corpusId: optionalText,
        sourceId: optionalText,
        ...page,
    }),
    memoryCancelJob: z.strictObject({ jobId: text }),
    memoryGetHowToSettings: z.strictObject(corpus),
    memoryUpdateHowToSettings: z.strictObject({
        ...corpus,
        expectedRevision: count,
        enabled: boolean,
        detectCandidates: boolean,
        preferences: z.record(z.string(), z.json()).optional(),
    }),
    memoryCreateProcedureCandidate: document.extend({
        ...corpus,
        candidateId: optionalText,
        state: z.enum(["detected", "draft"]).optional(),
    }),
    memoryListProcedureCandidates: z.strictObject({
        ...corpus,
        states: z
            .array(z.enum(["detected", "draft", "rejected", "saved"]))
            .optional(),
    }),
    memoryRejectProcedureCandidate: z.strictObject({
        ...corpus,
        candidateId: text,
    }),
    memorySaveProcedure: runbookSaveSchema,
    memoryListProcedures: z.strictObject({
        ...corpus,
        states: procedureStates,
    }),
    memoryGetProcedure: z.strictObject({
        ...corpus,
        procedureId: text,
        version: optionalCount,
    }),
    memorySearchProcedures: z.strictObject({
        ...corpus,
        query: text,
        states: procedureStates,
        limit: optionalCount,
    }),
    memoryArchiveProcedure: z.strictObject({
        ...corpus,
        procedureId: text,
        expectedVersion: optionalCount,
    }),
    memoryListActivity: z.strictObject({ ...activity, ...page }),
    memoryForgetActivity: z.strictObject({
        ...activity,
        eventIds: strings.optional(),
    }),
    getLibraryStats: empty,
    getAnalyticsData: z.strictObject({
        timeRange: optionalText,
        includeQuality: boolean,
        includeProgress: boolean,
        topDomainsLimit: optionalCount,
        activityGranularity: optionalText,
    }),
    searchWebMemories: z.strictObject({
        query: text,
        generateAnswer: boolean,
        includeRelatedEntities: boolean,
        enableAdvancedSearch: boolean,
        limit: optionalCount,
        minScore: z.number().min(0).max(1).optional(),
        searchScope: z.enum(["current_page", "all_indexed"]).optional(),
        metadata: z.strictObject({ url: optionalText }).optional(),
        url: optionalText,
        domain: optionalText,
        source: optionalText,
        pageType: optionalText,
        eventType: z
            .enum(["visited", "bookmarked", "captured", "imported"])
            .optional(),
        dateFrom: optionalText,
        dateTo: optionalText,
    }),
    getTopicTimelines: z.strictObject({
        topicNames: strings,
        maxTimelineEntries: optionalCount,
        timeRange: z
            .strictObject({ startDate: optionalText, endDate: optionalText })
            .optional(),
        includeRelatedTopics: boolean,
        neighborhoodDepth: optionalCount,
    }),
    getKnowledgeGraphStatus: empty,
    buildKnowledgeGraph: empty,
    rebuildKnowledgeGraph: empty,
    getGlobalGraphLayoutData: z.strictObject(graph),
    getEntityNeighborhood: z.strictObject(neighborhood),
    getEntityNeighborhoodLayoutData: z.strictObject(neighborhood),
    getGlobalImportanceLayer: z.strictObject(graph),
    getImportanceStatistics: empty,
    getTopicImportanceLayer: z.strictObject({
        maxNodes: optionalCount,
        minImportanceThreshold: z.number().min(0).optional(),
    }),
    getTopicDetails: z.strictObject({ topicId: text }),
    getEntityDetails: z.strictObject({ entityName: text }),
    getViewportBasedNeighborhood: z.strictObject({
        centerEntity: optionalText,
        viewportNodeNames: strings.optional(),
        maxNodes: optionalCount,
        importanceWeighting: z.number().min(0).max(1).optional(),
        includeGlobalContext: boolean,
        exploreFromAllViewportNodes: boolean,
        minDepthFromViewport: optionalCount,
    }),
    importWebsiteDataWithProgress: z.strictObject({
        source: text,
        type: text,
        limit: optionalCount,
        days: optionalCount,
        folder: optionalText,
        mode: z.literal("content").optional(),
        maxConcurrent: z.number().int().min(1).max(50).optional(),
        contentTimeout: z.number().int().min(5000).max(120000).optional(),
        importId,
        totalItems: optionalCount,
        progressCallback: boolean,
    }),
    importHtmlFolder: z.strictObject({
        folderPath: text,
        importId: importId.optional(),
        options: z
            .strictObject({
                mode: z.literal("content").optional(),
                preserveStructure: boolean,
                recursive: boolean,
                fileTypes: strings.optional(),
                limit: optionalCount,
                maxFileSize: z
                    .number()
                    .int()
                    .min(1024)
                    .max(500 * 1024 * 1024)
                    .optional(),
                skipHidden: boolean,
            })
            .optional(),
    }),
    getAutoIndexSetting: empty,
    listAutomations: empty,
    getAutomation: z.strictObject({ id: text }),
    validateAutomation: z.strictObject({ id: text }),
    approveAutomation: z.strictObject({ id: text }),
    disableAutomation: z.strictObject({ id: text }),
    deleteAutomation: z.strictObject({ id: text }),
    cancelImport: z.strictObject({ importId }),
    cancelFileImport: z.strictObject({ importId }),
    getFileImportProgress: z.strictObject({ importId }),
};

export function validateViewRequest(body: unknown): ViewRequest {
    const envelope = z
        .strictObject({
            method: text,
            params: z.record(z.string(), z.unknown()),
        })
        .parse(body);
    if (!Object.prototype.hasOwnProperty.call(schemas, envelope.method)) {
        throw new Error("Unknown view method");
    }
    const method = envelope.method as ViewMethod;
    return {
        method,
        params: schemas[method].parse(envelope.params),
    } as ViewRequest;
}
