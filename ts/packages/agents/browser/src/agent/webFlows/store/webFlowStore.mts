// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebFlowDefinition,
    WebFlowIndex,
    WebFlowIndexEntry,
    WebFlowScope,
} from "../types.js";
import { Storage } from "@typeagent/agent-sdk";

/**
 * Persistent storage for WebFlow definitions and scripts.
 * Uses instance storage (persists across sessions).
 *
 * Directory layout:
 *   registry/webflow-index.json
 *   flows/global/{name}.json
 *   flows/sites/{domain}/{name}.json
 *   scripts/{name}.js
 */
export class WebFlowStore {
    private index: WebFlowIndex | undefined;
    private initialized = false;

    constructor(private storage: Storage | undefined) {}

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (!this.storage) {
            this.index = createEmptyIndex();
            this.initialized = true;
            return;
        }

        try {
            const indexData = await this.storage.read(
                "registry/webflow-index.json",
                "utf8",
            );
            this.index = indexData ? JSON.parse(indexData) : createEmptyIndex();
        } catch {
            this.index = createEmptyIndex();
        }
        this.initialized = true;
    }

    async save(flow: WebFlowDefinition): Promise<void> {
        await this.ensureInitialized();
        if (!this.storage) {
            throw new Error("No storage available");
        }

        const flowPath = this.getFlowPath(flow.name, flow.scope);
        const scriptPath = `scripts/${flow.name}.js`;

        // Write flow metadata (without script)
        const { script, ...metadata } = flow;
        await this.storage.write(flowPath, JSON.stringify(metadata, null, 4));

        // Write script separately
        await this.storage.write(scriptPath, script);

        // Update index
        this.index!.flows[flow.name] = {
            description: flow.description,
            scope: flow.scope,
            flowFile: flowPath,
            scriptFile: scriptPath,
            grammarRegistered: false,
            source: flow.source.type,
            created: flow.source.timestamp,
        };
        this.index!.lastUpdated = new Date().toISOString();

        await this.saveIndex();
    }

    async get(name: string): Promise<WebFlowDefinition | undefined> {
        await this.ensureInitialized();
        if (!this.storage) return undefined;

        const entry = this.index?.flows[name];
        if (!entry) return undefined;

        try {
            const metadataJson = await this.storage.read(
                entry.flowFile,
                "utf8",
            );
            const scriptContent = await this.storage.read(
                entry.scriptFile,
                "utf8",
            );
            if (!metadataJson || !scriptContent) return undefined;

            const metadata = JSON.parse(metadataJson);
            return { ...metadata, script: scriptContent };
        } catch {
            return undefined;
        }
    }

    async delete(name: string): Promise<boolean> {
        await this.ensureInitialized();
        if (!this.storage) return false;

        const entry = this.index?.flows[name];
        if (!entry) return false;

        try {
            await this.storage.delete(entry.flowFile);
            await this.storage.delete(entry.scriptFile);
        } catch {
            // Files may already be gone
        }

        delete this.index!.flows[name];
        this.index!.lastUpdated = new Date().toISOString();
        await this.saveIndex();
        return true;
    }

    async listAll(): Promise<WebFlowIndexEntry[]> {
        await this.ensureInitialized();
        return Object.values(this.index?.flows ?? {});
    }

    async listForDomain(domain: string): Promise<string[]> {
        await this.ensureInitialized();
        const matches: string[] = [];

        for (const [name, entry] of Object.entries(
            this.index?.flows ?? {},
        )) {
            if (entry.scope.type === "global") {
                matches.push(name);
            } else if (
                entry.scope.domains?.some((d) => domain.endsWith(d))
            ) {
                matches.push(name);
            }
        }

        return matches;
    }

    async getFlowNames(): Promise<string[]> {
        await this.ensureInitialized();
        return Object.keys(this.index?.flows ?? {});
    }

    getIndex(): WebFlowIndex {
        return this.index ?? createEmptyIndex();
    }

    async markGrammarRegistered(
        name: string,
        registered: boolean,
    ): Promise<void> {
        await this.ensureInitialized();
        const entry = this.index?.flows[name];
        if (entry) {
            entry.grammarRegistered = registered;
            await this.saveIndex();
        }
    }

    private getFlowPath(name: string, scope: WebFlowScope): string {
        if (scope.type === "global") {
            return `flows/global/${name}.json`;
        }
        const domain = scope.domains?.[0] ?? "unknown";
        const safeDomain = domain.replace(/\./g, "_");
        return `flows/sites/${safeDomain}/${name}.json`;
    }

    private async saveIndex(): Promise<void> {
        if (!this.storage || !this.index) return;
        await this.storage.write(
            "registry/webflow-index.json",
            JSON.stringify(this.index, null, 4),
        );
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }
}

function createEmptyIndex(): WebFlowIndex {
    return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        flows: {},
    };
}

