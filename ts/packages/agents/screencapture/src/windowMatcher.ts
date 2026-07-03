// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateEmbedding,
    generateEmbeddingWithRetry,
    ScoredItem,
    NameValue,
} from "typeagent";
import { TextEmbeddingModel, openai, isEmbeddingAvailable } from "@typeagent/aiclient";
import registerDebug from "debug";
import type { WindowInfo } from "./platform/windowEnumerator.js";

const debugError = registerDebug("typeagent:screencapture:matcher");

export interface ProgramNameIndex {
    addOrUpdate(programName: string): Promise<void>;
    reset(): Promise<void>;
    search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]>;
}

export function createProgramNameIndex(
    vals: Record<string, string | undefined>,
    modelOverride?: TextEmbeddingModel,
): ProgramNameIndex {
    let programEmbeddings: Record<string, NormalizedEmbedding> = {};

    const embeddingModel: TextEmbeddingModel | undefined =
        modelOverride ??
        (isEmbeddingAvailable()
            ? (() => {
                  const aiSettings = openai.apiSettingsFromEnv(
                      openai.ModelType.Embedding,
                      vals,
                  );
                  return openai.createEmbeddingModel(aiSettings);
              })()
            : undefined);

    return {
        addOrUpdate,
        reset,
        search,
    };

    async function addOrUpdate(programName: string) {
        if (embeddingModel === undefined) {
            return;
        }
        if (programEmbeddings[programName] !== undefined) {
            return;
        }
        try {
            const embedding = await generateEmbeddingWithRetry(
                embeddingModel,
                programName,
            );
            programEmbeddings[programName] = embedding;
        } catch (e: any) {
            debugError(
                `Could not create embedding for ${programName}. ${e.message}`,
            );
        }
    }

    async function reset() {
        programEmbeddings = {};
    }

    async function search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]> {
        const embeddings = Object.values(programEmbeddings);
        const programNames = Object.keys(programEmbeddings);

        if (embeddingModel === undefined || embeddings.length === 0) {
            return [];
        }

        const embedding = await generateEmbedding(embeddingModel, query);
        const topN = indexesOfNearest(
            embeddings,
            embedding,
            maxMatches,
            SimilarityType.Dot,
        );

        return topN.map((m) => {
            const itemIndex = m.item;
            const programName = programNames[itemIndex];

            return {
                score: m.score,
                item: {
                    name: programName,
                    value: programName,
                },
            };
        });
    }
}

// Substring fallback used when embedding lookup fails. Lifted from the
// desktop agent's connector.ts searchTable() helper.
function substringScore(name: string, query: string): number {
    const lowerName = name.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (lowerName === lowerQuery) return 0;
    if (lowerName.startsWith(lowerQuery)) return 1;
    if (lowerName.includes(lowerQuery)) return 2;
    if (lowerQuery.split(/\s+/).every((w) => lowerName.includes(w))) return 3;
    return -1;
}

function substringMatch(
    target: string,
    windows: WindowInfo[],
): WindowInfo | undefined {
    const scored = windows
        .map((w) => ({
            w,
            score: Math.min(
                ...[w.title, w.processName]
                    .map((s) => substringScore(s, target))
                    .filter((s) => s >= 0)
                    .concat([Number.POSITIVE_INFINITY]),
            ),
        }))
        .filter((s) => Number.isFinite(s.score))
        .sort((a, b) => a.score - b.score);
    return scored.length > 0 ? scored[0].w : undefined;
}

// Match a target name against a list of currently visible windows.
// Tries embedding-based search first; falls back to substring matching
// if the embedding model is unavailable or returns nothing.
export async function matchWindow(
    target: string,
    windows: WindowInfo[],
): Promise<WindowInfo | undefined> {
    if (windows.length === 0) {
        return undefined;
    }
    // Cheap path first: an exact / strong substring hit avoids the
    // embedding round-trip entirely.
    const direct = substringMatch(target, windows);
    if (direct !== undefined) {
        const lowerQ = target.toLowerCase();
        if (
            direct.title.toLowerCase().includes(lowerQ) ||
            direct.processName.toLowerCase().includes(lowerQ)
        ) {
            return direct;
        }
    }

    try {
        const index = createProgramNameIndex(process.env);
        // Index each window under a synthetic key built from process + title;
        // we'll resolve the score back to the WindowInfo by position.
        const keys = windows.map((w, i) => `${i}\t${w.processName} ${w.title}`);
        for (const k of keys) {
            await index.addOrUpdate(k);
        }
        const matches = await index.search(target, 1);
        if (matches.length > 0) {
            const winner = matches[0].item.value;
            const idx = Number(winner.split("\t", 1)[0]);
            if (Number.isInteger(idx) && windows[idx] !== undefined) {
                return windows[idx];
            }
        }
    } catch (e: any) {
        debugError(`Embedding match failed, using substring: ${e.message}`);
    }

    return direct;
}
