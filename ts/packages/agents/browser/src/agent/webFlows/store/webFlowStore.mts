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
        const ruleNames: string[] = [];
        const ruleTexts: string[] = [];

        for (const entry of Object.values(this.index?.flows ?? {})) {
            if (!entry.grammarRuleText) continue;
            ruleTexts.push(entry.grammarRuleText);
            for (const line of entry.grammarRuleText.split("\n")) {
                const m = line.match(/^<(\w+)>/);
                if (m && !ruleNames.includes(m[1])) {
                    ruleNames.push(m[1]);
                }
            }
        }

        if (ruleNames.length === 0) return "";

        const startRule = `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
        return `${startRule}\n\n${ruleTexts.join("\n\n")}`;
    }

    // ── Dynamic schema ─────────────────────────────────────────────────

    generateDynamicSchemaText(): string {
        const entries = Object.entries(this.index?.flows ?? {});

        const lines: string[] = [
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
        ];

        const flowTypeNames: string[] = [];
        for (const [name, entry] of entries) {
            const typeName =
                name.charAt(0).toUpperCase() + name.slice(1) + "Action";
            flowTypeNames.push(typeName);

            const scopeLabel =
                entry.scope.type === "site" && entry.scope.domains
                    ? ` [${entry.scope.domains.join(", ")}]`
                    : "";

            lines.push("");
            lines.push(`// ${entry.description}${scopeLabel}`);
            lines.push(`export type ${typeName} = {`);
            lines.push(`    actionName: "${name}";`);

            if ((entry.parameters ?? []).length > 0) {
                lines.push("    parameters: {");
                for (const p of entry.parameters ?? []) {
                    const tsType =
                        p.type === "number"
                            ? "number"
                            : p.type === "boolean"
                              ? "boolean"
                              : "string";
                    const opt = p.required ? "" : "?";
                    const comment = p.valueOptions?.length
                        ? ` // Options: ${p.valueOptions.join(", ")}`
                        : "";
                    lines.push(`        ${p.name}${opt}: ${tsType};${comment}`);
                }
                lines.push("    };");
            }

            lines.push("};");
        }

        lines.push("");
        lines.push("export type WebFlowActions =");
        lines.push("    | ListWebFlows");
        lines.push("    | DeleteWebFlow");
        for (const typeName of flowTypeNames) {
            lines.push(`    | ${typeName}`);
        }
        lines.push(";");
        lines.push("");

        return lines.join("\n");
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

// ── Grammar generation ──────────────────────────────────────────────────────

function generateGrammarRuleText(
    actionName: string,
    grammarPatterns: string[],
): string {
    const rules: string[] = [];

    for (const pattern of grammarPatterns) {
        const captures = [...pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";

        rules.push(
            `<${actionName}> [spacing=optional] = ${pattern}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }

    return rules.join("\n");
}

function createEmptyIndex(): WebFlowIndex {
    return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        flows: {},
    };
}
