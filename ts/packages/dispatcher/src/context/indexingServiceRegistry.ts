// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Indexing Service Registry
 * Manages registration and discovery of indexing services from agent manifests
 */

export interface IndexingServiceInfo {
    agentName: string;
    serviceScript: string;
    description?: string;
}

export interface IndexingServiceRegistry {
    get(indexSource: string): IndexingServiceInfo | undefined;
    register(indexSource: string, serviceInfo: IndexingServiceInfo): void;
    getRegisteredSources(): string[];
    size(): number;
}

export class DefaultIndexingServiceRegistry implements IndexingServiceRegistry {
    private services = new Map<string, IndexingServiceInfo>();

    get(indexSource: string): IndexingServiceInfo | undefined {
        return this.services.get(indexSource);
    }

    register(indexSource: string, serviceInfo: IndexingServiceInfo): void {
        this.services.set(indexSource, serviceInfo);
    }

    getRegisteredSources(): string[] {
        return Array.from(this.services.keys());
    }

    size(): number {
        return this.services.size;
    }
}
