// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { ChatModel, openai } from "aiclient";
import {
    Facet,
    Observation,
    ObservedEntity,
    ObservedRelation,
    TrustTier,
} from "../model.js";
import { Feeder, FeederInput } from "../feeder.js";

// Feeder that borrows the knowledge-processor extractor to mine entities and
// relations from text.
//
// REM only *borrows* the extractor — it does NOT depend on KnowPro storage,
// indexing, or retrieval (we deliberately use knowledge-processor directly so
// REM stays standalone). The extractor output is mapped to REM observations
// tagged with the ExtractorInferred trust tier.

const FEEDER_NAME = "knowledge-extraction";

/** Create a chat model configured for knowledge extraction (no KnowPro dep). */
function createExtractionModel(): ChatModel {
    const settings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    settings.retryPauseMs = 10000;
    return openai.createJsonChatModel(settings, ["chatExtractor"]);
}

/** Create a knowledge extractor with REM's standard options. */
function createExtractor(chatModel?: ChatModel): kpLib.KnowledgeExtractor {
    return kpLib.createKnowledgeExtractor(
        chatModel ?? createExtractionModel(),
        {
            maxContextLength: 4096,
            mergeActionKnowledge: false,
            mergeEntityFacets: true,
        },
    );
}

/** Structural view of a knowledge-extraction result (decouples the mapper). */
export type KnowledgeLike = {
    entities: {
        name: string;
        type: string[];
        facets?: { name: string; value: unknown }[];
    }[];
    actions: {
        verbs: string[];
        subjectEntityName: string | "none";
        objectEntityName: string | "none";
    }[];
    topics?: string[];
};

/** Coerce a kpLib facet Value (incl. Quantity/Quantifier) to a scalar. */
function facetValueToScalar(value: unknown): string | number | boolean {
    if (typeof value === "object" && value !== null) {
        const v = value as { amount?: unknown; units?: unknown };
        const amount = v.amount ?? "";
        const units = v.units ?? "";
        return `${amount} ${units}`.trim();
    }
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }
    return String(value);
}

function mapFacets(
    facets?: { name: string; value: unknown }[],
): Facet[] | undefined {
    if (facets === undefined || facets.length === 0) {
        return undefined;
    }
    return facets.map((f) => ({
        name: f.name,
        value: facetValueToScalar(f.value),
    }));
}

/**
 * Pure mapping from a knowledge-extraction result to a single REM observation.
 * Exported so it can be unit-tested without invoking the extractor/LLM.
 */
export function knowledgeToObservation(
    knowledge: KnowledgeLike,
    opts: {
        source?: string | undefined;
        timestamp: number;
        confidence?: number | undefined;
    },
): Observation {
    const entities: ObservedEntity[] = knowledge.entities.map((e) => ({
        name: e.name,
        types: e.type ?? [],
        facets: mapFacets(e.facets),
    }));

    // Build a set of valid entity names so relations only reference real entities.
    const known = new Set(entities.map((e) => e.name));

    const relations: ObservedRelation[] = [];
    for (const action of knowledge.actions) {
        const subject = action.subjectEntityName;
        const object = action.objectEntityName;
        if (
            subject === "none" ||
            object === "none" ||
            !known.has(subject) ||
            !known.has(object)
        ) {
            continue;
        }
        const predicate = (action.verbs ?? []).join("_") || "related_to";
        relations.push({ subject, predicate, object });
    }

    return {
        feeder: FEEDER_NAME,
        tier: TrustTier.ExtractorInferred,
        timestamp: opts.timestamp,
        confidence: opts.confidence,
        source: opts.source,
        entities,
        relations,
    };
}

/** Feeder wrapping KnowPro's knowledge extractor. */
export class KnowledgeExtractionFeeder implements Feeder {
    readonly name = FEEDER_NAME;
    readonly tier = TrustTier.ExtractorInferred;

    private readonly extractor: kpLib.KnowledgeExtractor;
    private readonly maxRetries: number;

    constructor(chatModel?: ChatModel, maxRetries = 3) {
        this.extractor = createExtractor(chatModel);
        this.maxRetries = maxRetries;
    }

    async produce(input: FeederInput): Promise<Observation[]> {
        const timestamp = input.timestamp ?? Date.now();
        const result = await this.extractor.extractWithRetry(
            input.text,
            this.maxRetries,
        );
        if (!result.success) {
            return [];
        }
        const observation = knowledgeToObservation(result.data, {
            source: input.source,
            timestamp,
        });
        return [observation];
    }
}
