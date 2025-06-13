// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as kp from "knowpro";
import { Result } from "typechat";
import { AnswerDebugContext, KnowproContext } from "./knowproContext.js";
import { NamedArgs, parseTypedArguments } from "interactive-app";
import { SearchRequest, searchRequestDef } from "./requests.js";

export function execSearchCommand(
    context: KnowproContext,
    args: string[] | NamedArgs,
): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
    const request = parseTypedArguments<SearchRequest>(
        args,
        searchRequestDef(),
    );
    return context.execSearchRequest(request);
}

export async function execAnswerRequest(context: KnowproContext) {}
