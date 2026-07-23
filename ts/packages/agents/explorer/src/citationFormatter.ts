// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { RepositoryObservation } from "./script/repositoryApi.js";

const MAX_REJECTION_MESSAGE_CHARS = 1_000;
const MAX_REPORTED_OBSERVATIONS = 8;

interface ExploreLocation {
    path: string;
    startLine: number;
    endLine: number;
}

export interface FormattedLocations {
    text: string;
    citationCount: number;
    truncated: boolean;
}

export async function validateAndFormatLocations(
    rawLocations: unknown,
    repoRoot: string,
    maxResults: number,
    maxOutputChars: number,
    observations: RepositoryObservation[],
): Promise<FormattedLocations> {
    if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
        throw new Error(
            "submitExploration requires a non-empty locations array",
        );
    }
    if (rawLocations.length > maxResults) {
        throw new Error(
            `submitExploration permits at most ${maxResults} locations`,
        );
    }

    const validated: ExploreLocation[] = [];
    const seen = new Set<string>();
    for (const value of rawLocations) {
        const location = await validateLocation(value, repoRoot, observations);
        if (!location) {
            throw new Error(
                `Invalid grounded location: ${describeRejectedLocation(value, observations)}`.slice(
                    0,
                    MAX_REJECTION_MESSAGE_CHARS,
                ),
            );
        }
        const identity = `${location.path}\0${location.startLine}\0${location.endLine}`;
        if (seen.has(identity)) {
            throw new Error(
                `Duplicate grounded location: ${location.path}:${location.startLine}-${location.endLine}`,
            );
        }
        seen.add(identity);
        validated.push(location);
    }

    const text = validated
        .map((location) => {
            const range =
                location.startLine === location.endLine
                    ? String(location.startLine)
                    : `${location.startLine}-${location.endLine}`;
            return `${location.path}:${range}`;
        })
        .join("\n");
    if (text.length > maxOutputChars) {
        throw new Error(
            `Grounded localization exceeds the ${maxOutputChars}-character output limit`,
        );
    }
    return {
        text,
        citationCount: validated.length,
        truncated: false,
    };
}

function describeRejectedLocation(
    value: unknown,
    observations: RepositoryObservation[],
): string {
    if (!isRecord(value)) {
        return "non-object location";
    }
    const rawPath =
        typeof value.path === "string"
            ? value.path.trim().replaceAll("\\", "/").slice(0, 200)
            : "<invalid-path>";
    const startLine = Number.isSafeInteger(value.startLine)
        ? String(value.startLine)
        : "?";
    const endLine = Number.isSafeInteger(value.endLine)
        ? String(value.endLine)
        : "?";
    const observed = observations
        .filter((observation) => observation.path === rawPath)
        .slice(0, MAX_REPORTED_OBSERVATIONS)
        .map(
            (observation) =>
                `${observation.path}:${observation.startLine}-${observation.endLine}`,
        );
    return `${rawPath}:${startLine}-${endLine} rejected; ${
        observed.length > 0
            ? `observed ranges ${observed.join(", ")}`
            : "no matching observed range"
    }`;
}

async function validateLocation(
    value: unknown,
    repoRoot: string,
    observations: RepositoryObservation[],
): Promise<ExploreLocation | undefined> {
    if (!isRecord(value)) {
        return undefined;
    }
    const rawPath =
        typeof value.path === "string"
            ? value.path.trim().replaceAll("\\", "/")
            : "";
    if (
        !rawPath ||
        path.posix.isAbsolute(rawPath) ||
        rawPath.split("/").some((part) => part === "..")
    ) {
        return undefined;
    }
    const relativePath = path.posix.normalize(rawPath);
    if (relativePath === ".") {
        return undefined;
    }
    const startLine = value.startLine;
    const endLine = value.endLine;
    if (
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine) ||
        (startLine as number) < 1 ||
        (endLine as number) < (startLine as number) ||
        (endLine as number) - (startLine as number) > 1_000
    ) {
        return undefined;
    }
    if (
        !isRangeGrounded(
            relativePath,
            startLine as number,
            endLine as number,
            observations,
        )
    ) {
        return undefined;
    }
    try {
        const requestedFile = path.join(repoRoot, relativePath);
        if (!(await lstat(requestedFile)).isFile()) {
            return undefined;
        }
        const realFile = await realpath(requestedFile);
        const relative = path.relative(repoRoot, realFile);
        if (
            relative.startsWith("..") ||
            path.isAbsolute(relative) ||
            !(await stat(realFile)).isFile()
        ) {
            return undefined;
        }
    } catch {
        return undefined;
    }
    return {
        path: relativePath,
        startLine: startLine as number,
        endLine: endLine as number,
    };
}

function isRangeGrounded(
    relativePath: string,
    startLine: number,
    endLine: number,
    observations: RepositoryObservation[],
): boolean {
    let nextLine = startLine;
    const ranges = observations
        .filter((observation) => observation.path === relativePath)
        .sort((left, right) => left.startLine - right.startLine);
    for (const range of ranges) {
        if (range.endLine < nextLine) {
            continue;
        }
        if (range.startLine > nextLine) {
            return false;
        }
        if (range.endLine >= endLine) {
            return true;
        }
        nextLine = range.endLine + 1;
    }
    return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
