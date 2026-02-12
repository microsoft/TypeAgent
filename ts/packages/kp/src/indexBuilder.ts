// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Index builder: orchestrates the full pipeline from text chunks to
 * searchable indexes.
 *
 * Pipeline:
 * 1. Extract keywords from each chunk (no LLM)
 * 2. Collect vocabulary (deduplicated keywords across all chunks)
 * 3. LLM enrichment: vocabulary → dictionary entries with lemmas,
 *    related terms, entity types, parent types (synchronous — blocks)
 * 4. Build inverted index using lemmas from dictionary
 * 5. Build related terms map from dictionary
 * 6. Populate metadata index from chunk metadata
 * 7. Populate group index from chunk groups
 */

import { TextChunk, ChunkGroup } from "./types.js";
import { InvertedIndex } from "./invertedIndex.js";
import {
    extractKeywords,
    ExtractedKeyword,
} from "./keywordExtractor.js";
import { Dictionary, RelatedTermsMap } from "./relatedTerms.js";
import { MetadataIndex } from "./metadataIndex.js";
import { GroupIndex } from "./groupIndex.js";
import { enrichVocabulary, EnrichmentConfig } from "./llmEnrichment.js";

import registerDebug from "debug";
const debug = registerDebug("kp:build");

export interface BuildResult {
    invertedIndex: InvertedIndex;
    dictionary: Dictionary;
    relatedTerms: RelatedTermsMap;
    metadataIndex: MetadataIndex;
    groupIndex: GroupIndex;
    stats: BuildStats;
}

export interface BuildStats {
    chunkCount: number;
    rawKeywordCount: number;
    vocabularySize: number;
    enrichedTermCount: number;
    indexTermCount: number;
    relatedTermCount: number;
    elapsed: number;
}

export interface IncrementalStats {
    newChunkCount: number;
    newKeywordCount: number;
    newVocabularyCount: number;
    reusedVocabularyCount: number;
    elapsed: number;
}

/**
 * Build all indexes from text chunks and optional groups.
 *
 * This is the main entry point. It:
 * 1. Extracts keywords from chunks
 * 2. Sends the vocabulary to the LLM for enrichment (blocks until done)
 * 3. Builds inverted index with lemmatized terms
 * 4. Builds related terms map from enriched dictionary
 * 5. Populates metadata and group indexes
 */
export async function buildIndex(
    chunks: TextChunk[],
    groups?: ChunkGroup[],
    enrichmentConfig?: EnrichmentConfig,
): Promise<BuildResult> {
    const start = Date.now();

    // Step 1: Extract keywords from each chunk
    debug("Extracting keywords from %d chunks", chunks.length);
    const chunkKeywords = new Map<number, ExtractedKeyword[]>();
    const vocabularyMap = new Map<string, ExtractedKeyword>();

    for (const chunk of chunks) {
        const keywords = extractKeywords(chunk.text);
        chunkKeywords.set(chunk.chunkId, keywords);

        // Merge into global vocabulary (deduplicate, aggregate counts)
        for (const kw of keywords) {
            const existing = vocabularyMap.get(kw.text);
            if (existing) {
                existing.count += kw.count;
                if (kw.isProperNoun) existing.isProperNoun = true;
            } else {
                vocabularyMap.set(kw.text, { ...kw });
            }
        }
    }

    const vocabulary = Array.from(vocabularyMap.values());
    debug(
        "Extracted %d unique keywords from %d chunks",
        vocabulary.length,
        chunks.length,
    );

    // Step 2: LLM enrichment — get lemmas, related terms, entity types
    debug("Starting LLM enrichment");
    const enrichedEntries = await enrichVocabulary(
        vocabulary,
        enrichmentConfig,
    );

    // Step 3: Populate dictionary
    const dictionary = new Dictionary();
    for (const entry of enrichedEntries) {
        dictionary.addEntry(entry);
    }
    debug("Dictionary has %d entries", dictionary.getEntryCount());

    // Step 4: Build inverted index using lemmas
    const invertedIndex = new InvertedIndex();

    for (const chunk of chunks) {
        const keywords = chunkKeywords.get(chunk.chunkId);
        if (!keywords) continue;

        for (const kw of keywords) {
            // Look up lemma from enriched dictionary
            const entry = dictionary.lookup(kw.text);
            const lemma = entry?.lemma ?? kw.text.toLowerCase();
            const score = kw.isProperNoun ? 2.0 : 1.0;
            invertedIndex.addTerm(lemma, chunk.chunkId, score);
        }
    }
    debug("Inverted index has %d terms", invertedIndex.getTermCount());

    // Step 5: Build related terms map from dictionary
    const relatedTerms = new RelatedTermsMap();
    relatedTerms.buildFromDictionary(dictionary);
    debug("Related terms map has %d terms", relatedTerms.getTermCount());

    // Step 6: Populate metadata index
    const metadataIndex = new MetadataIndex();
    for (const chunk of chunks) {
        for (const [column, values] of Object.entries(chunk.metadata)) {
            for (const value of values) {
                metadataIndex.addEntry(column, value, chunk.chunkId);
            }
        }
    }

    // Step 7: Populate group index
    const groupIndex = new GroupIndex();
    if (groups) {
        for (const group of groups) {
            groupIndex.addGroup(group);
        }
    }

    const elapsed = Date.now() - start;
    const stats: BuildStats = {
        chunkCount: chunks.length,
        rawKeywordCount: Array.from(chunkKeywords.values()).reduce(
            (sum, kws) => sum + kws.length,
            0,
        ),
        vocabularySize: vocabulary.length,
        enrichedTermCount: dictionary.getEntryCount(),
        indexTermCount: invertedIndex.getTermCount(),
        relatedTermCount: relatedTerms.getTermCount(),
        elapsed,
    };

    debug("Index build complete in %dms: %O", elapsed, stats);

    return {
        invertedIndex,
        dictionary,
        relatedTerms,
        metadataIndex,
        groupIndex,
        stats,
    };
}

