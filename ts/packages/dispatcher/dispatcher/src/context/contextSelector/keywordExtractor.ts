// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lexical keyword extraction (§6.1) — the deterministic fallback floor that
// guarantees a keyword vector for every action, including runtime/dynamic agents
// where an LLM distillation pass hasn't run. Classic IR, no model call: mine the
// action's own schema text (schema description + de-camelCased action name +
// parameter names + their JSDoc), drop stopwords/generic verbs, count term
// frequency, emit the top-N. Recomputed from the live schema, so it is
// drift-proof (§6.1). LLM distillation, when available, is layered on top via the
// sidecar (§5) — it is not part of this floor.

import {
    ActionSchemaTypeDefinition,
    SchemaType,
} from "@typeagent/action-schema";
import { tokenize, tokenizeIdentifier } from "./tokenize.js";
import { KeywordVector } from "./keywordVector.js";

// Cap on emitted keywords per action. Keyword lists are tiny (~8 tokens) in
// practice; the cap only bounds a pathologically verbose schema.
export const KEYWORD_TOP_N = 32;

// Depth cap for walking nested parameter types — guards against deep or
// recursive schemas while still reaching realistic nested params.
const MAX_PARAM_DEPTH = 4;

// The text sources feeding extraction, already separated by kind so the caller
// (schema-reading, impure) stays thin and this core stays pure/testable.
export type KeywordExtractionInput = {
    // Schema/manifest description text.
    schemaDescription?: string | undefined;
    // Raw action name identifier (e.g. "addItems"); de-camelCased here.
    actionName: string;
    // JSDoc comment lines on the action definition.
    actionComments?: readonly string[] | undefined;
    // Parameter field name identifiers (de-camelCased here).
    paramNames?: readonly string[] | undefined;
    // JSDoc comment lines on parameter fields.
    paramComments?: readonly string[] | undefined;
};

// Extract a keyword vector from separated schema text. Deterministic: frequency
// desc, then token asc for a stable order before the top-N cut.
export function extractKeywords(
    input: KeywordExtractionInput,
    topN: number = KEYWORD_TOP_N,
): KeywordVector {
    const counts = new Map<string, number>();
    const bump = (tokens: string[]) => {
        for (const t of tokens) {
            counts.set(t, (counts.get(t) ?? 0) + 1);
        }
    };

    bump(tokenize(input.schemaDescription ?? ""));
    bump(tokenizeIdentifier(input.actionName));
    for (const c of input.actionComments ?? []) {
        bump(tokenize(c));
    }
    for (const p of input.paramNames ?? []) {
        bump(tokenizeIdentifier(p));
    }
    for (const c of input.paramComments ?? []) {
        bump(tokenize(c));
    }

    const ranked = [...counts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) {
            return b[1] - a[1];
        }
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    return new Set(ranked.slice(0, topN).map(([t]) => t));
}

// Walk a parameter type collecting field names + JSDoc comments. Follows
// references (with a visited guard) and array element types, depth-capped.
function collectParamText(
    type: SchemaType | undefined,
    depth: number,
    visited: Set<string>,
    names: string[],
    comments: string[],
): void {
    if (type === undefined || depth > MAX_PARAM_DEPTH) {
        return;
    }
    switch (type.type) {
        case "object":
            for (const [name, field] of Object.entries(type.fields)) {
                names.push(name);
                if (field.comments) {
                    comments.push(...field.comments);
                }
                collectParamText(
                    field.type,
                    depth + 1,
                    visited,
                    names,
                    comments,
                );
            }
            break;
        case "array":
            collectParamText(
                type.elementType,
                depth + 1,
                visited,
                names,
                comments,
            );
            break;
        case "type-reference":
            if (type.definition !== undefined && !visited.has(type.name)) {
                visited.add(type.name);
                collectParamText(
                    type.definition.type,
                    depth + 1,
                    visited,
                    names,
                    comments,
                );
            }
            break;
        default:
            break;
    }
}

// Build extraction input from a parsed action definition + its schema
// description. Impure boundary kept small; the heavy lifting is in
// `extractKeywords`.
export function buildExtractionInput(
    actionName: string,
    definition: ActionSchemaTypeDefinition,
    schemaDescription?: string,
): KeywordExtractionInput {
    const names: string[] = [];
    const comments: string[] = [];
    const parametersField = definition.type.fields.parameters;
    if (parametersField !== undefined) {
        collectParamText(parametersField.type, 0, new Set(), names, comments);
    }
    return {
        schemaDescription,
        actionName,
        actionComments: definition.comments,
        paramNames: names,
        paramComments: comments,
    };
}
