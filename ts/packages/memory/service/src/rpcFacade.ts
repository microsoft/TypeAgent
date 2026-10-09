// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IngestionJobStatus,
    JobProgress,
    MemoryService,
    PersonalHowToService,
} from "./types.js";
import { validateProcedureSaveRequest } from "./agentEdition.js";
import type { MemoryViewService } from "./viewTypes.js";

export interface MemoryJobWaitOptions {
    signal?: AbortSignal;
    onProgress?: (progress: JobProgress) => void;
    pollIntervalMs?: number;
}

function unsupportedCapability(operation: string): Promise<never> {
    return Promise.reject(new Error(`Memory ${operation} are not supported`));
}

export function createMemoryServiceRpcFacade(
    service: MemoryService & Partial<PersonalHowToService & MemoryViewService>,
): MemoryService & PersonalHowToService & MemoryViewService {
    return {
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
        listRunbookJobs: (corpusId) =>
            service.listRunbookJobs?.(corpusId) ??
            unsupportedCapability("runbook jobs"),
        getRunbookJob: (jobId) =>
            service.getRunbookJob?.(jobId) ??
            unsupportedCapability("runbook jobs"),
        requestRunbookSynthesis: (request) =>
            service.requestRunbookSynthesis?.(request) ??
            unsupportedCapability("runbook synthesis"),
        listSources: (...args) => service.listSources(...args),
        listSourcesPage: (...args) => service.listSourcesPage(...args),
        getSource: (...args) => service.getSource(...args),
        getSourceContent: (...args) => service.getSourceContent(...args),
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
        getPersonalHowToSettings: (...args) =>
            service.getPersonalHowToSettings!(...args),
        updatePersonalHowToSettings: (...args) =>
            service.updatePersonalHowToSettings!(...args),
        createProcedureCandidate: (...args) =>
            service.createProcedureCandidate!(...args),
        getProcedureCandidate: (...args) =>
            service.getProcedureCandidate!(...args),
        listProcedureCandidates: (...args) =>
            service.listProcedureCandidates!(...args),
        rejectProcedureCandidate: (...args) =>
            service.rejectProcedureCandidate!(...args),
        saveProcedure: async (request) => {
            validateProcedureSaveRequest(request);
            return service.saveProcedure!(request);
        },
        listProcedures: (...args) => service.listProcedures!(...args),
        getProcedure: (...args) => service.getProcedure!(...args),
        searchProcedures: (...args) => service.searchProcedures!(...args),
        archiveProcedure: (...args) => service.archiveProcedure!(...args),
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
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, interval);
            options.signal?.addEventListener(
                "abort",
                () => {
                    clearTimeout(timeout);
                    reject(
                        options.signal?.reason ??
                            new Error("Job wait cancelled"),
                    );
                },
                { once: true },
            );
        });
    }
}
