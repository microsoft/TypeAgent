// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Batch LLM enrichment: processes the extracted vocabulary with an LLM
 * to get lemmas, related terms, entity types, and parent types.
 *
 * Tries the aiclient OpenAI chat model first (direct API, no subprocess).
 * Falls back to the Claude Agent SDK query() API if aiclient is not available.
 *
 * Processes vocabulary in batches (synchronous — we need the lemmas
 * before building the index).
 */

import { openai, ChatModel } from "aiclient";
import { PromptSection } from "typechat";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DictionaryEntry, RelatedTerm, RelationType } from "./types.js";
import { ExtractedKeyword } from "./keywordExtractor.js";

import registerDebug from "debug";
const debug = registerDebug("kp:enrich");

/** Lazy singleton chat model from aiclient. */
let chatModel: ChatModel | undefined;
let chatModelAvailable: boolean | undefined;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH_SIZE = 150;

export interface EnrichmentConfig {
    model?: string;
    batchSize?: number;
    /** Called after each batch with progress info */
    onProgress?: (message: string) => void;
}

const ENRICHMENT_SYSTEM_PROMPT = `You are a lexical analysis assistant. Given a batch of keywords extracted from a text corpus, produce enriched dictionary entries for each.

For each keyword, provide:
1. **lemma**: The canonical/base form (e.g. "running" → "run", "books" → "book", "Taylor Swift" → "taylor swift"). Lowercase.
2. **pos**: Part of speech — one of: "noun", "verb", "adjective", "proper_noun", "phrase"
3. **relatedTerms**: Synonyms, aliases, or domain terms. Each with:
   - term: the related term AS A LEMMA (lowercase base form)
   - relation: one of "synonym", "alias", "type", "inference", "domain"
   - weight: 0.0–1.0 (how close the relationship is)
4. **entityType**: For proper nouns, the entity type (e.g. "person", "company", "product", "place", "event"). Omit for common words.
5. **parentTypes**: For entities, the IS-A hierarchy as an array (e.g. for entityType "artist": ["person", "celebrity"]). Omit for common words.

IMPORTANT RULES:
- ALL terms (lemmas, related terms, entity types, parent types) must be LOWERCASE
- Related terms must be in their LEMMA form (base form), not inflected
- Only include meaningful relationships — skip trivial/obvious ones
- For proper nouns that are multi-word, keep them as one string (e.g. "taylor swift")
- If a keyword is already in base form, lemma equals the keyword
- Keep it concise: 0-3 related terms per keyword, focus on the most useful

OUTPUT FORMAT: Return a JSON array of objects. Each object has these fields:
{
  "term": "original keyword",
  "lemma": "base form",
  "pos": "noun|verb|adjective|proper_noun|phrase",
  "relatedTerms": [{"term": "related lemma", "relation": "synonym|alias|type|domain", "weight": 0.8}],
  "entityType": "person|company|...",  // only for proper nouns
  "parentTypes": ["person", "celebrity"]  // only for entities
}

Return ONLY the JSON array, no other text.`;

/**
 * Get or create the aiclient chat model. Returns undefined if not configured.
 */
function getChatModel(): ChatModel | undefined {
    if (chatModelAvailable === false) return undefined;
    if (chatModel) return chatModel;

    try {
        // Get settings and increase timeout for large batch enrichment (default 60s is too short)
        const settings = openai.getChatModelSettings("GPT_5_MINI");
        settings.timeout = 120_000;
        chatModel = openai.createChatModel(settings);
        chatModel.completionSettings.max_completion_tokens = 16384;
        // GPT-5 doesn't support temperature=0; remove the default set by aiclient
        delete (chatModel.completionSettings as any).temperature;
        chatModelAvailable = true;
        debug("aiclient chat model created");
        return chatModel;
    } catch (e) {
        debug("aiclient chat model not available: %s", e);
        chatModelAvailable = false;
        return undefined;
    }
}

/**
 * Build the term list string from keywords (shared by both paths).
 */
function buildTermList(keywords: ExtractedKeyword[]): string {
    return keywords
        .map((k) => {
            const tag = k.isProperNoun ? " [proper noun]" : "";
            return `- ${k.text}${tag} (count: ${k.count})`;
        })
        .join("\n");
}

/**
 * Enrich a vocabulary batch via the aiclient OpenAI chat model.
 */
