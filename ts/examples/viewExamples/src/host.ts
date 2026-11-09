// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ChatModel } from "@typeagent/aiclient";
import { type DocMemorySettings } from "@typeagent/conversation-memory";
import { createTextEmbeddingIndexSettings } from "@typeagent/knowpro";
import {
    FileMemoryService,
    extensionViewId,
    inspectMemoryViewPackage,
    loadMemoryViewPackage,
    viewExtensionDigest,
    waitForMemoryJob,
    type FileMemoryServiceOptions,
    type ViewBuildJob,
    type ViewDefinitionInput,
    type ViewExtensionProvider,
    type ViewVersion,
} from "@typeagent/memory-service";
import { viewContentToText } from "@typeagent/memory-service/view-text";
import { parseProcedureSource } from "./procedural/contract.js";
import {
    procedureProviderId,
    procedureDefinitionId,
} from "./procedural/provider.js";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const offlineModel: ChatModel = {
    completionSettings: {},
    complete: async () => {
        throw new Error("Offline procedural example forbids model inference");
    },
};

export function offlineIndexSettings(): DocMemorySettings {
    const embedding = createTextEmbeddingIndexSettings(undefined, 0);
    const lexicalKnowledge = (message: string) => ({
        entities: [],
        actions: [],
        inverseActions: [],
        topics: [
            ...new Set(
                message.toLocaleLowerCase().match(/[\p{L}\p{N}-]{3,}/gu) ?? [],
            ),
        ],
    });
    return {
        languageModel: offlineModel,
        embeddingModel: undefined,
        embeddingSize: 0,
        conversationSettings: {
            relatedTermIndexSettings: { embeddingIndexSettings: embedding },
            threadSettings: embedding,
            messageTextIndexSettings: { embeddingIndexSettings: embedding },
            semanticRefIndexSettings: {
                autoExtractKnowledge: true,
                batchSize: 4,
                knowledgeExtractor: {
                    settings: { maxContextLength: 120000 },
                    extract: async (message) => lexicalKnowledge(message),
                    extractWithRetry: async (message) => ({
                        success: true,
                        data: lexicalKnowledge(message),
                    }),
                },
            },
        },
    };
}

export function hostOptions(
    providers: ViewExtensionProvider[],
    indexSettingsFactory: FileMemoryServiceOptions["indexSettingsFactory"] = offlineIndexSettings,
): FileMemoryServiceOptions {
    return {
        extensionProviders: providers,
        extensionBuilds: true,
        extensionDiscovery: false,
        viewDrafts: false,
        informationalViews: false,
        sourceSynopses: false,
        discoveryPolicy: "off",
        maintenanceMode: "manual",
        indexSettingsFactory,
    };
}

export async function settleBuild(
    service: FileMemoryService,
    job: ViewBuildJob,
    timeoutMs = 60000,
): Promise<ViewBuildJob> {
    const deadline = Date.now() + timeoutMs;
    while (["pending", "running"].includes(job.state)) {
        if (Date.now() >= deadline) {
            await service.cancelViewBuild({
                corpusId: job.corpusId,
                jobId: job.jobId,
            });
            throw new Error(
                `Procedural view build ${job.jobId} exceeded ${timeoutMs} milliseconds`,
            );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current)
            throw new Error(`Unknown procedural view build ${job.jobId}`);
        job = current;
    }
    return job;
}

export async function completedIngestion(
    service: FileMemoryService,
    jobId: string,
): Promise<void> {
    const job = await waitForMemoryJob(service, jobId, {
        pollIntervalMs: 10,
        signal: AbortSignal.timeout(60000),
    });
    if (job.state !== "complete")
        throw new Error(
            `Source ingestion ${jobId} ended ${job.state}: ${JSON.stringify(job.progress)}`,
        );
}

export function procedureDefinition(
    provider: ViewExtensionProvider,
    procedureId: string,
    sources: ViewDefinitionInput["selector"]["sources"],
): ViewDefinitionInput {
    return {
        viewId: extensionViewId(
            provider.descriptor.identity.providerId,
            procedureDefinitionId,
            procedureId,
        ),
        kind: "extension",
        selector: { kind: "sources", sources },
        extension: {
            ...provider.descriptor.identity,
            definitionId: procedureDefinitionId,
            eligibilityVersion: "1",
            targetKey: procedureId,
            policyDigest: viewExtensionDigest([
                "explicit-example-corpus-and-source-allowlist",
                sources,
            ]),
            parameters: {},
        },
    };
}

