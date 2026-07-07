// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Unified keyword-vector producer (design §6.1). For each action of a schema it
// runs the *preferred* producer — LLM distillation — when a model factory is
// supplied, and falls back to the deterministic lexical floor otherwise (or when
// distillation fails for that action). Produces a whole-schema KeywordFile — the
// artifact the backfill / onboarding / dynamic-generation moments (§6.1) write.
// This module owns no I/O; the caller persists the returned file.

import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import { buildExtractionInput, extractKeywords } from "./keywordExtractor.js";
import { distillKeywords, CreateChatModel } from "./keywordDistiller.js";
import { KeywordFile, KEYWORD_FILE_SCHEMA_VERSION } from "./keywordFile.js";

export type SchemaActions = {
    schemaName: string;
    schemaDescription?: string | undefined;
    // Optional source hash of the schema (ActionSchemaFile.sourceHash), recorded
    // in the produced file for future drift detection.
    sourceHash?: string | undefined;
    // Action name -> parsed definition (the shape the lexical extractor reads).
    actions: Map<string, ActionSchemaTypeDefinition>;
};

export type ProduceOptions = {
    // When provided, LLM distillation is attempted per action (preferred);
    // omit for a deterministic lexical-only run.
    createModel?: CreateChatModel | undefined;
    topN?: number | undefined;
};

export type ProduceResult = {
    file: KeywordFile;
    // Per-producer action counts, for backfill reporting.
    distilled: number;
    lexical: number;
};

// Produce a KeywordFile for one schema. Distillation is attempted per action
// when a model is supplied; any action the model can't produce falls back to the
// lexical floor, so every action always ends up with a vector.
export async function produceKeywordFile(
    input: SchemaActions,
    options: ProduceOptions = {},
): Promise<ProduceResult> {
    const actions: Record<string, string[]> = {};
    let distilled = 0;
    let lexical = 0;
    for (const [actionName, definition] of input.actions) {
        const extractionInput = buildExtractionInput(
            actionName,
            definition,
            input.schemaDescription,
        );
        let vector: string[] | undefined;
        if (options.createModel !== undefined) {
            vector = await distillKeywords(extractionInput, {
                createModel: options.createModel,
                topN: options.topN,
            });
            if (vector !== undefined) {
                distilled++;
            }
        }
        if (vector === undefined) {
            vector = [...extractKeywords(extractionInput)];
            lexical++;
        }
        actions[actionName] = vector;
    }
    const file: KeywordFile = {
        schemaVersion: KEYWORD_FILE_SCHEMA_VERSION,
        schema: input.schemaName,
        // "llm" only when EVERY action distilled; a mixed file stays "lexical"
        // so a refresh pipeline keying off provenance re-distills the actions
        // that fell back (§6.1) rather than skipping a partially-distilled file.
        generatedBy: distilled > 0 && lexical === 0 ? "llm" : "lexical",
        generatedAt: new Date().toISOString(),
        ...(input.sourceHash !== undefined
            ? { sourceHash: input.sourceHash }
            : {}),
        actions,
    };
    return { file, distilled, lexical };
}
