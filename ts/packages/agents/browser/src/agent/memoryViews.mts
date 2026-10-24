// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryCenterInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    MemoryService,
    MemoryViewService,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import type { MemoryAcquisitionProgressService } from "@typeagent/memory-client";
import {
    knowledgeCorpusRequestSchema,
    knowledgeDiscoveryUpdateSchema,
    knowledgeCheckpointRequestSchema,
    knowledgeCheckpointReadSchema,
    knowledgeCheckpointWaitSchema,
} from "@typeagent/memory-client";
import {
    acquisitionProgress,
    acquisitionOperation,
} from "./memoryAcquisitionProgress.mjs";

type ViewMethods = Pick<
    MemoryCenterInvokeFunctions,
    | "memoryViewCapabilities"
    | "memoryQueryTopics"
    | "memoryRebuildTopics"
    | "memoryListViews"
    | "memoryListQuestions"
    | "memoryGetKnowledgeStatus"
    | "memoryUpdateKnowledgeDiscovery"
    | "memoryCreateKnowledgeCheckpoint"
    | "memoryGetKnowledgeCheckpoint"
    | "memoryWaitForKnowledgeCheckpoint"
    | "memoryListAcquisitions"
    | "memoryRunAcquisitions"
    | "memoryCancelAcquisition"
    | "memoryEditQuestion"
    | "memoryGetViewPage"
    | "memoryProposeSchemaView"
    | "memoryDiscoverSchemaQuestions"
    | "memoryGetView"
    | "memorySaveViewDraft"
    | "memoryArchiveView"
    | "memoryViewHistory"
    | "memoryGetViewPublicationPolicy"
    | "memoryUpdateViewPublicationPolicy"
    | "memoryGetViewPublication"
    | "memoryPublishView"
    | "memoryRetryViewIndex"
    | "memorySearchViews"
    | "memoryBuildViews"
    | "memoryPlanViewMaintenance"
    | "memoryMaintainViews"
    | "memoryUpdateViewMaintenance"
    | "memoryGetViewMaintenance"
    | "memoryGetViewBuild"
    | "memoryListViewBuilds"
    | "memoryCancelViewBuild"
    | "memoryRetryViewBuild"
    | "memoryGetViewConflict"
    | "memoryResolveViewConflict"
>;