async function enrichBatchOpenAI(
    model: ChatModel,
    keywords: ExtractedKeyword[],
): Promise<DictionaryEntry[]> {
    const termList = buildTermList(keywords);
    const userPrompt = `Enrich these ${keywords.length} keywords:\n\n${termList}`;

    const messages: PromptSection[] = [
        { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
    ];

    const result = await model.complete(messages);
    if (!result.success) {
        throw new Error(result.message);
    }

    return parseEnrichmentResponse(result.data, keywords);
}

/**
 * Enrich a vocabulary batch via the agent SDK query() API (fallback).
 */
async function enrichBatchAgentSdk(
    keywords: ExtractedKeyword[],
    agentModel: string,
): Promise<DictionaryEntry[]> {
    const termList = buildTermList(keywords);
    const userPrompt = `Enrich these ${keywords.length} keywords:\n\n${termList}`;

    const queryInstance = query({
        prompt: `${ENRICHMENT_SYSTEM_PROMPT}\n\n${userPrompt}`,
        options: {
            model: agentModel,
        },
    });

    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result") {
            if (message.subtype === "success") {
                responseText = message.result || "";
                break;
            } else {
                const errors =
                    "errors" in message
                        ? (message as any).errors
                        : undefined;
                throw new Error(
                    `LLM enrichment failed: ${errors?.join(", ") || "Unknown error"}`,
                );
            }
        }
    }

    if (!responseText) {
        throw new Error("No response from LLM");
    }

    return parseEnrichmentResponse(responseText, keywords);
}

/**
 * Enrich a vocabulary batch with the LLM.
 * Tries aiclient OpenAI first; falls back to agent SDK query().
 * Returns DictionaryEntry[] for the batch.
 */
async function enrichBatch(
    keywords: ExtractedKeyword[],
    agentModel: string,
    onProgress?: (message: string) => void,
): Promise<DictionaryEntry[]> {
    const model = getChatModel();
    if (model) {
        try {
            return await enrichBatchOpenAI(model, keywords);
        } catch (e: any) {
            const msg = e?.message || String(e);
            debug("aiclient batch failed, switching to agent SDK: %s", msg);
            onProgress?.(`OpenAI API failed: ${msg.substring(0, 100)}. Falling back to agent SDK...`);
            chatModelAvailable = false;
            chatModel = undefined;
        }
    }
    return enrichBatchAgentSdk(keywords, agentModel);
}

/**
 * Parse the LLM response into DictionaryEntry[].
 * Extracts JSON array from the response, handling markdown code blocks.
 */
function parseEnrichmentResponse(
    text: string,
    keywords: ExtractedKeyword[],
): DictionaryEntry[] {
    // Try to extract JSON array — might be wrapped in markdown
    let jsonText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
    }

    // Find the array
    const arrayStart = jsonText.indexOf("[");
    if (arrayStart === -1) {
        debug("No JSON array in LLM response, falling back to identity entries");
        return keywords.map(fallbackEntry);
    }

    // Find matching bracket
    let bracketCount = 0;
    let arrayEnd = -1;
    for (let i = arrayStart; i < jsonText.length; i++) {
        if (jsonText[i] === "[") bracketCount++;
        else if (jsonText[i] === "]") {
            bracketCount--;
            if (bracketCount === 0) {
                arrayEnd = i;
                break;
            }
        }
    }

    if (arrayEnd === -1) {
        debug("Unmatched brackets in LLM response, falling back");
        return keywords.map(fallbackEntry);
    }

    let raw: any[];
    try {
        raw = JSON.parse(jsonText.substring(arrayStart, arrayEnd + 1));
    } catch (e) {
        debug("JSON parse failed: %s", e);
        return keywords.map(fallbackEntry);
    }

    // Convert to DictionaryEntry[], validating fields
    const entries: DictionaryEntry[] = [];
    for (const item of raw) {
        if (!item.term || !item.lemma) continue;

        const relatedTerms: RelatedTerm[] = [];
        if (Array.isArray(item.relatedTerms)) {
            for (const r of item.relatedTerms) {
                if (!r.term || !r.relation) continue;
                if (!isValidRelation(r.relation)) continue;
                const rt: RelatedTerm = {
                    term: String(r.term).toLowerCase().trim(),
                    relation: r.relation as RelationType,
                };
                if (typeof r.weight === "number") {
                    rt.weight = r.weight;
                }
                relatedTerms.push(rt);
            }
        }

        const entry: DictionaryEntry = {
            term: String(item.term).toLowerCase().trim(),
            lemma: String(item.lemma).toLowerCase().trim(),
            relatedTerms,
        };

        if (item.pos && isValidPos(item.pos)) {
            entry.pos = item.pos;
        }
        if (item.entityType) {
            entry.entityType = String(item.entityType).toLowerCase().trim();
        }
        if (Array.isArray(item.parentTypes) && item.parentTypes.length > 0) {
            entry.parentTypes = item.parentTypes.map((t: any) =>
                String(t).toLowerCase().trim(),
            );
        }

        entries.push(entry);
    }

    debug("Parsed %d enriched entries from LLM response", entries.length);
    return entries;
}

