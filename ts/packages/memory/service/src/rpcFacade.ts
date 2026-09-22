// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IngestionJobStatus,
    JobProgress,
    MemoryService,
} from "./types.js";

export interface MemoryJobWaitOptions {
    signal?: AbortSignal;
    onProgress?: (progress: JobProgress) => void;
    pollIntervalMs?: number;
}

export function createMemoryServiceRpcFacade(
    service: MemoryService,
): MemoryService {
    return {
        createCorpus: (...args) => service.createCorpus(...args),
        listCorpora: (...args) => service.listCorpora(...args),
        getCorpus: (...args) => service.getCorpus(...args),
        clearCorpus: (...args) => service.clearCorpus(...args),
        listSources: (...args) => service.listSources(...args),
        listSourcesPage: (...args) => service.listSourcesPage(...args),
        getSource: (...args) => service.getSource(...args),
        getSourceContent: (...args) => service.getSourceContent(...args),
        getSourceKnowledge: (...args) => service.getSourceKnowledge(...args),
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
