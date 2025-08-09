// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { async, asyncArray, collections, loadSchema } from "typeagent";
import {
    Action,
    ConcreteEntity,
    KnowledgeResponse,
    Value,
} from "./knowledgeSchema.js";
import {
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SourceTextBlock, TextBlock, TextBlockType } from "../text.js";
import { mergeEntityFacet } from "./entities.js";
import { unionArrays } from "../setOperations.js";

export interface KnowledgeExtractor {
    readonly settings: KnowledgeExtractorSettings;
    extract(message: string): Promise<KnowledgeResponse | undefined>;
    extractWithRetry(
        message: string,
        maxRetries: number,
    ): Promise<Result<KnowledgeResponse>>;
    /**
     * Custom translator to use
     */
    translator?: TypeChatJsonTranslator<KnowledgeResponse> | undefined;
}

export type KnowledgeExtractorSettings = {
    maxContextLength: number;
    mergeActionKnowledge?: boolean;
    mergeEntityFacets?: boolean;
};

/**
 * Create a new knowledge extractor
 * @param model
 * @param extractorSettings
 * @param knowledgeTranslator (optional) knowledge translator to use
 * @returns
 */
export function createKnowledgeExtractor(
    model: TypeChatLanguageModel,
    extractorSettings?: KnowledgeExtractorSettings | undefined,
    knowledgeTranslator?: TypeChatJsonTranslator<KnowledgeResponse> | undefined,
): KnowledgeExtractor {
    const settings = extractorSettings ?? createKnowledgeExtractorSettings();
    const translator = knowledgeTranslator ?? createKnowledgeTranslator(model);
    const extractor: KnowledgeExtractor = {
        settings,
        extract,
        extractWithRetry,
        translator,
    };
    return extractor;

    async function extract(
        message: string,
    ): Promise<KnowledgeResponse | undefined> {
        const result = await extractKnowledge(message);
        if (!result.success) {
            return undefined;
        }
        return result.data;
    }

    function extractWithRetry(
        message: string,
        maxRetries: number,
    ): Promise<Result<KnowledgeResponse>> {
        return async.getResultWithRetry(
            () => extractKnowledge(message),
            maxRetries,
        );
    }

    async function extractKnowledge(
        message: string,
    ): Promise<Result<KnowledgeResponse>> {
        const result = await (extractor.translator ?? translator).translate(
            message,
        );
        if (result.success) {
            if (settings.mergeActionKnowledge || settings.mergeEntityFacets) {
                mergeActionKnowledge(result.data);
            }
        }
        return result;
    }

    //
    // Some knowledge found via actions is actually meant for entities...
    //
    function mergeActionKnowledge(knowledge: KnowledgeResponse) {
        if (knowledge.actions === undefined) {
            knowledge.actions = [];
        }
        if (settings.mergeActionKnowledge) {
            // Merge all inverse actions into regular actions.
            if (
                knowledge.inverseActions &&
                knowledge.inverseActions.length > 0
            ) {
                knowledge.actions.push(...knowledge.inverseActions);
                knowledge.inverseActions = [];
            }
        }
        if (settings.mergeActionKnowledge || settings.mergeEntityFacets) {
            // Also merge in any facets into
            for (const action of knowledge.actions) {
                if (action.subjectEntityFacet) {
                    const entity = knowledge.entities.find(
                        (c) => c.name === action.subjectEntityName,
                    );
                    if (entity) {
                        mergeEntityFacet(entity, action.subjectEntityFacet);
                    }
                    action.subjectEntityFacet = undefined;
                }
            }
        }
    }
}