export function createMemoryViewFunctions(
    service: () => MemoryService & Partial<MemoryViewService>,
): ViewMethods {
    const views = () => createMemoryServiceRpcFacade(service());
    const progressClient = () =>
        service() as MemoryService &
            Partial<MemoryViewService & MemoryAcquisitionProgressService>;
    function required<K extends keyof MemoryViewService>(
        name: K,
    ): NonNullable<MemoryViewService[K]> {
        const value = service();
        const method = value[name];
        if (typeof method !== "function")
            throw new Error(
                `Schema-defined questions capability unavailable: ${String(name)}`,
            );
        return method.bind(value) as NonNullable<MemoryViewService[K]>;
    }
    return {
        memoryGetKnowledgeStatus: (request) =>
            views().getKnowledgeStatus(
                knowledgeCorpusRequestSchema.parse(request).corpusId,
            ),
        memoryUpdateKnowledgeDiscovery: (request) => {
            const { corpusId, policy, retryFailed } =
                knowledgeDiscoveryUpdateSchema.parse(request);
            return views().updateKnowledgeDiscovery({
                corpusId,
                policy,
                ...(retryFailed === undefined ? {} : { retryFailed }),
            });
        },
        memoryCreateKnowledgeCheckpoint: (request) => {
            const {
                corpusId,
                sourceIds,
                families,
                producerComplete,
                timeoutMs,
            } = knowledgeCheckpointRequestSchema.parse(request);
            return views().createKnowledgeCheckpoint({
                corpusId,
                ...(sourceIds === undefined ? {} : { sourceIds }),
                ...(families === undefined ? {} : { families }),
                ...(producerComplete === undefined ? {} : { producerComplete }),
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
            });
        },
        memoryGetKnowledgeCheckpoint: (request) =>
            views().getKnowledgeCheckpoint(
                knowledgeCheckpointReadSchema.parse(request),
            ),
        memoryWaitForKnowledgeCheckpoint: (request) => {
            const { corpusId, checkpointId, timeoutMs } =
                knowledgeCheckpointWaitSchema.parse(request);
            return views().waitForKnowledgeCheckpoint({
                corpusId,
                checkpointId,
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
            });
        },
        memoryViewCapabilities: () => service().getCapabilities(),
        memoryQueryTopics: (request) => views().queryTopics(request),
        memoryRebuildTopics: ({ corpusId }) => views().rebuildTopics(corpusId),
        memoryListViews: ({ corpusId }) => views().listViews(corpusId),
        memoryListQuestions: ({ corpusId }) =>
            required("listQuestions")(corpusId),
        memoryListAcquisitions: ({ corpusId }) =>
            acquisitionOperation(async () => {
                const client = progressClient();
                if (client.listAcquisitionProgress)
                    return client.listAcquisitionProgress(corpusId);
                return (await required("listAcquisitions")(corpusId)).map(
                    acquisitionProgress,
                );
            }),
        memoryRunAcquisitions: ({ corpusId }) =>
            acquisitionOperation(async () => {
                const client = progressClient();
                if (client.runAcquisitionProgress)
                    return client.runAcquisitionProgress(corpusId);
                return (await required("runAcquisitions")(corpusId)).map(
                    acquisitionProgress,
                );
            }),
        memoryCancelAcquisition: (request) =>
            acquisitionOperation(async () => {
                const client = progressClient();
                if (client.cancelAcquisitionProgress)
                    return client.cancelAcquisitionProgress(request);
                return acquisitionProgress(
                    await required("cancelAcquisition")(request),
                );
            }),
        memoryEditQuestion: (request) => required("editQuestion")(request),
        memoryGetViewPage: (request) => required("getViewPage")(request),
        memoryProposeSchemaView: (request) =>
            required("proposeSchemaView")(request),
        memoryDiscoverSchemaQuestions: (request) =>
            required("discoverSchemaQuestions")(request),
        memoryGetView: (request) => views().getView(request),
        memorySaveViewDraft: (request) => views().saveViewDraft(request),
        memoryArchiveView: (request) => views().archiveView(request),
        memoryViewHistory: (request) => views().getViewHistory(request),
        memoryGetViewPublicationPolicy: ({ corpusId }) =>
            views().getViewPublicationPolicy(corpusId),
        memoryUpdateViewPublicationPolicy: (request) =>
            views().updateViewPublicationPolicy(request),
        memoryGetViewPublication: (request) =>
            views().getViewPublication(request),
        memoryPublishView: (request) => views().publishView(request),
        memoryRetryViewIndex: (request) => views().retryViewIndex(request),
        memorySearchViews: (request) => views().searchViews(request),
        memoryBuildViews: (request) => views().buildViews(request),
        memoryPlanViewMaintenance: (request) =>
            views().planViewMaintenance(request),
        memoryMaintainViews: (request) => views().maintainViews(request),
        memoryUpdateViewMaintenance: (request) =>
            views().updateViewMaintenance(request),
        memoryGetViewMaintenance: (request) =>
            views().getViewMaintenance(request),
        memoryGetViewBuild: (request) => views().getViewBuild(request),
        memoryListViewBuilds: ({ corpusId }) =>
            views().listViewBuilds(corpusId),
        memoryCancelViewBuild: (request) => views().cancelViewBuild(request),
        memoryRetryViewBuild: (request) => views().retryViewBuild(request),
        memoryGetViewConflict: (request) => views().getViewConflict(request),
        memoryResolveViewConflict: (request) =>
            views().resolveViewConflict(request),
    };
}
