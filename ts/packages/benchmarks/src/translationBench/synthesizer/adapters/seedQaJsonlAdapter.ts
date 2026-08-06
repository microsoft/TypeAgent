import { createHash } from "node:crypto";

import {
    isChatHistoryInput,
    type ChatHistoryInput,
} from "agent-dispatcher/internal";

import {
    computeTranslationBenchRawRowHash,
    computeTranslationBenchSourceSliceHash,
    type OpenAIFunctionTool,
} from "../benchmark.js";
import { z } from "zod";

import {
    registerTranslationBenchSourceAdapter,
    type TranslationBenchSourceAdapter,
    type TranslationBenchSourceCall,
    type TranslationBenchSourceCandidate,
    type TranslationBenchSourceImportOptions,
    type TranslationBenchSourceManifest,
} from "../sourceAdapter.js";
import { parseJsonText, parseWithZod } from "../zodJson.js";

const SHA256 = /^[a-f0-9]{64}$/;

function sha256Text(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value.trim();
}

function validateManifest(manifest: TranslationBenchSourceManifest): void {
    for (const [name, value] of Object.entries(manifest)) {
        requireString(value, `source manifest ${name}`);
    }
    if (!SHA256.test(manifest.sourceFileHash)) {
        throw new Error("source manifest has an invalid sourceFileHash");
    }
    const url = new URL(manifest.sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("source manifest URL must use HTTP(S)");
    }
}

function parseTools(
    value: unknown,
    rowLabel: string,
    calls: TranslationBenchSourceCall[],
): OpenAIFunctionTool[] {
    if (value === undefined) {
        // Infer stub tools from calls so the builder still has a contract.
        const byName = new Map<string, OpenAIFunctionTool>();
        for (const call of calls) {
            if (byName.has(call.name)) continue;
            byName.set(call.name, {
                type: "function",
                function: {
                    name: call.name,
                    description: `Seed tool ${call.name}`,
                    parameters: {
                        type: "object",
                        properties: Object.fromEntries(
                            Object.keys(call.parameters).map((key) => [
                                key,
                                { type: "string" },
                            ]),
                        ),
                        additionalProperties: true,
                    },
                },
            });
        }
        return [...byName.values()];
    }
    let parsed: unknown = value;
    if (typeof value === "string") {
        parsed = parseJsonText(value, `${rowLabel} tools`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`${rowLabel} tools must be an array`);
    }
    return parsed.map((tool, toolIndex) => {
        if (
            typeof tool !== "object" ||
            tool === null ||
            (tool as { type?: unknown }).type !== "function"
        ) {
            throw new Error(`${rowLabel} tool ${toolIndex} is not a function`);
        }
        const fn = (tool as { function?: unknown }).function;
        if (typeof fn !== "object" || fn === null) {
            throw new Error(`${rowLabel} tool ${toolIndex} has no function`);
        }
        const record = fn as Record<string, unknown>;
        const name = requireString(
            record.name,
            `${rowLabel} tool ${toolIndex} name`,
        );
        if (
            typeof record.parameters !== "object" ||
            record.parameters === null ||
            Array.isArray(record.parameters)
        ) {
            throw new Error(
                `${rowLabel} tool '${name}' has invalid parameters`,
            );
        }
        return {
            type: "function" as const,
            function: {
                name,
                ...(typeof record.description === "string"
                    ? { description: record.description }
                    : {}),
                parameters: structuredClone(
                    record.parameters as Record<string, unknown>,
                ),
            },
        };
    });
}

function parseCalls(
    value: unknown,
    rowLabel: string,
): TranslationBenchSourceCall[] {
    if (!Array.isArray(value)) {
        throw new Error(`${rowLabel} function_calls must be an array`);
    }
    return value.map((item, index) => {
        if (typeof item !== "object" || item === null) {
            throw new Error(`${rowLabel} function_calls[${index}] is invalid`);
        }
        const record = item as Record<string, unknown>;
        const name = requireString(
            record.function_name ?? record.name,
            `${rowLabel} function_calls[${index}] name`,
        );
        const args = record.arguments ?? record.parameters ?? {};
        if (
            typeof args !== "object" ||
            args === null ||
            Array.isArray(args)
        ) {
            throw new Error(
                `${rowLabel} function_calls[${index}] arguments must be an object`,
            );
        }
        return {
            name,
            parameters: structuredClone(args as Record<string, unknown>),
        };
    });
}