/**
 * Add new chunks to an existing index incrementally.
 *
 * Key optimization: only new vocabulary (keywords not already in the
 * dictionary) is sent to the LLM for enrichment. Keywords that already
 * have dictionary entries reuse their existing lemmas. This is fast
 * because vocabulary grows sub-linearly (Heap's law) — most words in
 * new chunks are already known.
 *
 * Pipeline:
 * 1. Extract keywords from new chunks
 * 2. Partition vocabulary: known (in dictionary) vs new
 * 3. LLM enrichment for new vocabulary only
 * 4. Add new entries to dictionary
 * 5. Add lemmatized terms to inverted index (all keywords, using dictionary)
 * 6. Rebuild related terms map from updated dictionary
 * 7. Populate metadata and group indexes for new chunks
 */
export async function indexChunksIncremental(
    chunks: TextChunk[],
    groups: ChunkGroup[] | undefined,
    invertedIndex: InvertedIndex,
    dictionary: Dictionary,
    relatedTerms: RelatedTermsMap,
    metadataIndex: MetadataIndex,
    groupIndex: GroupIndex,
    enrichmentConfig?: EnrichmentConfig,
): Promise<IncrementalStats> {
    const start = Date.now();

    if (chunks.length === 0) {
        return {
            newChunkCount: 0,
            newKeywordCount: 0,
            newVocabularyCount: 0,
            reusedVocabularyCount: 0,
            elapsed: 0,
        };
    }

    // Step 1: Extract keywords from new chunks
    debug("Incremental: extracting keywords from %d new chunks", chunks.length);
    const chunkKeywords = new Map<number, ExtractedKeyword[]>();
    const newVocabularyMap = new Map<string, ExtractedKeyword>();
    let reusedCount = 0;

    for (const chunk of chunks) {
        const keywords = extractKeywords(chunk.text);
        chunkKeywords.set(chunk.chunkId, keywords);

        for (const kw of keywords) {
            // Check if this keyword is already in the dictionary
            if (dictionary.lookup(kw.text)) {
                reusedCount++;
                continue;
            }
            // New vocabulary — collect for enrichment
            const existing = newVocabularyMap.get(kw.text);
            if (existing) {
                existing.count += kw.count;
                if (kw.isProperNoun) existing.isProperNoun = true;
            } else {
                newVocabularyMap.set(kw.text, { ...kw });
            }
        }
    }

    const newVocabulary = Array.from(newVocabularyMap.values());
    debug(
        "Incremental: %d new vocabulary, %d reused from dictionary",
        newVocabulary.length,
        reusedCount,
    );

    // Step 2: Enrich only new vocabulary
    if (newVocabulary.length > 0) {
        debug("Incremental: enriching %d new terms", newVocabulary.length);
        const newEntries = await enrichVocabulary(
            newVocabulary,
            enrichmentConfig,
        );
        for (const entry of newEntries) {
            dictionary.addEntry(entry);
        }
    }

    // Step 3: Add lemmatized terms to inverted index
    let newKeywordCount = 0;
    for (const chunk of chunks) {
        const keywords = chunkKeywords.get(chunk.chunkId);
        if (!keywords) continue;

        for (const kw of keywords) {
            const entry = dictionary.lookup(kw.text);
            const lemma = entry?.lemma ?? kw.text.toLowerCase();
            const score = kw.isProperNoun ? 2.0 : 1.0;
            invertedIndex.addTerm(lemma, chunk.chunkId, score);
            newKeywordCount++;
        }
    }

    // Step 4: Rebuild related terms map from updated dictionary
    // (additive — new entries get their relationships added)
    if (newVocabulary.length > 0) {
        relatedTerms.buildFromDictionary(dictionary);
    }

    // Step 5: Populate metadata index for new chunks
    for (const chunk of chunks) {
        for (const [column, values] of Object.entries(chunk.metadata)) {
            for (const value of values) {
                metadataIndex.addEntry(column, value, chunk.chunkId);
            }
        }
    }

    // Step 6: Populate group index for new groups
    if (groups) {
        for (const group of groups) {
            groupIndex.addGroup(group);
        }
    }

    const elapsed = Date.now() - start;
    const stats: IncrementalStats = {
        newChunkCount: chunks.length,
        newKeywordCount,
        newVocabularyCount: newVocabulary.length,
        reusedVocabularyCount: reusedCount,
        elapsed,
    };

    debug(
        "Incremental build: %d chunks, %d new vocab, %d reused in %dms",
        chunks.length,
        newVocabulary.length,
        reusedCount,
        elapsed,
    );

    return stats;
}
