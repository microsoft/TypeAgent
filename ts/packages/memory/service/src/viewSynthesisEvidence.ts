// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewCitation,
    ViewSynthesisOutput,
} from "./viewTypes.js";
import { viewContextTopics } from "./viewSynthesisSchemas.js";

export interface ViewPassage extends ViewCitation {
    passageId: string;
}

function paragraphPassages(content: string) {
    return [...content.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g)].map(
        (match) => ({
            locator: `chars:${match.index}-${match.index! + match[0].length}`,
            excerpt: match[0],
        }),
    );
}

export function retainedPassages(input: ViewBuildSnapshot): ViewPassage[] {
    return input.inputs.flatMap((source, sourceIndex) =>
        paragraphPassages(source.content).map((passage, index) => ({
            ...passage,
            passageId: `p${sourceIndex}-${index}`,
            sourceId: source.sourceId,
            revisionId: source.revisionId,
        })),
    );
}

export function guidePassages(output: ViewSynthesisOutput) {
    return output.content.sections.flatMap((section, sectionIndex) =>
        paragraphPassages(section.body).map((passage, index) => ({
            ...passage,
            guidePassageId: `g${sectionIndex}-${index}`,
            sectionId: section.id,
        })),
    );
}

export function labelViewInput(
    input: ViewBuildSnapshot,
    passages: ViewPassage[],
) {
    return {
        ...input,
        inputs: input.inputs.map((source) => ({
            ...source,
            passages: passages.filter(
                (passage) =>
                    passage.sourceId === source.sourceId &&
                    passage.revisionId === source.revisionId,
            ),
        })),
    };
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Evidence response must contain an object");
    return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value))
        throw new Error("Evidence response must contain an array");
    return value;
}

function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim())
        throw new Error("Evidence response must contain nonempty text");
    return value;
}

function passageById(value: unknown, passages: ViewPassage[]): ViewPassage {
    const id = text(value);
    const passage = passages.find((entry) => entry.passageId === id);
    if (!passage) throw new Error(`Unknown retained passage reference: ${id}`);
    return passage;
}

function resolveReferences(
    value: unknown,
    passages: ViewPassage[],
): ViewCitation[] {
    return array(value).map((entry) => {
        const reference = record(entry);
        if (Object.keys(reference).some((key) => key !== "passageId"))
            throw new Error("Only retained passage references are accepted");
        const passage = passageById(reference.passageId, passages);
        return {
            sourceId: passage.sourceId,
            revisionId: passage.revisionId,
            locator: passage.locator,
            excerpt: passage.excerpt,
        };
    });
}

export function hydrateConstruction(
    input: ViewBuildSnapshot,
    value: unknown,
    passages: ViewPassage[],
): unknown {
    const raw = record(value);
    const content = record(raw.content);
    return {
        ...raw,
        content: {
            ...content,
            citations: resolveReferences(content.citations, passages),
        },
        relationships: array(raw.relationships).map((value) => {
            const edge = record(value);
            if (
                Object.keys(edge).some(
                    (key) => !["id", "sectionId", "citations"].includes(key),
                )
            )
                throw new Error("Unsupported construction relationship field");
            const citations = resolveReferences(edge.citations, passages);
            const source = citations[0];
            if (
                !source ||
                citations.some(
                    (citation) =>
                        citation.sourceId !== source.sourceId ||
                        citation.revisionId !== source.revisionId,
                )
            )
                throw new Error(
                    "Each supportedBy relationship must cite one exact retained source revision",
                );
            return {
                id: text(edge.id),
                predicate: "supportedBy",
                from: {
                    kind: "section",
                    viewId: input.definition.viewId,
                    sectionId: text(edge.sectionId),
                },
                to: {
                    kind: "source",
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                },
                citations,
            };
        }),
    };
}

function exactCoverage(
    entries: unknown[],
    key: string,
    expected: string[],
): Record<string, unknown>[] {
    const records = entries.map(record);
    const ids = new Set(records.map((entry) => text(entry[key])));
    if (
        ids.size !== records.length ||
        ids.size !== expected.length ||
        expected.some((id) => !ids.has(id))
    )
        throw new Error(`Evidence audit did not inspect every exact ${key}`);
    return records;
}

function inspectedSections(
    value: unknown,
    output: ViewSynthesisOutput,
): string[] {
    const ids = array(value).map(text);
    if (
        !ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some(
            (id) => !output.content.sections.some((entry) => entry.id === id),
        )
    )
        throw new Error(
            "Evidence audit references missing or duplicate guide sections",
        );
    return ids;
}

function inspectedGuideText(
    value: unknown,
    sectionIds: string[],
    output: ViewSynthesisOutput,
): string {
    const ids = array(value).map(text);
    const passages = guidePassages(output);
    if (!ids.length || new Set(ids).size !== ids.length)
        throw new Error(
            "Positive coverage requires exact unique guide passage references",
        );
    return ids
        .map((id) => {
            const passage = passages.find(
                (entry) => entry.guidePassageId === id,
            );
            if (!passage || !sectionIds.includes(passage.sectionId))
                throw new Error(
                    "Evidence audit guide passage does not belong to its claimed sections",
                );
            return passage.excerpt;
        })
        .join("\n");
}

function validateQuantitativeCoverage(claim: string, guide: string): void {
    const expected = claim.match(/\d+(?:\.\d+)?/g) ?? [];
    const actual = new Set(guide.match(/\d+(?:\.\d+)?/g) ?? []);
    if (expected.some((number) => !actual.has(number)))
        throw new Error(
            `Required quantitative finding is absent from cited guide prose: ${claim}`,
        );
}

function validateSourceCheck(
    check: Record<string, unknown>,
    output: ViewSynthesisOutput,
    passages: ViewPassage[],
): void {
    text(check.reason);
    for (const value of array(check.requiredFindings)) {
        const finding = record(value);
        const passage = passageById(finding.passageId, passages);
        if (passage.sourceId !== check.sourceId)
            throw new Error(
                "Evidence audit finding references a different source",
            );
        const claim = text(finding.claim);
        if (finding.covered !== true)
            throw new Error(`Missing required source context: ${claim}`);
        const sections = inspectedSections(finding.sectionIds, output);
        const guide = inspectedGuideText(
            finding.guidePassageIds,
            sections,
            output,
        );
        validateQuantitativeCoverage(claim, guide);
    }
}

export function validateAuditedContext(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
    value: unknown,
    passages: ViewPassage[],
): void {
    const review = record(value);
    const sources = exactCoverage(
        array(review.sourceChecks),
        "sourceId",
        input.inputs.map((source) => source.sourceId),
    );
    for (const check of sources) validateSourceCheck(check, output, passages);
    const contexts = exactCoverage(array(review.contextChecks), "topic", [
        ...viewContextTopics,
    ]);
    for (const check of contexts) {
        const reason = text(check.reason);
        if (check.supported !== true)
            throw new Error(
                `Missing required ${text(check.topic)} context: ${reason}`,
            );
        resolveReferences(check.citations, passages);
        const sections = inspectedSections(check.sectionIds, output);
        inspectedGuideText(check.guidePassageIds, sections, output);
    }
}
