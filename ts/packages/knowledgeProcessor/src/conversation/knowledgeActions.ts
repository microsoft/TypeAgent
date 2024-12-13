// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PromptSection,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SearchAction } from "./knowledgeSearchSchema.js";
import { dateTime, loadSchema } from "typeagent";
import { DateTime, DateTimeRange, DateVal, TimeVal } from "./dateTimeSchema.js";
import { SearchTermsAction } from "./knowledgeTermSearchSchema.js";
import { SearchTermsActionV2 } from "./knowledgeTermSearchSchema2.js";

export interface KnowledgeActionTranslator {
    requestInstructions: string;

    translateSearch(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchAction>>;
    translateSearchTerms(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchTermsAction>>;
    translateSearchTermsV2(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchTermsActionV2>>;
}

export function createKnowledgeActionTranslator(
    model: TypeChatLanguageModel,
): KnowledgeActionTranslator {
    const typeName = "SearchAction";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "knowledgeSearchSchema.ts"],
        import.meta.url,
    );

    const validator = createTypeScriptJsonValidator<SearchAction>(
        searchActionSchema,
        typeName,
    );
    const knowledgeActionTranslator = createJsonTranslator<SearchAction>(
        model,
        validator,
    );
    knowledgeActionTranslator.createRequestPrompt = createRequestPrompt;

    const searchTermsTranslator = createJsonTranslator<SearchTermsAction>(
        model,
        createTypeScriptJsonValidator<SearchTermsAction>(
            loadSchema(
                ["dateTimeSchema.ts", "knowledgeTermSearchSchema.ts"],
                import.meta.url,
            ),
            "SearchTermsAction",
        ),
    );

    const searchTermsTranslatorV2 = createJsonTranslator<SearchTermsActionV2>(
        model,
        createTypeScriptJsonValidator<SearchTermsActionV2>(
            loadSchema(
                ["dateTimeSchema.ts", "knowledgeTermSearchSchema2.ts"],
                import.meta.url,
            ),
            "SearchTermsActionV2",
        ),
    );
    searchTermsTranslatorV2.createRequestPrompt = (request) =>
        createSearchTermsPrompt(searchTermsTranslatorV2, request);

    const translators: KnowledgeActionTranslator = {
        requestInstructions:
            "The following is a user request about a conversation between one or more users and assistants:\n",
        translateSearch,
        translateSearchTerms,
        translateSearchTermsV2,
    };
    return translators;

    async function translateSearch(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchAction>> {
        return knowledgeActionTranslator.translate(userRequest, context);
    }

    async function translateSearchTerms(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchTermsAction>> {
        return searchTermsTranslator.translate(userRequest, context);
    }

    async function translateSearchTermsV2(
        userRequest: string,
        context?: PromptSection[],
    ): Promise<Result<SearchTermsActionV2>> {
        return searchTermsTranslatorV2.translate(userRequest, context);
    }

    function createRequestPrompt(request: string) {
        return (
            `You are a service who translates user requests into a JSON object of type "${typeName}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${searchActionSchema}\`\`\`\n` +
            translators.requestInstructions +
            `"""\n${request}\n"""\n\n` +
            `The following is a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }

    function createSearchTermsPrompt<T extends object>(
        translator: TypeChatJsonTranslator<T>,
        request: string,
    ) {
        return (
            `You are a service who translates user requests into a JSON object of type "${translator.validator.getTypeName()}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${translator.validator.getSchemaText()}\`\`\`\n` +
            "When translating user requests, ensure that all pronouns are contextualized and replaced with the person or entity they refer to.\n" +
            translators.requestInstructions +
            `"""\n${request}\n"""\n\n` +
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

export function dateToDateTime(dt: Date): DateTime {
    const date: DateVal = {
        day: dt.getDate(),
        month: dt.getMonth() + 1,
        year: dt.getFullYear(),
    };
    const time: TimeVal = {
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        seconds: dt.getSeconds(),
    };
    return {
        date,
        time,
    };
}