export function createKnowledgeTranslator(
    model: TypeChatLanguageModel,
): TypeChatJsonTranslator<KnowledgeResponse> {
    const schema = loadSchema(["knowledgeSchema.ts"], import.meta.url);
    const typeName = "KnowledgeResponse";
    const validator = createTypeScriptJsonValidator<KnowledgeResponse>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<KnowledgeResponse>(
        model,
        validator,
    );
    translator.createRequestPrompt = createRequestPrompt;
    return translator;

    function createRequestPrompt(request: string) {
        return (
            `You are a service that translates user messages in a conversation into JSON objects of type "${typeName}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following are messages in a conversation:\n` +
            `"""\n${request}\n"""\n` +
            `The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

/**
 * Return default settings
 * @param maxCharsPerChunk (optional)
 * @returns
 */
export function createKnowledgeExtractorSettings(
    maxCharsPerChunk: number = 2048,
): KnowledgeExtractorSettings {
    return {
        maxContextLength: maxCharsPerChunk,
        mergeActionKnowledge: true,
    };
}

export type ExtractedEntity<TSourceId = any> = {
    value: ConcreteEntity;
    sourceIds: TSourceId[];
};

export type ExtractedAction<TSourceId = any> = {
    value: Action;
    sourceIds: TSourceId[];
};

/**
 * Knowledge extracted from a source text block
 */
export type ExtractedKnowledge<TSourceId = any> = {
    entities?: ExtractedEntity<TSourceId>[] | undefined;
    topics?: TextBlock<TSourceId>[] | undefined;
    actions?: ExtractedAction<TSourceId>[] | undefined;
    sourceEntityName?: string | undefined;
    tags?: string[] | undefined;
};

/**
 * Create knowledge from pre-existing entities, topics and actions
 * @param source
 * @returns
 */
export function createExtractedKnowledge(
    source: SourceTextBlock,
    knowledge: KnowledgeResponse | ConcreteEntity[],
): ExtractedKnowledge {
    const sourceIds = [source.blockId];
    const ek: ExtractedKnowledge = {};
    if (Array.isArray(knowledge)) {
        ek.entities =
            knowledge.length > 0
                ? knowledge.map((value) => {
                      return { value, sourceIds };
                  })
                : undefined;
        return ek;
    }

    ek.topics =
        knowledge.topics.length > 0
            ? knowledge.topics.map((value) => {
                  return {
                      value,
                      sourceIds,
                      type: TextBlockType.Sentence,
                  };
              })
            : undefined;
    ek.entities =
        knowledge.entities.length > 0
            ? knowledge.entities.map((value) => {
                  return { value, sourceIds };
              })
            : undefined;

    ek.actions =
        knowledge.actions && knowledge.actions.length > 0
            ? knowledge.actions.map((value) => {
                  return { value, sourceIds };
              })
            : undefined;
    return ek;
}

/**
 * Extract knowledge from source text
 * @param extractor
 * @param message
 * @returns
 */
export async function extractKnowledgeFromBlock(
    extractor: KnowledgeExtractor,
    message: SourceTextBlock,
): Promise<[SourceTextBlock, ExtractedKnowledge] | undefined> {
    const messageText = message.value.trim();
    if (message.value.length === 0) {
        return undefined;
    }
    let knowledge = await extractor.extract(messageText);
    if (!knowledge) {
        return undefined;
    }
    return [message, createExtractedKnowledge(message, knowledge)];
}

/**
 * Extract knowledge from the given blocks concurrently
 * @param extractor
 * @param blocks
 * @param concurrency
 * @returns
 */
export async function extractKnowledge(
    extractor: KnowledgeExtractor,
    blocks: SourceTextBlock[],
    concurrency: number,
) {
    return asyncArray.mapAsync(blocks, concurrency, (message) =>
        extractKnowledgeFromBlock(extractor, message),
    );
}

export const NoEntityName = "none";

export function knowledgeValueToString(value: Value): string {
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export enum KnownEntityTypes {
    Person = "person",
    Email = "email",
    Email_Address = "email_address",
    Email_Alias = "alias",
    Memorized = "__memory",
    Message = "message",
}

export function isMemorizedEntity(entityType: string[]): boolean {
    return entityType.findIndex((t) => t === KnownEntityTypes.Memorized) >= 0;
}

export function isKnowledgeEmpty(knowledge: KnowledgeResponse): boolean {
    return (
        knowledge.topics.length === 0 &&
        knowledge.entities.length === 0 &&
        knowledge.actions.length === 0
    );
}

export function mergeKnowledge(
    x: ExtractedKnowledge,
    y?: ExtractedKnowledge | undefined,
): ExtractedKnowledge {
    const merged = new Map<string, ExtractedEntity>();
    if (x.entities && x.entities.length > 0) {
        mergeEntities(x.entities, merged);
    }
    if (y && y.entities && y.entities.length > 0) {
        mergeEntities(y.entities, merged);
    }

    let topics = y ? collections.concatArrays(x.topics, y.topics) : x.topics;
    let actions = y
        ? collections.concatArrays(x.actions, y.actions)
        : x.actions;
    return {
        entities: [...merged.values()],
        topics,
        actions,
    };
}

function mergeEntities(
    entities: ExtractedEntity[],
    nameToEntityMap: Map<string, ExtractedEntity>,
): void {
    for (const ee of entities) {
        const entity = prepareEntityForMerge(ee.value);
        const existing = nameToEntityMap.get(entity.name);
        if (existing) {
            // We already have an entity with this name. Merge the entity's types
            existing.value.type = unionArrays(
                existing.value.type,
                entity.type,
            )!;
            if (entity.facets && entity.facets.length > 0) {
                for (const f of entity.facets) {
                    mergeEntityFacet(existing.value, f);
                }
            }
        } else {
            // Have not seen this entity before
            nameToEntityMap.set(entity.name, ee);
        }
    }
}

function prepareEntityForMerge(entity: ConcreteEntity) {
    entity.name = entity.name.toLowerCase();
    collections.lowerAndSort(entity.type);
    return entity;
}

export function isValidEntityName(name: string | undefined): boolean {
    return name !== undefined && name.length > 0 && name !== NoEntityName;
}
