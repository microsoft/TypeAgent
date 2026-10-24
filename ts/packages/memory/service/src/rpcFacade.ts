// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IngestionJobStatus,
    JobProgress,
    MemoryService,
} from "./types.js";
import type { MemoryViewService } from "./viewTypes.js";
import type { MemoryTopicService } from "./topicTypes.js";
import type { MemoryKnowledgeService } from "./knowledgeTypes.js";

export interface MemoryJobWaitOptions {
    signal?: AbortSignal;
    onProgress?: (progress: JobProgress) => void;
    pollIntervalMs?: number;
}

function unsupportedCapability(operation: string): Promise<never> {
    return Promise.reject(new Error(`Memory ${operation} are not supported`));
}

export function createMemoryServiceRpcFacade(
    service: MemoryService & Partial<MemoryViewService>,
): MemoryService &
    MemoryViewService &
    MemoryTopicService &
    MemoryKnowledgeService {
    return {
        listViewSummaries: (request) =>
            service.listViewSummaries?.(request) ??
            unsupportedCapability("view summaries"),
        listQuestionSummaries: (request) =>
            service.listQuestionSummaries?.(request) ??
            unsupportedCapability("question summaries"),
        getQuestion: (request) =>
            service.getQuestion?.(request) ??
            unsupportedCapability("question details"),
        listViewBuildSummaries: (request) =>
            service.listViewBuildSummaries?.(request) ??
            unsupportedCapability("build summaries"),
        getViewPublications: (request) =>
            service.getViewPublications?.(request) ??
            unsupportedCapability("publication batches"),
        getKnowledgeStatus: (corpusId) =>
            service.getKnowledgeStatus?.(corpusId) ??
            unsupportedCapability("knowledge status"),
        updateKnowledgeDiscovery: (request) =>
            service.updateKnowledgeDiscovery?.(request) ??
            unsupportedCapability("knowledge discovery policy"),
        createKnowledgeCheckpoint: (request) =>
            service.createKnowledgeCheckpoint?.(request) ??
            unsupportedCapability("knowledge checkpoints"),
        getKnowledgeCheckpoint: (request) =>
            service.getKnowledgeCheckpoint?.(request) ??
            unsupportedCapability("knowledge checkpoints"),
        waitForKnowledgeCheckpoint: (request) =>
            service.waitForKnowledgeCheckpoint?.(request) ??
            unsupportedCapability("knowledge checkpoint waits"),
        requestAcquisition: (request) =>
            service.requestAcquisition?.(request) ??
            unsupportedCapability("acquisition requests"),
        listAcquisitions: (corpusId) =>
            service.listAcquisitions?.(corpusId) ??
            unsupportedCapability("acquisition status"),
        cancelAcquisition: (request) =>
            service.cancelAcquisition?.(request) ??
            unsupportedCapability("acquisition cancellation"),
        runAcquisitions: (corpusId) =>
            service.runAcquisitions?.(corpusId) ??
            unsupportedCapability("acquisition runs"),
        startAcquisitionPeriodic: (request) =>
            service.startAcquisitionPeriodic?.(request) ??
            unsupportedCapability("periodic acquisition"),
        listQuestions: (corpusId) =>
            service.listQuestions?.(corpusId) ??
            unsupportedCapability("questions"),
        editQuestion: (request) =>
            service.editQuestion?.(request) ??
            unsupportedCapability("question editing"),
        getViewPage: (request) =>
            service.getViewPage?.(request) ??
            unsupportedCapability("view pages"),
        proposeSchemaView: (request) =>
            service.proposeSchemaView?.(request) ??
            unsupportedCapability("schema proposals"),
        discoverSchemaQuestions: (request) =>
            service.discoverSchemaQuestions?.(request) ??
            unsupportedCapability("question discovery"),
        importAgentSession: (request) =>
            service.importAgentSession?.(request) ??
            unsupportedCapability("agent session imports"),
        getAgentSessionImport: (request) =>
            service.getAgentSessionImport?.(request) ??
            unsupportedCapability("agent session import status"),
        cancelAgentSessionImport: (request) =>
            service.cancelAgentSessionImport?.(request) ??
            unsupportedCapability("agent session import cancellation"),
        searchAgentMemories: (request) =>
            service.searchAgentMemories?.(request) ??
            unsupportedCapability("agent memory search"),
        queryTopics: (request) =>
            service.queryTopics?.(request) ??
            unsupportedCapability("topic queries"),
        rebuildTopics: (corpusId) =>
            service.rebuildTopics?.(corpusId) ??
            unsupportedCapability("topic rebuilds"),
        planViewMaintenance: (...args) =>
            service.planViewMaintenance?.(...args) ??
            unsupportedCapability("view maintenance planning"),
        maintainViews: (...args) =>
            service.maintainViews?.(...args) ??
            unsupportedCapability("view maintenance"),
        updateViewMaintenance: (...args) =>
            service.updateViewMaintenance?.(...args) ??
            unsupportedCapability("view maintenance definitions"),
        getViewMaintenance: (...args) =>
            service.getViewMaintenance?.(...args) ??
            unsupportedCapability("view maintenance receipts"),
        getViewPublicationPolicy: (...args) =>
            service.getViewPublicationPolicy?.(...args) ??
            unsupportedCapability("view publication policy"),
        updateViewPublicationPolicy: (...args) =>
            service.updateViewPublicationPolicy?.(...args) ??
            unsupportedCapability("view publication policy"),
        getViewPublication: (...args) =>
            service.getViewPublication?.(...args) ??
            unsupportedCapability("view publication"),
        retryViewIndex: (...args) =>
            service.retryViewIndex?.(...args) ??
            unsupportedCapability("view index retry"),
        searchViews: (...args) =>
            service.searchViews?.(...args) ??
            unsupportedCapability("published view search"),
        buildViews: (...args) =>
            service.buildViews?.(...args) ??
            unsupportedCapability("view builds"),
        getViewBuild: (...args) =>
            service.getViewBuild?.(...args) ??
            unsupportedCapability("view builds"),
        listViewBuilds: (...args) =>
            service.listViewBuilds?.(...args) ??
            unsupportedCapability("view builds"),
        cancelViewBuild: (...args) =>
            service.cancelViewBuild?.(...args) ??
            unsupportedCapability("view build cancellation"),
        retryViewBuild: (...args) =>
            service.retryViewBuild?.(...args) ??
            unsupportedCapability("view build retry"),
        getViewConflict: (...args) =>
            service.getViewConflict?.(...args) ??
            unsupportedCapability("view conflicts"),
        resolveViewConflict: (...args) =>
            service.resolveViewConflict?.(...args) ??
            unsupportedCapability("view conflict resolution"),
        listViews: (...args) =>
            service.listViews?.(...args) ??
            unsupportedCapability("view drafts"),
        getSourceViewUsage: (...args) =>
            service.getSourceViewUsage?.(...args) ??
            unsupportedCapability("source View usage"),
        getView: (...args) =>
            service.getView?.(...args) ?? unsupportedCapability("view drafts"),
        saveViewDraft: (...args) =>
            service.saveViewDraft?.(...args) ??
            unsupportedCapability("view drafts"),
        archiveView: (...args) =>
            service.archiveView?.(...args) ??
            unsupportedCapability("view drafts"),
        getViewHistory: (...args) =>
            service.getViewHistory?.(...args) ??
            unsupportedCapability("view history"),
        publishView: (...args) =>
            service.publishView?.(...args) ??
            unsupportedCapability("view publication"),
        createCorpus: (...args) => service.createCorpus(...args),
        listCorpora: (...args) => service.listCorpora(...args),
        getCorpus: (...args) => service.getCorpus(...args),
        clearCorpus: (...args) => service.clearCorpus(...args),
        listChanges: (request) => {
            if (service.listChanges === undefined) {
                return Promise.reject(
                    new Error("Memory changes are not supported"),
                );
            }
            return service.listChanges(request);
        },
        getRevisionAssets: (request) =>
            service.getRevisionAssets?.(request) ??
            unsupportedCapability("revision assets"),
        readRevisionAsset: (request) =>
            service.readRevisionAsset?.(request) ??
            unsupportedCapability("revision assets"),
        startBatchImport: (request) =>
            service.startBatchImport?.(request) ??
            unsupportedCapability("batch imports"),
        getBatchImport: (batchId) =>
            service.getBatchImport?.(batchId) ??
            unsupportedCapability("batch imports"),
        findBatchImport: (request) =>
            service.findBatchImport?.(request) ??
            unsupportedCapability("batch import lookup"),
        listBatchImports: (corpusId) =>
            service.listBatchImports?.(corpusId) ??
            unsupportedCapability("batch imports"),
        retryBatchImport: (batchId) =>
            service.retryBatchImport?.(batchId) ??
            unsupportedCapability("batch imports"),
        cancelBatchImport: (batchId) =>
            service.cancelBatchImport?.(batchId) ??
            unsupportedCapability("batch imports"),
        listSources: (...args) => service.listSources(...args),
        listSourcesPage: (...args) => service.listSourcesPage(...args),
        getSource: (...args) => service.getSource(...args),
        getSourceContent: (...args) => service.getSourceContent(...args),
        getSourceSynopsis: (request) =>
            service.getSourceSynopsis?.(request) ??
            unsupportedCapability("source synopses"),
        getSourceKnowledge: (...args) => service.getSourceKnowledge(...args),
        listSourceKnowledgeSuppressions: (...args) =>
            service.listSourceKnowledgeSuppressions!(...args),
        suppressSourceKnowledge: (...args) =>
            service.suppressSourceKnowledge!(...args),
        restoreSourceKnowledge: (...args) =>
            service.restoreSourceKnowledge!(...args),
        ingestDocument: (request) => service.ingestDocument(request),
        replaceSource: (request) => service.replaceSource(request),
        previewForgetSource: (...args) => service.previewForgetSource(...args),
        forgetSource: (...args) => service.forgetSource(...args),
        reindexCorpus: (...args) => service.reindexCorpus(...args),
        reindexSource: (...args) => service.reindexSource(...args),
        getJob: (...args) => service.getJob(...args),
        listJobs: (...args) => service.listJobs(...args),
        cancelJob: (...args) => service.cancelJob(...args),
        appendEvent: (...args) => service.appendEvent(...args),
        getEvent: (...args) => service.getEvent(...args),
        listEvents: (...args) => service.listEvents(...args),
        searchEvents: (...args) => service.searchEvents(...args),
        forgetEvents: (...args) => service.forgetEvents(...args),
        search: (...args) => service.search(...args),
        answer: (...args) => service.answer(...args),
        getKnowledgeGraph: (...args) => service.getKnowledgeGraph(...args),
        getCapabilities: (...args) => service.getCapabilities(...args),
    };
}

export async function waitForMemoryJob(
    service: MemoryService,
    jobId: string,
    options: MemoryJobWaitOptions = {},
): Promise<IngestionJobStatus> {
    const interval = options.pollIntervalMs ?? 250;
    while (true) {
        if (options.signal?.aborted) {
            await service.cancelJob(jobId);
            throw options.signal.reason ?? new Error("Job wait cancelled");
        }
        const job = await service.getJob(jobId);
        if (job === undefined) {
            throw new Error(`Unknown memory job '${jobId}'`);
        }
        options.onProgress?.(job.progress);
        if (
            job.state === "complete" ||
            job.state === "partial" ||
            job.state === "failed" ||
            job.state === "cancelled"
        ) {
            return job;
        }
        await new Promise<void>((resolve) => {
            const finished = () => {
                clearTimeout(timeout);
                options.signal?.removeEventListener("abort", finished);
                resolve();
            };
            const timeout = setTimeout(finished, interval);
            options.signal?.addEventListener("abort", finished, { once: true });
            if (options.signal?.aborted) finished();
        });
    }
}
