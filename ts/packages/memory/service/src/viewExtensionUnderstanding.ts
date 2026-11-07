// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AnswerDerivedReference, AnswerEvidence } from "./types.js";
import type { UnderstandingModuleRequest } from "./understandingTypes.js";
import type {
    ViewProviderIdentity,
    ViewPresentation,
} from "./viewExtensionTypes.js";
import type { ViewCitation, ViewVersion } from "./viewTypes.js";

export interface UnderstandingDerivedView {
    schemaVersion: 1;
    viewId: string;
    revisionId: string;
    provider: ViewProviderIdentity;
    title: string;
    selectedBlockIds: string[];
    sourceFragment?: {
        blockId: string;
        citationId: string;
        role: "support" | "opposition";
        source: Omit<ViewCitation, "excerpt">;
        text: string;
        offset: number;
        totalChars: number;
        nextOffset?: number;
    };
    presentation: Omit<ViewPresentation, "layouts"> & {
        layouts: Array<{ id: string; label: string }>;
        layout: ViewPresentation["layouts"][number];
    };
    blocks: Array<{
        id: string;
        heading: string;
        role: string;
        body: string;
        bodyOffset: number;
        bodyTotalChars: number;
        nextBodyOffset?: number;
        selectedForAnswer: boolean;
        citations: Array<{
            id: string;
            role: "support" | "opposition";
            source: Omit<ViewCitation, "excerpt">;
        }>;
        totalCitations: number;
        nextCitationOffset?: number;
    }>;
    offset: number;
    totalBlocks: number;
    nextOffset?: number;
    omittedBlocks: number;
}

export function selectedDerivedViews(
    evidence: AnswerEvidence[],
): Map<string, AnswerDerivedReference[]> {
    const selected = new Map<string, AnswerDerivedReference[]>();
    for (const item of evidence) {
        if (
            item.kind !== "derived" ||
            item.reference.state !== "selected" ||
            !item.reference.extension
        )
            continue;
        const references = selected.get(item.reference.viewId) ?? [];
        references.push(item.reference);
        selected.set(item.reference.viewId, references);
    }
    return selected;
}

export function validateDerivedModuleScope(
    input: UnderstandingModuleRequest,
): void {
    const keys = [
        "requestId",
        "corpusId",
        "snapshotId",
        "kind",
        "viewId",
        "revisionId",
        "layoutId",
        "offset",
        "limit",
        "blockId",
        "bodyOffset",
        "citationOffset",
        "citationId",
        "citationBodyOffset",
    ];
    if (
        Object.keys(input).some((key) => !keys.includes(key)) ||
        (!input.viewId &&
            (input.revisionId || input.layoutId || input.blockId)) ||
        (!input.blockId &&
            (input.bodyOffset !== undefined ||
                input.citationOffset !== undefined ||
                input.citationId !== undefined)) ||
        (input.citationBodyOffset !== undefined && !input.citationId)
    )
        throw new Error(
            "Derived module scope requires its exact selected view and block identity",
        );
    for (const value of [
        input.offset,
        input.bodyOffset,
        input.citationOffset,
        input.citationBodyOffset,
    ])
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
            throw new Error("Invalid derived module offset");
    if (
        input.limit !== undefined &&
        (!Number.isSafeInteger(input.limit) ||
            input.limit < 1 ||
            input.limit > 8)
    )
        throw new Error("Derived module block limit must be 1 to 8");
}

export function derivedViewModule(
    view: ViewVersion,
    references: AnswerDerivedReference[],
    input: UnderstandingModuleRequest,
    selectedBlocks?: string[],
): UnderstandingDerivedView {
    if (
        view.content.kind !== "extension" ||
        references.some(
            (reference) => reference.revisionId !== view.revisionId,
        ) ||
        (input.revisionId && input.revisionId !== view.revisionId)
    )
        throw new Error(
            "Derived module revision is outside the selected evidence snapshot",
        );
    const content = view.content;
    const layout = content.presentation.layouts.find(
        (layout) =>
            layout.id ===
            (input.layoutId ?? content.presentation.layouts[0]?.id),
    );
    if (!layout) throw new Error("Unsupported derived view layout");
    const ids = [...new Set(layout.groups.flatMap((group) => group.blockIds))];
    const offset = input.offset ?? 0;
    if (offset > ids.length || (input.blockId && !ids.includes(input.blockId)))
        throw new Error("Derived module block is outside this exact layout");
    const selectedBlockIds = selectedBlocks ?? [
        ...new Set(
            references
                .map((reference) => reference.sectionId)
                .filter((id): id is string => !!id),
        ),
    ];
    const page = input.blockId
        ? [input.blockId]
        : ids.slice(offset, offset + (input.limit ?? 2));
    const blocks = page.map((id) => {
        const section = content.sections.find((section) => section.id === id)!;
        const bodyOffset = input.blockId ? (input.bodyOffset ?? 0) : 0;
        if (bodyOffset > section.body.length)
            throw new Error("Derived block text offset is out of range");
        const body = section.body.slice(bodyOffset, bodyOffset + 1600);
        const binding = content.evidence.find(
            (binding) => binding.blockId === id,
        )!;
        const citations = [
            ...binding.support.map((source, index) => ({
                id: `${id}.support.${index}`,
                role: "support" as const,
                source,
            })),
            ...binding.opposition.map((source, index) => ({
                id: `${id}.opposition.${index}`,
                role: "opposition" as const,
                source,
            })),
        ];
        const citationOffset = input.blockId ? (input.citationOffset ?? 0) : 0;
        if (citationOffset > citations.length)
            throw new Error("Derived citation offset is out of range");
        return {
            id,
            heading: section.heading,
            role: section.role,
            body,
            bodyOffset,
            bodyTotalChars: section.body.length,
            ...(bodyOffset + body.length < section.body.length
                ? { nextBodyOffset: bodyOffset + body.length }
                : {}),
            selectedForAnswer: selectedBlockIds.includes(id),
            citations: citations
                .slice(citationOffset, citationOffset + 8)
                .map(({ source, ...citation }) => {
                    const { excerpt: _excerpt, ...reference } = source;
                    return { ...citation, source: reference };
                }),
            totalCitations: citations.length,
            ...(citationOffset + 8 < citations.length
                ? { nextCitationOffset: citationOffset + 8 }
                : {}),
        };
    });
    const nextOffset = offset + blocks.length;
    return {
        schemaVersion: 1,
        viewId: view.viewId,
        revisionId: view.revisionId,
        provider: content.provider,
        title: content.title,
        selectedBlockIds,
        presentation: {
            ...content.presentation,
            layouts: content.presentation.layouts.map(({ id, label }) => ({
                id,
                label,
            })),
            layout: {
                ...layout,
                groups: layout.groups
                    .map((group) => ({
                        ...group,
                        blockIds: group.blockIds.filter((id) =>
                            page.includes(id),
                        ),
                    }))
                    .filter((group) => group.blockIds.length),
            },
        },
        blocks,
        offset,
        totalBlocks: ids.length,
        ...(!input.blockId && nextOffset < ids.length ? { nextOffset } : {}),
        omittedBlocks: ids.length - blocks.length,
    };
}
