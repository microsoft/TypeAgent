// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PromptSection,
    Result,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SearchAction } from "./knowledgeSearchSchema.js";
import { dateTime, loadSchema } from "typeagent";
import { DateTime, DateTimeRange } from "./dateTimeSchema.js";

export interface KnowledgeActionTranslator {
    translateSearch(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchAction>>;
}

export function createKnowledgeActionTranslator(
    model: TypeChatLanguageModel,
): KnowledgeActionTranslator {
    const typeName = "SearchAction";
    const schema = loadSchema(
        ["dateTimeSchema.ts", "knowledgeSearchSchema.ts"],
        import.meta.url,
    );
    const validator = createTypeScriptJsonValidator<SearchAction>(
        schema,
        typeName,
    );
    const knowledgeActionTranslator = createJsonTranslator<SearchAction>(
        model,
        validator,
    );
    knowledgeActionTranslator.createRequestPrompt = createRequestPrompt;
    return {
        translateSearch,
    };

    async function translateSearch(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchAction>> {
        return knowledgeActionTranslator.translate(userRequest, context);
    }

    function createRequestPrompt(request: string) {
        return (
            `The following is a user request about a conversation between one or more users and assistants:\n` +
            `"""\n${request}\n"""\n\n` +
            `You are a service who translates user requests into a JSON object of type "${typeName}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following is a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

export function toDateRange(range: DateTimeRange): dateTime.DateRange {
    return {
        startDate: toStartDate(range.startDate),
        stopDate: toStopDate(range.stopDate),
    };
}

export function toStartDate(dateTime: DateTime): Date {
    let dt: Date;
    if (dateTime.time) {
        return dateTimeToDate(dateTime);
    } else {
        dt = new Date(
            dateTime.date.year,
            dateTime.date.month - 1,
            dateTime.date.day,
            0,
            0,
            0,
            0,
        );
    }
    return dt;
}

export function toStopDate(dateTime: DateTime | undefined): Date | undefined {
    if (!dateTime) {
        return undefined;
    }
    let dt: Date;
    if (dateTime.time) {
        return dateTimeToDate(dateTime);
    } else {
        dt = new Date(
            dateTime.date.year,
            dateTime.date.month - 1,
            dateTime.date.day,
            23,
            59,
            59,
            999,
        );
    }
    return dt;
}

export function dateTimeToDate(dateTime: DateTime): Date {
    let dt: Date;
    if (dateTime.time) {
        dt = new Date(
            dateTime.date.year,
            dateTime.date.month - 1,
            dateTime.date.day,
            dateTime.time.hour,
            dateTime.time.minute,
            dateTime.time.seconds,
        );
    } else {
        dt = new Date(
            dateTime.date.year,
            dateTime.date.month - 1,
            dateTime.date.day,
        );
    }
    return dt;
}
