// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { ChatModel, openai } from "aiclient";
import registerDebug from "debug";
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

// Surfaces extraction failures / empty extractions that were previously
// swallowed. Enable with DEBUG=rem-memory.extraction:error
const debugError = registerDebug("rem-memory.extraction:error");

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
        /** A facet the action implies about its subject (e.g. an interest). */
        subjectEntityFacet?: { name: string; value: unknown } | undefined;
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

/** Append a facet to an entity, skipping duplicates by case-insensitive name. */
function addFacet(entity: ObservedEntity, facet: Facet): void {
    const facets = entity.facets ?? [];
    const name = facet.name.toLowerCase();
    if (facets.some((f) => f.name.toLowerCase() === name)) {
        return;
    }
    entity.facets = [...facets, facet];
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

    // Index entities by name so relations only reference real entities and
    // action-implied subject facets can be attached back to them.
    const byName = new Map<string, ObservedEntity>();
    for (const entity of entities) {
        byName.set(entity.name, entity);
    }
    const known = new Set(byName.keys());

    // Attach action-implied subject facets (e.g. "wrote unsuccessfully for 7
    // years") to their subject entity. The knowledge schema surfaces these as
    // `subjectEntityFacet`; REM previously dropped them, losing attribute /
    // duration details that multi-hop questions depend on.
    for (const action of knowledge.actions) {
        const facet = action.subjectEntityFacet;
        const entity = byName.get(action.subjectEntityName);
        if (facet === undefined || entity === undefined) {
            continue;
        }
        addFacet(entity, {
            name: facet.name,
            value: facetValueToScalar(facet.value),
        });
    }

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

/** Cumulative counters describing extraction outcomes. */
export type ExtractionStats = {
    /** Total extraction attempts. */
    attempts: number;
    /** Attempts that failed after exhausting retries. */
    failures: number;
    /** Successful extractions that yielded no entities. */
    empty: number;
};

/** A fresh, zeroed {@link ExtractionStats}. */
export function newExtractionStats(): ExtractionStats {
    return { attempts: 0, failures: 0, empty: 0 };
}

/** Minimal shape of an extraction result (mirrors typechat's `Result`). */
export type ExtractionResult =
    | { success: true; data: KnowledgeLike }
    | { success: false; message: string };

/**
 * Map an extraction result to REM observations, recording outcome stats and
 * surfacing failures / empty extractions via debug logging.
 *
 * The feeder historically swallowed `!result.success` and returned `[]`, so a
 * misconfigured extractor could silently leave the store empty. This makes such
 * cases observable (via {@link ExtractionStats} and
 * `DEBUG=rem-memory.extraction:error`). Pure apart from mutating `stats` and
 * emitting debug logs, so it is unit-testable without invoking the LLM.
 */
export function observationsFromExtraction(
    result: ExtractionResult,
    input: { source?: string | undefined },
    timestamp: number,
    stats: ExtractionStats,
): Observation[] {
    stats.attempts++;
    const source = input.source ?? "<none>";
    if (!result.success) {
        stats.failures++;
        debugError(
            "extraction failed after retries (source=%s): %s",
            source,
            result.message,
        );
        return [];
    }
    const observation = knowledgeToObservation(result.data, {
        source: input.source,
        timestamp,
    });
    if (observation.entities.length === 0) {
        stats.empty++;
        debugError("extraction produced no entities (source=%s)", source);
    }
    return [observation];
}

/** Feeder wrapping KnowPro's knowledge extractor. */
export class KnowledgeExtractionFeeder implements Feeder {
    readonly name = FEEDER_NAME;
    readonly tier = TrustTier.ExtractorInferred;

    private readonly extractor: kpLib.KnowledgeExtractor;
    private readonly maxRetries: number;
    private readonly stats = newExtractionStats();

    constructor(chatModel?: ChatModel, maxRetries = 3) {
        this.extractor = createExtractor(chatModel);
        this.maxRetries = maxRetries;
    }

    /**
     * Cumulative extraction stats. A rising `failures` or `empty` count means
     * ingest is silently producing nothing (e.g. a misconfigured endpoint).
     */
    get extractionStats(): Readonly<ExtractionStats> {
        return this.stats;
    }

    async produce(input: FeederInput): Promise<Observation[]> {
        const timestamp = input.timestamp ?? Date.now();
        const result = await this.extractor.extractWithRetry(
            input.text,
            this.maxRetries,
        );
        return observationsFromExtraction(
            result,
            { source: input.source },
            timestamp,
            this.stats,
        );
    }
}