export async function buildProcedure(
    service: FileMemoryService,
    corpusId: string,
    definition: ViewDefinitionInput,
    expectedVersion = 0,
    timeoutMs = 60000,
): Promise<{ job: ViewBuildJob; view: ViewVersion }> {
    const job = await settleBuild(
        service,
        await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [{ definition, expectedVersion }],
            publication: false,
        }),
        timeoutMs,
    );
    const target = job.results[0];
    if (
        job.state !== "complete" ||
        job.results.length !== 1 ||
        target.state !== "draft" ||
        !target.revisionId
    )
        throw new Error(
            `Procedure build ${job.jobId} ended ${job.state}: ${JSON.stringify(job.results.map(({ viewId, state, reason, revisionId }) => ({ viewId, state, reason, revisionId })))}`,
        );
    const view = await service.getView({
        corpusId,
        viewId: definition.viewId,
        revisionId: target.revisionId,
    });
    if (!view || view.content.kind !== "extension")
        throw new Error(
            "Completed procedure target has no readable extension revision",
        );
    return { job, view };
}

export async function runExample(options: {
    outputDirectory: string;
    publish?: boolean;
    indexSettingsFactory?: FileMemoryServiceOptions["indexSettingsFactory"];
}): Promise<{
    corpusId: string;
    viewId: string;
    revisionId: string;
    outputDirectory: string;
}> {
    const directory = path.resolve(options.outputDirectory);
    // Refuse reuse: a run owns one new memory directory, never existing user data.
    await mkdir(directory);
    const text = await readFile(
        path.join(packageRoot, "fixtures", "connectivity.jsonl"),
        "utf8",
    );
    const document = parseProcedureSource(text);
    const data = path.join(directory, "memory");
    let service = new FileMemoryService(
        data,
        hostOptions([], options.indexSettingsFactory),
    );
    const corpus = await service
        .createCorpus("Original fictional procedure example")
        .finally(() => service.close());
    const sourceId = "fictional-connectivity";
    const installation = await inspectMemoryViewPackage(packageRoot);
    const providers = await loadMemoryViewPackage(installation, [
        {
            providerId: procedureProviderId,
            context: {
                corpusId: corpus.corpusId,
                sourceIds: [sourceId],
                authorize: async (_snapshot: unknown, operation: string) =>
                    operation !== "publish" || options.publish === true,
            },
        },
    ]);
    service = new FileMemoryService(
        data,
        hostOptions(providers, options.indexSettingsFactory),
    );
    try {
        const ingestion = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: document.header.title,
                text,
            },
            pipeline: { mode: "content" },
        });
        await completedIngestion(service, ingestion.jobId);
        const source = await service.getSource(corpus.corpusId, sourceId);
        if (!source?.activeRevisionId)
            throw new Error(
                "Completed source ingestion has no active revision",
            );
        const definition = procedureDefinition(
            providers[0],
            document.header.procedureId,
            [{ sourceId, revisionId: source.activeRevisionId }],
        );
        const { view, job } = await buildProcedure(
            service,
            corpus.corpusId,
            definition,
        );
        const before = await service.searchViews({
            corpusId: corpus.corpusId,
            query: "indicator",
            freshness: "current",
        });
        if (before.length)
            throw new Error(
                "An unpublished draft unexpectedly appeared in view search",
            );
        if (options.publish) {
            const head = (await service.listViews(corpus.corpusId)).head;
            if (!head) throw new Error("Built view has no publication head");
            await service.publishView({
                corpusId: corpus.corpusId,
                viewId: view.viewId,
                revisionId: view.revisionId,
                expectedVersion: view.version,
                expectedHead: head,
            });
        }
        const publication = await service.getViewPublication({
            corpusId: corpus.corpusId,
            viewId: view.viewId,
        });
        const matches = await service.searchViews({
            corpusId: corpus.corpusId,
            query: "indicator",
            freshness: "current",
        });
        if (
            options.publish &&
            (publication.publishedRevisionId !== view.revisionId ||
                publication.indexedRevisionId !== view.revisionId ||
                publication.indexState !== "ready" ||
                publication.blockedReason ||
                matches.length !== 1)
        )
            throw new Error(
                `Published procedure is not independently indexed/searchable: ${JSON.stringify(publication)}`,
            );
        const rendered = viewContentToText(view.content);
        await writeFile(path.join(directory, "procedure.txt"), rendered);
        await writeFile(
            path.join(directory, "view.json"),
            JSON.stringify(view, null, 2),
        );
        await service.close();
        service = new FileMemoryService(
            data,
            hostOptions(providers, options.indexSettingsFactory),
        );
        const reopened = await service.getView({
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
        });
        if (!reopened || viewContentToText(reopened.content) !== rendered)
            throw new Error(
                "Procedure render changed or disappeared after service restart",
            );
        await writeFile(
            path.join(directory, "result.json"),
            JSON.stringify(
                {
                    mode: options.indexSettingsFactory
                        ? "explicit-host-ingestion"
                        : "offline-lexical-knowpro",
                    installation,
                    corpusId: corpus.corpusId,
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                    target: {
                        state: job.results[0].state,
                        reason: job.results[0].reason,
                    },
                    publication,
                    searchMatches: matches.length,
                    restartVerified: true,
                    execution: "guidance-only",
                },
                null,
                2,
            ),
        );
        return {
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            outputDirectory: directory,
        };
    } finally {
        await service.close();
    }
}
