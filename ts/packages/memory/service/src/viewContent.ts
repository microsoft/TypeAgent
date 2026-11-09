// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { WikiIndexEntry, WikiPage } from "./viewTypes.js";
import { createHash } from "node:crypto";
import { canonicalizeProcedure } from "./agentEdition.js";

export function viewHash(value: unknown): string {
    return createHash("sha256")
        .update(canonicalizeProcedure(value ?? null))
        .digest("hex");
}

export function wikiIndex(pages: WikiPage[]): WikiIndexEntry[] {
    return pages.map((page) => ({
        pageId: page.id,
        title: page.heading,
        taxonomy: page.details.taxonomy,
    }));
}

export function viewSourceKey(source: {
    sourceId: string;
    revisionId: string;
    evidence?: { kind: "event"; eventId: string };
}): string {
    return `${source.evidence ? `event:${source.evidence.eventId}\n` : ""}${source.sourceId}\n${source.revisionId}`;
}

export function assertViewIdentifier(kind: string, value: string): void {
    if (
        typeof value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
    )
        throw new Error(`Invalid ${kind} '${value}'`);
}
