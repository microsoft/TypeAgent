// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExploreTelemetry, ExploreUsage } from "./types.js";

export function createUsage(): ExploreUsage {
    return {
        requestCount: 0,
        usageComplete: true,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
}

export function addExploreUsage(
    target: ExploreUsage,
    current: ExploreUsage,
): void {
    target.requestCount += current.requestCount;
    target.usageComplete =
        target.usageComplete !== false && current.usageComplete !== false;
    target.inputTokens += current.inputTokens;
    target.cachedInputTokens += current.cachedInputTokens;
    target.outputTokens += current.outputTokens;
    target.reasoningOutputTokens += current.reasoningOutputTokens;
    target.totalTokens += current.totalTokens;
}

export async function writeExploreTelemetry(
    fileName: string | undefined,
    telemetry: ExploreTelemetry,
): Promise<void> {
    if (!fileName) {
        return;
    }
    const directory = path.dirname(fileName);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(
        directory,
        `.${path.basename(fileName)}.tmp-${process.pid}-${randomUUID()}`,
    );
    try {
        await writeFile(
            temporary,
            JSON.stringify(telemetry, undefined, 2) + "\n",
            "utf8",
        );
        await rename(temporary, fileName);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
