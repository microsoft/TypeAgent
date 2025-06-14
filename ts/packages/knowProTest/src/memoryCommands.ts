// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowproContext } from "./knowproContext.js";
import {
    getBatchFileLines,
    NamedArgs,
    parseCommandLine,
    parseTypedArguments,
} from "interactive-app";
import {
    GetAnswerRequest,
    getAnswerRequestDef,
    GetAnswerResponse,
    SearchRequest,
    searchRequestDef,
    SearchResponse,
} from "./requests.js";
import { Result, success } from "typechat";

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

export async function execBatch<T>(
    batchFilePath: string,
    cb: (args: string[]) => Promise<Result<T>>,
): Promise<Result<T[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: T[] = [];
    for (const line of batchLines) {
        const args = parseCommandLine(line);
        if (args && args.length > 0) {
            const result = await cb(args);
            if (!result.success) {
                return result;
            }
            results.push(result.data);
        }
    }
    return success(results);
}