const seedQaRowV1Schema = z
    .object({
        version: z.literal(1).default(1),
        id: z.union([z.string(), z.number()]).optional(),
        query: z.string().optional(),
        question: z.string().optional(),
        utterance: z.string().optional(),
        tools: z.unknown().optional(),
        function_calls: z.unknown().optional(),
        calls: z.unknown().optional(),
        history: z.unknown().optional(),
        messages: z.unknown().optional(),
        category: z.unknown().optional(),
        dimensions: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

export const seedQaRowSchemas = {
    1: seedQaRowV1Schema,
} as const;

const seedQaRowEnvelopeSchema = z
    .object({ version: z.number().int().positive().default(1) })
    .passthrough();

function parseSeedQaRow(value: unknown, label: string): z.infer<typeof seedQaRowV1Schema> {
    const envelope = seedQaRowEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
        throw new Error(`${label}: invalid seed-qa row envelope`);
    }
    const version = envelope.data.version ?? 1;
    const schema = (seedQaRowSchemas as Record<number, z.ZodTypeAny>)[version];
    if (schema === undefined) {
        throw new Error(`${label}: unsupported seed-qa row version ${version}`);
    }
    return parseWithZod(schema, value, label) as z.infer<typeof seedQaRowV1Schema>;
}

function parseJsonl(text: string): unknown[] {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (lines.length === 0) {
        const trimmed = text.trim();
        if (trimmed.startsWith("[")) {
            const parsed = parseWithZod(
                z.array(z.unknown()),
                parseJsonText(trimmed, "seed-qa array"),
                "seed-qa array",
            );
            // Same versioned row gate as JSONL lines.
            return parsed.map((row, index) =>
                parseSeedQaRow(row, `seed-qa array[${index}]`),
            );
        }
        throw new Error("seed-qa source is empty");
    }
    return lines.map((line, index) =>
        parseSeedQaRow(parseJsonText(line, `seed-qa line ${index + 1}`), `seed-qa line ${index + 1}`),
    );
}

function importCandidates(
    sourceText: string,
    options: TranslationBenchSourceImportOptions,
): TranslationBenchSourceCandidate[] {
    validateManifest(options.manifest);
    if (sha256Text(sourceText) !== options.manifest.sourceFileHash) {
        throw new Error(
            "source file hash does not match the pinned manifest",
        );
    }
    const rows = parseJsonl(sourceText);
    const selectedRows =
        options.rowIndices ?? rows.map((_, rowIndex) => rowIndex);
    if (new Set(selectedRows).size !== selectedRows.length) {
        throw new Error("source row selection contains duplicates");
    }
    const maxCandidates = options.maxCandidates ?? Number.POSITIVE_INFINITY;
    if (!(maxCandidates > 0)) {
        throw new Error("source maxCandidates must be positive");
    }

    const candidates: TranslationBenchSourceCandidate[] = [];
    for (const rowIndex of selectedRows) {
        if (
            !Number.isInteger(rowIndex) ||
            rowIndex < 0 ||
            rowIndex >= rows.length
        ) {
            throw new Error(`source row index ${rowIndex} is out of range`);
        }
        try {
            const rawRow = rows[rowIndex];
            if (typeof rawRow !== "object" || rawRow === null) {
                throw new Error(`source row ${rowIndex} is invalid`);
            }
            const row = rawRow as Record<string, unknown>;
            const rowLabel = `seed-qa row ${rowIndex}`;
            const rowId =
                typeof row.id === "string" && row.id.trim()
                    ? row.id.trim()
                    : `row-${rowIndex}`;
            const utterance = requireString(
                row.query ?? row.question ?? row.utterance,
                `${rowLabel} query`,
            );
            const sourceCalls = parseCalls(
                row.function_calls ?? row.calls ?? row.expected_calls ?? [],
                rowLabel,
            );
            const sourceTools = parseTools(row.tools, rowLabel, sourceCalls);
            let history: ChatHistoryInput | undefined;
            if (row.history !== undefined) {
                if (!isChatHistoryInput(row.history)) {
                    throw new Error(`${rowLabel} has invalid history`);
                }
                history = structuredClone(row.history);
            }
            const order =
                row.order === "strict" || row.order === "any"
                    ? row.order
                    : sourceCalls.length > 1
                      ? "strict"
                      : "any";
            const rawDimensions =
                typeof row.dimensions === "object" &&
                row.dimensions !== null &&
                !Array.isArray(row.dimensions)
                    ? (structuredClone(row.dimensions) as Record<string, unknown>)
                    : {};
            // Only plain scalar dimensions; drop reserved provenance keys from source.
            const dimensions: Record<string, string | number | boolean> = {};
            for (const [key, value] of Object.entries(rawDimensions)) {
                if (key === "adapter" || key === "sourceCallCount") continue;
                if (
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean"
                ) {
                    dimensions[key] = value;
                }
            }
            const sourceResponses = sourceCalls.map((call) =>
                JSON.stringify({
                    name: call.name,
                    arguments: call.parameters,
                }),
            );
            const normalized = {
                utterance,
                ...(history !== undefined ? { history } : {}),
                order,
                sourceTools: structuredClone(sourceTools),
                sourceCalls: structuredClone(sourceCalls),
                sourceResponses: structuredClone(sourceResponses),
            };
            const sourceSlice = {
                format: "seed-qa-jsonl",
                version: 1 as const,
                query: utterance,
                function_calls: structuredClone(sourceCalls),
                tools: structuredClone(sourceTools),
                ...(history !== undefined ? { history } : {}),
                normalized,
            };
            candidates.push({
                candidateId: `${rowId}:query`,
                rawRow: structuredClone(rawRow),
                sourceSlice,
                utterance,
                ...(history !== undefined ? { history } : {}),
                order,
                sourceTools,
                sourceCalls,
                sourceResponses,
                dimensions: {
                    ...dimensions,
                    adapter: "seed-qa-jsonl",
                    sourceCallCount: sourceCalls.length,
                },
                lineage: {
                    dataset: options.manifest.dataset,
                    revision: options.manifest.revision,
                    config: options.manifest.config,
                    split: options.manifest.split,
                    rowIndex,
                    rowId,
                    sourceUrl: options.manifest.sourceUrl,
                    sourcePart: "query",
                    rawRowHash: computeTranslationBenchRawRowHash(rawRow),
                    sourceSliceHash:
                        computeTranslationBenchSourceSliceHash(sourceSlice),
                    transformVersion: 1 as const,
                },
            });
            if (candidates.length >= maxCandidates) {
                return candidates;
            }
        } catch (error) {
            if (!options.skipInvalidRows) throw error;
        }
    }
    if (candidates.length === 0) {
        throw new Error("seed-qa source produced no candidates");
    }
    return candidates;
}

export const seedQaJsonlAdapter: TranslationBenchSourceAdapter = {
    id: "seed-qa-jsonl",
    description:
        "Generic seed QA JSONL (query + function_calls), Azure synthesizer compatible",
    importCandidates,
};

registerTranslationBenchSourceAdapter(seedQaJsonlAdapter);
