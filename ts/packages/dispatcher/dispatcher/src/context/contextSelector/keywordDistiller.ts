// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// LLM distillation — the *preferred* keyword-vector producer (design §6.1). A
// one-off pass that authors a discriminative keyword vector for an action by
// reasoning about what the action is FOR (its intent / typical usage) and the
// language a user would use to invoke it — NOT by scraping nouns out of the
// schema text (which pulls in incidental example values). It is NEVER on the
// collision hot path (§6/§9) — it runs only at backfill / onboarding /
// dynamic-generation. The model factory is injected so this is unit-testable
// with a stub (mirrors guidelineDistiller).

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

// Strip illustrative EXAMPLE VALUES out of schema doc text before the model sees
// it, so the distiller can't anchor on them (the #1 source of junk keywords like
// list.addItems -> "garden","movie","gift", copied from a param doc that reads
// "name of the list such as 'grocery','gift','movie'..."). Removes "such as …" /
// "e.g. …" / "for example …" clauses and any quoted literals. Deterministic and
// conservative — it only drops example enumerations, leaving the concept text.
// Exported for unit testing.
export function stripExampleValues(text: string): string {
    return text
        .replace(/\b(such as|e\.?g\.?|for example|including)\b[^.;]*/gi, " ")
        .replace(/'[^']*'/g, " ")
        .replace(/"[^"]*"/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildPrompt(input: KeywordExtractionInput, topN: number): string {
    const actionDocs = stripExampleValues(
        (input.actionComments ?? []).join(" "),
    );
    const params = (input.paramNames ?? []).join(", ").trim();
    const paramDocs = stripExampleValues((input.paramComments ?? []).join(" "));
    const schemaDesc = stripExampleValues(input.schemaDescription ?? "");
    return [
        "You are authoring a KEYWORD VECTOR for one agent action. At runtime this vector is matched against the recent conversation to route the user's request to the right AGENT, so the words must capture the SUBJECT / DOMAIN the user is talking about when they want this action — the topic that tells this agent apart from unrelated agents.",
        "Reason about the action's purpose, then output the domain/topic words a user would naturally use.",
        "Rules:",
        "- Keywords describe the SUBJECT the action operates on and its domain — NOT the operation itself. EXCLUDE the operation's verbs AND their synonyms (e.g. for a remove/delete action exclude remove, delete, discard, purge, eliminate, clear; for an add action exclude add, insert, append). Keep the subject, e.g. list, item, entry.",
        "- Because keywords describe the subject, different actions of the SAME agent naturally SHARE most keywords (e.g. 'add item to list' and 'remove item from list' both -> list, item, entry, checklist). That is expected and good.",
        "- IGNORE illustrative EXAMPLE VALUES in the documentation — sample names, enum samples, placeholder data. If the docs enumerate examples like 'garden', 'movie', 'gift', 'packing', those are only illustrations: do NOT copy them. Keep the general concept (list, item, checklist) plus at most a couple of the most COMMON representative contexts (e.g. grocery, todo).",
        "- CRITICAL: when a parameter's documentation reads like 'a name/value such as A, B, C, ...' or gives a comma-separated list of sample values, every one of those enumerated values is USER DATA, not a keyword — never output any of them. Output only the parameter's concept (e.g. for 'list name such as grocery, gift, movie' output nothing but the concept already covered by 'list').",
        "- Include natural synonyms and closely related domain terms even if the schema never mentions them.",
        "- Prefer a focused set of the most distinctive terms over a long noisy list. Quality over quantity.",
        "- Single lowercase words only. No multi-word phrases, no punctuation.",
        `- At most ${topN} words, most distinctive first.`,
        'Respond with ONLY a JSON object: { "keywords": ["word", "word", ...] }',
        "",
        "--- action ---",
        `agent / schema: ${schemaDesc}`,
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
