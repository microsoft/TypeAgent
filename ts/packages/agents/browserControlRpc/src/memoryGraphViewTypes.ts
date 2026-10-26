// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryGraphQueryRequest,
    MemoryGraphQueryResult,
    MemoryGraphSupportRequest,
    MemoryGraphSupportPage,
} from "@typeagent/memory-service";

export type MemoryHubGraphRequest = Omit<
    MemoryGraphQueryRequest,
    "corpusId"
> & {
    corpusId?: string;
};

export interface MemoryHubGraphResult {
    corpora: Array<{
        corpusId: string;
        corpusName: string;
        graph: MemoryGraphQueryResult;
    }>;
    errors: Array<{ corpusId: string; message: string }>;
    omittedCorpora: number;
    presetLayout: {
        elements: Array<{
            data: Record<string, unknown> & { id: string };
            position?: { x: number; y: number };
        }>;
    };
}

export interface MemoryHubGraphFunctions {
    memoryHubGraph(
        request: MemoryHubGraphRequest,
    ): Promise<MemoryHubGraphResult>;
    memoryHubGraphSupport(
        request: MemoryGraphSupportRequest,
    ): Promise<MemoryGraphSupportPage>;
    memoryHubGraphEvent(request: {
        corpusId: string;
        eventId: string;
        offset?: number;
    }): Promise<{
        title: string;
        content: string;
        offset: number;
        totalChars: number;
        nextOffset?: number;
    }>;
}
