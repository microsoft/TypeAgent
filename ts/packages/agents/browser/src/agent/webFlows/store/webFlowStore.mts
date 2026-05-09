// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebFlowDefinition,
    WebFlowIndex,
    WebFlowIndexEntry,
    WebFlowParameterMeta,
    WebFlowScope,
} from "../types.js";
import { Storage } from "@typeagent/agent-sdk";
import {
    generateGrammarRuleText,
    assembleDynamicGrammar,
    generateFlowActionTypes,
    buildUnionType,
} from "@typeagent/agent-flows";

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

        // Backfill existing entries that lack parameter metadata or grammar text
        await this.backfillIndex();
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

        // Extract parameter metadata for grammar/schema generation
        const paramMeta: WebFlowParameterMeta[] = Object.entries(
            flow.parameters,
        ).map(([name, p]) => ({
            name,
            type: p.type,
            required: p.required,
            description: p.description,
            ...(p.valueOptions ? { valueOptions: p.valueOptions } : {}),
        }));

        const grammarRuleText = generateGrammarRuleText(
            flow.name,
            flow.grammarPatterns,
        );

        // Update index
        this.index!.flows[flow.name] = {
            description: flow.description,
            scope: flow.scope,
            flowFile: flowPath,
            scriptFile: scriptPath,
            grammarRegistered: false,
            grammarRuleText,
            parameters: paramMeta,
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

        for (const [name, entry] of Object.entries(this.index?.flows ?? {})) {
            if (entry.scope.type === "global") {
                matches.push(name);
            } else if (entry.scope.domains?.some((d) => domain.endsWith(d))) {
                matches.push(name);
            }
        }

        return matches;
    }

    async listForDomainWithDetails(
        domain: string,
    ): Promise<WebFlowDefinition[]> {
        const names = await this.listForDomain(domain);
        const flows: WebFlowDefinition[] = [];
        for (const name of names) {
            const flow = await this.get(name);
            if (flow) flows.push(flow);
        }
        return flows;
    }

    async listAllWithDetails(): Promise<WebFlowDefinition[]> {
        const names = await this.getFlowNames();
        const flows: WebFlowDefinition[] = [];
        for (const name of names) {
            const flow = await this.get(name);
            if (flow) flows.push(flow);
        }
        return flows;
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

    // ── Dynamic grammar ────────────────────────────────────────────────

    getDynamicGrammarText(): string {
        return assembleDynamicGrammar(Object.values(this.index?.flows ?? {}));
    }

    // ── Dynamic schema ─────────────────────────────────────────────────

    generateDynamicSchemaText(): string {
        const entries = Object.entries(this.index?.flows ?? {});

        const flowNames = entries.map(([name]) => name);
        const flowNameType =
            flowNames.length > 0
                ? flowNames.map((n) => `"${n}"`).join(" | ")
                : "string";

        const builtInTypes = [
            "// List available web flows",
            "export type ListWebFlows = {",
            '    actionName: "listWebFlows";',
            "    parameters: {",
            '        scope?: "site" | "global" | "all";',
            "    };",
            "};",
            "",
            "// Delete a web flow by name",
            "export type DeleteWebFlow = {",
            '    actionName: "deleteWebFlow";',
            "    parameters: {",
            "        name: string;",
            "    };",
            "};",
            "",
            "// Edit an existing web flow script",
            "export type EditWebFlow = {",
            '    actionName: "editWebFlow";',
            "    parameters: {",
            `        name: ${flowNameType};`,
            "        script: string;",
            "        description?: string;",
            "    };",
            "};",
        ].join("\n");

        // Build flow entries with scope labels in descriptions
        const flowEntries = entries.map(([name, entry]) => {
            const scopeLabel =
                entry.scope.type === "site" && entry.scope.domains
                    ? ` [${entry.scope.domains.join(", ")}]`
                    : "";
            return {
                actionName: name,
                description: `${entry.description}${scopeLabel}`,
                parameters: entry.parameters,
            };
        });

        const { typeDefinitions, typeNames } =
            generateFlowActionTypes(flowEntries);

        const allTypeNames = [
            "ListWebFlows",
            "DeleteWebFlow",
            "EditWebFlow",
            ...typeNames,
        ];

        return [
            builtInTypes,
            typeDefinitions,
            "",
            buildUnionType("WebFlowActions", allTypeNames),
            "",
        ].join("\n");
    }

    // ── Similarity search ──────────────────────────────────────────────

    findSimilar(
        description: string,
        domains?: string[],
    ): Array<{ name: string; entry: WebFlowIndexEntry; score: number }> {
        const descTokens = new Set(
            description
                .toLowerCase()
                .split(/\W+/)
                .filter((t) => t.length > 2),
        );

        const results: Array<{
            name: string;
            entry: WebFlowIndexEntry;
            score: number;
        }> = [];

        for (const [name, entry] of Object.entries(this.index?.flows ?? {})) {
            let score = 0;

            // Domain match
            if (domains && entry.scope.type === "site") {
                const domainMatch = entry.scope.domains?.some((d) =>
                    domains.some((qd) => qd.endsWith(d) || d.endsWith(qd)),
                );
                if (domainMatch) score += 2;
                else continue; // Different domain — not similar
            }

            // Description keyword overlap
            const entryTokens = new Set(
                entry.description
                    .toLowerCase()
                    .split(/\W+/)
                    .filter((t) => t.length > 2),
            );
            let overlap = 0;
            for (const t of descTokens) {
                if (entryTokens.has(t)) overlap++;
            }
            if (descTokens.size > 0) {
                score += (overlap / descTokens.size) * 3;
            }

            // Parameter name overlap
            const existingParams = new Set(
                (entry.parameters ?? []).map((p) => p.name.toLowerCase()),
            );
            if (existingParams.size > 0 && descTokens.size > 0) {
                let paramOverlap = 0;
                for (const t of descTokens) {
                    if (existingParams.has(t)) paramOverlap++;
                }
                score += paramOverlap;
            }

            if (score > 1.5) {
                results.push({ name, entry, score });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }

    // ── Internal ───────────────────────────────────────────────────────

    private async backfillIndex(): Promise<void> {
        if (!this.storage || !this.index) return;
        let updated = false;

        for (const [name, entry] of Object.entries(this.index.flows)) {
            if (entry.parameters && entry.grammarRuleText) continue;

            try {
                const flow = await this.get(name);
                if (!flow) continue;

                if (!entry.parameters) {
                    entry.parameters = Object.entries(flow.parameters).map(
                        ([pName, p]) => ({
                            name: pName,
                            type: p.type,
                            required: p.required,
                            description: p.description,
                            ...(p.valueOptions
                                ? { valueOptions: p.valueOptions }
                                : {}),
                        }),
                    );
                    updated = true;
                }

                if (
                    !entry.grammarRuleText &&
                    flow.grammarPatterns?.length > 0
                ) {
                    entry.grammarRuleText = generateGrammarRuleText(
                        name,
                        flow.grammarPatterns,
                    );
                    updated = true;
                }
            } catch {
                // Skip flows we can't read
            }
        }

        if (updated) {
            await this.saveIndex();
        }
    }

    resetInitialized(): void {
        this.initialized = false;
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }
}

// ── Grammar generation (uses @typeagent/workflow) ──────────────────────────

function createEmptyIndex(): WebFlowIndex {
    return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        flows: {},
    };
}
