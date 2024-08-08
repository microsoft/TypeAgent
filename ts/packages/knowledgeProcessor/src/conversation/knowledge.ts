// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, loadSchema } from "typeagent";
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
import { createRecentItemsWindow } from "./conversation.js";
import { SourceTextBlock, TextBlock, TextBlockType } from "../text.js";

export interface KnowledgeExtractor {
    next(message: string): Promise<KnowledgeResponse | undefined>;
}

export type KnowledgeExtractorSettings = {
    windowSize: number;
    maxContextLength: number;
    includeSuggestedTopics?: boolean | undefined;
    includeActions: boolean;
};

export function createKnowledgeExtractor(
    model: TypeChatLanguageModel,
    settings: KnowledgeExtractorSettings,
): KnowledgeExtractor {
    const translator = createTranslator(model);
    const topics = createRecentItemsWindow<string>(settings.windowSize);
    return {
        next,
    };

    async function next(
        message: string,
    ): Promise<KnowledgeResponse | undefined> {
        const result = await translator.translate(
            message,
            settings.includeSuggestedTopics
                ? getContext(topics.getUnique())
                : undefined,
        );
        if (!result.success) {
            return undefined;
        }
        if (result.data.actions === undefined) {
            result.data.actions = [];
        }
        topics.push(result.data.topics);
        return result.data;
    }

    function getContext(pastTopics?: string[]): string {
        const context = {
            context: {
                possibleTopics: pastTopics ? pastTopics : [],
            },
        };
        return JSON.stringify(context, null, 2);
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
}

export type ExtractedEntity<TSourceId = any> = {
    value: ConcreteEntity;
    sourceIds: TSourceId[];
};

export type ExtractedAction<TSourceId = any> = {
    value: Action;
    sourceIds: TSourceId[];
};

export type ExtractedKnowledge<TSourceId = any> = {
    entities?: ExtractedEntity<TSourceId>[] | undefined;
    topics?: TextBlock<TSourceId>[] | undefined;
    actions?: ExtractedAction<TSourceId>[] | undefined;
};

export async function extractKnowledgeFromBlock(
    extractor: KnowledgeExtractor,
    message: SourceTextBlock,
): Promise<[SourceTextBlock, ExtractedKnowledge] | undefined> {
    const messageText = message.value.trim();
    if (message.value.length === 0) {
        return undefined;
    }
    let knowledgeResponse = await extractor.next(messageText);
    if (!knowledgeResponse) {
        return undefined;
    }
    const sourceIds = [message.blockId];
    const topics: TextBlock[] | undefined =
        knowledgeResponse.topics.length > 0
            ? knowledgeResponse.topics.map((value) => {
                  return {
                      value,
                      sourceIds,
                      type: TextBlockType.Sentence,
                  };
              })
            : undefined;
    const entities: ExtractedEntity[] | undefined =
        knowledgeResponse.entities.length > 0
            ? knowledgeResponse.entities.map((value) => {
                  return { value, sourceIds };
              })
            : undefined;

    const actions: ExtractedAction[] | undefined =
        knowledgeResponse.actions.length > 0
            ? knowledgeResponse.actions.map((value) => {
                  return { value, sourceIds };
              })
            : undefined;

    return [message, { entities, topics, actions }];
}

export async function* extractKnowledge(
    model: TypeChatLanguageModel,
    messages: AsyncIterableIterator<SourceTextBlock>,
    settings: KnowledgeExtractorSettings,
): AsyncIterableIterator<[SourceTextBlock, ExtractedKnowledge]> {
    const extractor = createKnowledgeExtractor(model, settings);
    for await (const message of messages) {
        const result = await extractKnowledgeFromBlock(extractor, message);
        if (result) {
            yield result;
        }
    }
}

export function knowledgeValueToString(value: Value): string {
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export function actionToString(action: Action): string {
    let text = "";
    if (action.subjectEntityName !== "none") {
        text += " ";
        text += action.subjectEntityName;
    }
    text += ` [${action.verbs.join(", ")}]`;
    if (action.params) {
        text += "(";
        text += actionParamsToString(action);
        text += ")";
    }
    if (action.objectEntityName !== "none") {
        text += " ";
        text += action.objectEntityName;
    }
    text += ` {${action.verbTense}}`;
    return text;
}

export function actionVerbsToString(
    verbs: string[],
    verbTense: VerbTense,
): string {
    const text = `${verbs.join(" ")} {In ${verbTense}}`;
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
