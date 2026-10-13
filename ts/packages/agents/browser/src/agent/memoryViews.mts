// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryCenterInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    MemoryService,
    MemoryViewService,
} from "@typeagent/memory-service";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";

type ViewMethods = Pick<
    MemoryCenterInvokeFunctions,
    | "memoryViewCapabilities"
    | "memoryListViews"
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
    return {
        memoryViewCapabilities: () => service().getCapabilities(),
        memoryListViews: ({ corpusId }) => views().listViews(corpusId),
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
