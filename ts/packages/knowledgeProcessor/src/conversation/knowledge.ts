// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, collections, loadSchema } from "typeagent";
import {
    Action,
    ActionParam,
    ConcreteEntity,
    KnowledgeResponse,
    Value,
    VerbTense,
} from "./knowledgeSchema.js";
import {
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SourceTextBlock, TextBlock, TextBlockType } from "../text.js";
import { facetToString, mergeEntityFacet } from "./entities.js";

export interface KnowledgeExtractor {
    readonly settings: KnowledgeExtractorSettings;
    extract(message: string): Promise<KnowledgeResponse | undefined>;
}

export type KnowledgeExtractorSettings = {
    maxContextLength: number;
    includeActions: boolean;
    mergeActionKnowledge?: boolean;
};

export function createKnowledgeExtractor(
    model: TypeChatLanguageModel,
    extractorSettings?: KnowledgeExtractorSettings | undefined,
): KnowledgeExtractor {
    const settings = extractorSettings ?? createKnowledgeExtractorSettings();
    const translator = createTranslator(model);
    return {
        settings,
        extract,
    };

    async function extract(
        message: string,
    ): Promise<KnowledgeResponse | undefined> {
        const result = await translator.translate(message);
        if (!result.success) {
            return undefined;
        }
        if (settings.mergeActionKnowledge) {
            mergeActionKnowledge(result.data);
        }
        return result.data;
    }

    function createTranslator(
        model: TypeChatLanguageModel,
    ): TypeChatJsonTranslator<KnowledgeResponse> {
        const schema = loadSchema(
            [
                settings.includeActions
                    ? "knowledgeSchema.ts"
                    : "knowledgeNoActionsSchema.ts",
            ],
            import.meta.url,
        );
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

    //
    // Some knowledge found via actions is actually meant for entities...
    //
    function mergeActionKnowledge(knowledge: KnowledgeResponse) {
        if (knowledge.actions === undefined) {
            knowledge.actions = [];
        }
        // Merge all inverse actions into regular actions.
        if (knowledge.inverseActions && knowledge.inverseActions.length > 0) {
            knowledge.actions.push(...knowledge.inverseActions);
            knowledge.inverseActions = [];
        }
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
        includeActions: true,
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

export function actionToString(action: Action): string {
    let text = "";
    text = appendEntityName(text, action.subjectEntityName);
    text += ` [${action.verbs.join(", ")}]`;
    text = appendEntityName(text, action.objectEntityName);
    text = appendEntityName(text, action.indirectObjectEntityName);
    text += ` {${action.verbTense}}`;
    if (action.subjectEntityFacet) {
        text += ` <${facetToString(action.subjectEntityFacet)}>`;
    }
    return text;

    function appendEntityName(text: string, name: string): string {
        if (name !== NoEntityName) {
            text += " ";
            text += name;
        }
        return text;
    }
}

export function actionVerbsToString(
    verbs: string[],
    verbTense?: VerbTense,
): string {
    const text = verbTense
        ? `${verbs.join(" ")} {In ${verbTense}}`
        : verbs.join(" ");
    return text;
}

export function actionParamsToString(action: Action): string {
    return action.params
        ? action.params.map((p) => actionParamToString(p)).join("; ")
        : "";
}

function actionParamToString(param: string | ActionParam): string {
    return typeof param === "string"
        ? param
        : `${param.name}="${knowledgeValueToString(param.value)}"`;
}

export function actionToLowerCase(action: Action): Action {
    action.subjectEntityName = action.subjectEntityName.toLowerCase();
    action.objectEntityName = action.objectEntityName.toLowerCase();
    collections.lowerAndSort(action.verbs);
    return action;
}
