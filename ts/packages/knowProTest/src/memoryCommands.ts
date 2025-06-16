// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowproContext } from "./knowproContext.js";
import { NamedArgs, parseTypedArguments } from "interactive-app";
import {
    GetAnswerRequest,
    getAnswerRequestDef,
    GetAnswerResponse,
    podcastLoadDef,
    PodcastLoadRequest,
    SearchRequest,
    searchRequestDef,
    SearchResponse,
} from "./types.js";
import {
    memoryNameToIndexPath,
    sourcePathToMemoryIndexPath,
} from "./common.js";
import * as cm from "conversation-memory";
import { error, Result, success } from "typechat";
import path from "path";
import { getFileName } from "typeagent";

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

export async function execLoadPodcast(
    context: KnowproContext,
    request: string[] | PodcastLoadRequest,
): Promise<Result<cm.Podcast>> {
    if (Array.isArray(request)) {
        request = parseTypedArguments<PodcastLoadRequest>(
            request,
            podcastLoadDef(),
        );
    }
    let podcastFilePath = request.filePath;
    if (!podcastFilePath) {
        podcastFilePath = request.name
            ? memoryNameToIndexPath(context.basePath, request.name)
            : undefined;
    } else {
        podcastFilePath = sourcePathToMemoryIndexPath(podcastFilePath);
    }
    if (!podcastFilePath) {
        return error("No filepath or name provided");
    }
    const podcast = await cm.Podcast.readFromFile(
        path.dirname(podcastFilePath),
        getFileName(podcastFilePath),
    );
    if (!podcast) {
        return error("Podcast file not found");
    }
    context.conversation = podcast;
    return success(podcast);
}
