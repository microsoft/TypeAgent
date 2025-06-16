// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as cm from "conversation-memory";
import { parseTypedArguments } from "interactive-app";
import path from "path";
import { getFileName } from "typeagent";
import { Result, error, success } from "typechat";
import {
    memoryNameToIndexPath,
    sourcePathToMemoryIndexPath,
} from "./common.js";
import { KnowproContext } from "./knowproContext.js";
import { PodcastLoadRequest, podcastLoadDef } from "./types.js";

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
