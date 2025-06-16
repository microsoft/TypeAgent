// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowproContext } from "./knowproContext.js";
import { NamedArgs, parseTypedArguments } from "interactive-app";
import {
    GetAnswerRequest,
    getAnswerRequestDef,
    GetAnswerResponse,
    SearchRequest,
    searchRequestDef,
    SearchResponse,
} from "./types.js";

export type BatchCallback<T> = (value: T, index: number, total: number) => void;

export function execSearchCommand(
    context: KnowproContext,
    args: string[] | NamedArgs,
): Promise<SearchResponse> {
    const request = parseTypedArguments<SearchRequest>(
        args,
        searchRequestDef(),
    );
    return context.execSearchRequest(request);
}

export async function execGetAnswerCommand(
    context: KnowproContext,
    args: string[] | NamedArgs,
): Promise<GetAnswerResponse> {
    const request = parseTypedArguments<GetAnswerRequest>(
        args,
        getAnswerRequestDef(),
    );
    return context.execGetAnswerRequest(request);
}
