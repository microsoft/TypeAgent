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
    | "memoryBuildViews"
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
        memoryBuildViews: (request) => views().buildViews(request),
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