/** Fallback: term = lemma, no enrichment */
function fallbackEntry(keyword: ExtractedKeyword): DictionaryEntry {
    return {
        term: keyword.text,
        lemma: keyword.text,
        pos: keyword.isProperNoun ? "proper_noun" : "noun",
        relatedTerms: [],
    };
}

function isValidRelation(r: string): boolean {
    return ["synonym", "type", "inference", "domain", "alias"].includes(r);
}

function isValidPos(p: string): boolean {
    return ["noun", "verb", "adjective", "proper_noun", "phrase"].includes(p);
}

/**
 * Enrich an entire vocabulary. Batches keywords and calls the LLM
 * sequentially for each batch. Returns all enriched dictionary entries.
 */
export async function enrichVocabulary(
    keywords: ExtractedKeyword[],
    config?: EnrichmentConfig,
): Promise<DictionaryEntry[]> {
    const agentModel = config?.model ?? DEFAULT_MODEL;
    const batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;

    if (keywords.length === 0) return [];

    debug(
        "Enriching %d keywords in batches of %d (agent fallback model: %s)",
        keywords.length,
        batchSize,
        agentModel,
    );

    const allEntries: DictionaryEntry[] = [];
    const totalBatches = Math.ceil(keywords.length / batchSize);
    const onProgress = config?.onProgress;
    const enrichStart = Date.now();

    // Report which API path will be used
    const model = getChatModel();
    const apiPath = model ? "aiclient OpenAI" : "agent SDK query()";
    onProgress?.(`Enrichment API: ${apiPath}`);
    debug("Using %s", apiPath);

    for (let i = 0; i < keywords.length; i += batchSize) {
        const batch = keywords.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        debug("Processing batch %d/%d (%d terms)", batchNum, totalBatches, batch.length);
        onProgress?.(
            `Enriching vocabulary: batch ${batchNum}/${totalBatches} (${keywords.length} terms)...`,
        );

        const batchStart = Date.now();
        try {
            const entries = await enrichBatch(batch, agentModel, onProgress);
            allEntries.push(...entries);
            const batchMs = Date.now() - batchStart;
            debug("Batch %d completed in %dms", batchNum, batchMs);
            onProgress?.(
                `Batch ${batchNum}/${totalBatches} done in ${(batchMs / 1000).toFixed(1)}s (${entries.length} entries)`,
            );
        } catch (e: any) {
            const errMsg = e?.message || String(e);
            debug("Batch %d failed, using fallback entries: %s", batchNum, errMsg);
            onProgress?.(
                `Batch ${batchNum}/${totalBatches} FAILED: ${errMsg} (using fallback entries)`,
            );
            allEntries.push(...batch.map(fallbackEntry));
        }
    }

    const enrichMs = Date.now() - enrichStart;

    // Quality stats for comparing models
    let withRelated = 0;
    let totalRelated = 0;
    let withEntity = 0;
    let withLemmaChange = 0;
    for (const e of allEntries) {
        if (e.relatedTerms.length > 0) withRelated++;
        totalRelated += e.relatedTerms.length;
        if (e.entityType) withEntity++;
        if (e.lemma !== e.term) withLemmaChange++;
    }
    const avgRelated = allEntries.length > 0 ? (totalRelated / allEntries.length).toFixed(1) : "0";

    debug(
        "Enrichment complete: %d entries in %dms (lemmaChanged=%d, withRelated=%d, avgRelated=%s, withEntity=%d)",
        allEntries.length,
        enrichMs,
        withLemmaChange,
        withRelated,
        avgRelated,
        withEntity,
    );
    onProgress?.(
        `Vocabulary enrichment complete: ${allEntries.length} entries in ${(enrichMs / 1000).toFixed(1)}s ` +
            `[lemmas=${withLemmaChange}, related=${avgRelated}/entry, entities=${withEntity}]`,
    );
    return allEntries;
}
