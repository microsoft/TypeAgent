
import type { ChatHistoryInput } from "agent-dispatcher/internal";

import type {
    TranslationBenchOrder,
    OpenAIFunctionTool,
    TranslationBenchPublicTurnLineage,
} from "./benchmark.js";

export interface TranslationBenchSourceManifest {
    dataset: string;
    revision: string;
    config: string;
    split: string;
    sourceUrl: string;
    sourceFileHash: string;
}

export interface TranslationBenchSourceCall {
    name: string;
    parameters: Record<string, unknown>;
}

export interface TranslationBenchSourceCandidate {
    candidateId: string;
    lineage: Omit<TranslationBenchPublicTurnLineage, "canonicalPayloadHash">;
    rawRow: unknown;
    sourceSlice: unknown;
    utterance: string;
    history?: ChatHistoryInput;
    order: TranslationBenchOrder;
    sourceTools: OpenAIFunctionTool[];
    sourceCalls: TranslationBenchSourceCall[];
    sourceResponses: string[];
    dimensions: Record<string, string | number | boolean>;
}

export interface TranslationBenchSourceImportOptions {
    manifest: TranslationBenchSourceManifest;
    rowIndices?: number[];
    maxCandidates?: number;
    skipInvalidRows?: boolean;
}

export interface TranslationBenchSourceAdapter {
        readonly id: string;
        readonly description: string;
    importCandidates(
        sourceText: string,
        options: TranslationBenchSourceImportOptions,
    ): TranslationBenchSourceCandidate[];
}

const adapters = new Map<string, TranslationBenchSourceAdapter>();

export function registerTranslationBenchSourceAdapter(
    adapter: TranslationBenchSourceAdapter,
): void {
    if (!adapter.id.trim()) {
        throw new Error("Source adapter id is required");
    }
    adapters.set(adapter.id, adapter);
}

export function getTranslationBenchSourceAdapter(
    id: string,
): TranslationBenchSourceAdapter {
    const adapter = adapters.get(id);
    if (adapter === undefined) {
        const known = [...adapters.keys()].sort().join(", ") || "(none)";
        throw new Error(
            `Unknown source adapter '${id}'. Registered: ${known}. ` +
                `Private format adapters belong under local/ (gitignored).`,
        );
    }
    return adapter;
}

export function listTranslationBenchSourceAdapters(): TranslationBenchSourceAdapter[] {
    return [...adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
}
