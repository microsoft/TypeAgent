// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// LLM distillation — the *preferred* keyword-vector producer (design §6.1). A
// one-off pass that turns an action's schema text into a discriminative keyword
// vector, adding synonyms the schema never says ("sheet" -> "spreadsheet") and
// normalizing phrasing. It is NEVER on the collision hot path (§6/§9) — it runs
// only at backfill / onboarding / dynamic-generation. The model factory is
// injected so this is unit-testable with a stub (mirrors guidelineDistiller).

import type { ChatModel } from "@typeagent/aiclient";
import { KeywordExtractionInput } from "./keywordExtractor.js";
import { tokenize } from "./tokenize.js";

// Injected `(name) => ChatModel`. Production passes
// `(name) => openai.createChatModel(name)`; tests pass a stub.
export type CreateChatModel = (name: string) => ChatModel;

export type DistillOptions = {
    createModel: CreateChatModel;
    // Cap on emitted keywords after canonicalization (default 24).
    topN?: number | undefined;
};

const DEFAULT_TOP_N = 24;

function buildPrompt(input: KeywordExtractionInput, topN: number): string {
    const actionDocs = (input.actionComments ?? []).join(" ").trim();
    const params = (input.paramNames ?? []).join(", ").trim();
    const paramDocs = (input.paramComments ?? []).join(" ").trim();
    return [
        "You are distilling a compact KEYWORD VECTOR for a single agent action. The vector is used to route a user request to the right action by topical overlap with the recent conversation.",
        "Given the action's schema text below, output the words that most distinctively identify this action's TOPIC / DOMAIN — including natural synonyms and closely related terms a user might say, even when the schema text does not mention them.",
        "Rules:",
        "- Emit discriminative, topical nouns and domain terms only.",
        "- EXCLUDE generic CRUD/imperative verbs (add, get, update, remove, delete, show, create, set, open) and filler words.",
        "- Include useful synonyms and surface variants (e.g. for a spreadsheet action: spreadsheet, sheet, cell, row, column, formula).",
        "- Single lowercase words only. No multi-word phrases, no punctuation.",
        `- At most ${topN} words, most distinctive first.`,
        'Respond with ONLY a JSON object: { "keywords": ["word", "word", ...] }',
        "",
        "--- schema text ---",
        `schema description: ${input.schemaDescription ?? ""}`,
        `action name: ${input.actionName}`,
        actionDocs ? `action documentation: ${actionDocs}` : "",
        params ? `parameter names: ${params}` : "",
        paramDocs ? `parameter documentation: ${paramDocs}` : "",
    ]
        .filter((line) => line !== "")
        .join("\n");
}

// Tolerant extraction of a `{ keywords: string[] }` payload from a model
// response (handles code fences and surrounding prose), mirroring the
// extractJSON approach used elsewhere for LLM output.
function parseKeywordResponse(text: string): string[] | undefined {
    if (!text) {
        return undefined;
    }
    let body = text;
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        body = fenced[1] ?? body;
    }
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start !== -1 && end > start) {
        body = body.slice(start, end + 1);
    }
    try {
        const parsed = JSON.parse(body) as { keywords?: unknown };
        if (Array.isArray(parsed.keywords)) {
            return parsed.keywords.filter(
                (k): k is string => typeof k === "string",
            );
        }
    } catch {
        // fall through
    }
    return undefined;
}

// Distill a keyword vector for one action. Returns undefined on any failure (no
// model, request error, unparseable response) so the caller falls back to the
// deterministic lexical floor.
export async function distillKeywords(
    input: KeywordExtractionInput,
    options: DistillOptions,
): Promise<string[] | undefined> {
    const topN = options.topN ?? DEFAULT_TOP_N;
    let result;
    try {
        const model = options.createModel("distill");
        result = await model.complete(buildPrompt(input, topN));
    } catch {
        return undefined;
    }
    if (!result.success) {
        return undefined;
    }
    const raw = parseKeywordResponse(result.data);
    if (raw === undefined) {
        return undefined;
    }
    // Canonicalize through the SAME tokenizer the scorer and context vector use
    // (§12) so distilled tokens are directly comparable — drops stopwords /
    // generic verbs, applies the plural stemmer, dedupes, preserves order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const keyword of raw) {
        for (const token of tokenize(keyword)) {
            if (!seen.has(token)) {
                seen.add(token);
                out.push(token);
                if (out.length >= topN) {
                    return out;
                }
            }
        }
    }
    return out.length > 0 ? out : undefined;
}
