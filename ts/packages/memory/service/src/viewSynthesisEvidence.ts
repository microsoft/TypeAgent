// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewCitation,
    ViewSynthesisOutput,
} from "./viewTypes.js";

export interface ViewPassage extends ViewCitation {
    passageId: string;
}

function paragraphs(content: string) {
    return [...content.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g)].map(
        (match) => ({
            locator: `chars:${match.index}-${match.index! + match[0].length}`,
            excerpt: match[0],
        }),
    );
}
export function retainedPassages(input: ViewBuildSnapshot): ViewPassage[] {
    return input.inputs.flatMap((source, sourceIndex) =>
        (source.passages ?? paragraphs(source.content)).map(
            (passage, index) => ({
                ...passage,
                passageId: `p${sourceIndex}-${index}`,
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                ...(source.evidence ? { evidence: source.evidence } : {}),
            }),
        ),
    );
}
export function labelViewInput(
    input: ViewBuildSnapshot,
    passages: ViewPassage[],
) {
    return {
        ...input,
        ...(input.definition.kind === "timeline"
            ? {
                  definition: {
                      ...input.definition,
                      selector: {
                          kind: "timelineEvidence",
                          sources: input.inputs
                              .filter((source) => !source.evidence)
                              .map(({ sourceId, revisionId }) => ({
                                  sourceId,
                                  revisionId,
                              })),
                          events: input.inputs.flatMap((source) =>
                              source.evidence
                                  ? [{ eventId: source.evidence.eventId }]
                                  : [],
                          ),
                      },
                  },
              }
            : {}),
        inputs: input.inputs.map(({ content: _content, ...source }) => ({
            ...source,
            passages: passages.filter(
                (passage) =>
                    passage.sourceId === source.sourceId &&
                    passage.revisionId === source.revisionId,
            ),
        })),
    };
}

/** Audit references are wire-only: the persisted artifact retains exact citations. */
export function compactSchemaAudit(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
) {
    if (output.content.kind !== "schemaView")
        throw new Error("Citation compaction requires a schema artifact");
    const passages = retainedPassages(input);
    const provenance = (evidence: ViewCitation["evidence"]) =>
        JSON.stringify([evidence?.kind, evidence?.eventId]);
    const key = (citation: ViewCitation) =>
        JSON.stringify([
            citation.sourceId,
            citation.revisionId,
            citation.locator,
            citation.excerpt,
            provenance(citation.evidence),
        ]);
    const retained = new Map(
        passages.map((passage) => [key(passage), passage.passageId]),
    );
    const references = new Map<string, { evidenceId: string }>();
    const evidence: Array<
        { id: string } & ({ passageId: string } | { citation: ViewCitation })
    > = [];
    const reference = (citation: ViewCitation) => {
        const identity = key(citation);
        const prior = references.get(identity);
        if (prior) return prior;
        const source = input.inputs.find(
            (source) =>
                source.sourceId === citation.sourceId &&
                source.revisionId === citation.revisionId,
        );
        const offsets = /^chars:(\d+)-(\d+)$/.exec(citation.locator);
        const start = Number(offsets?.[1]);
        const end = Number(offsets?.[2]);
        if (
            !source ||
            !offsets ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end <= start ||
            end > source.content.length ||
            source.content.slice(start, end) !== citation.excerpt ||
            provenance(source.evidence) !== provenance(citation.evidence)
        )
            throw new Error(
                "Audit citation does not match frozen retained evidence",
            );
        const id = `e${evidence.length}`;
        const passageId = retained.get(identity);
        evidence.push(
            passageId
                ? { id, passageId }
                : { id, citation: structuredClone(citation) },
        );
        const ref = { evidenceId: id };
        references.set(identity, ref);
        return ref;
    };
    const content = {
        ...output.content,
        sections: output.content.sections.map((section) => ({
            ...section,
            details: {
                ...section.details,
                candidates: section.details.candidates.map((candidate) => ({
                    ...candidate,
                    citations: candidate.citations.map(reference),
                    opposingCitations:
                        candidate.opposingCitations.map(reference),
                    support: candidate.support.map((support) => ({
                        ...support,
                        citation: reference(support.citation),
                    })),
                })),
            },
        })),
        citations: output.content.citations.map(reference),
    };
    const relationships = output.relationships.map((relationship) => ({
        ...relationship,
        citations: relationship.citations.map(reference),
    }));
    return {
        input: labelViewInput(input, passages),
        evidence,
        output: {
            content,
            relationships,
            outcome: output.outcome,
            missingEvidence: output.missingEvidence,
        },
    };
}

export function evidenceRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Evidence response must contain an object");
    return value as Record<string, unknown>;
}
export function evidenceArray(value: unknown, limit = 2000): unknown[] {
    if (!Array.isArray(value) || value.length > limit)
        throw new Error("Evidence response requires a bounded array");
    return value;
}
export function evidenceText(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 120000)
        throw new Error("Evidence response requires bounded nonempty text");
    return value;
}
export function evidenceChoice<T extends string>(
    value: unknown,
    choices: readonly T[],
): T {
    const choice = choices.find((entry) => entry === value);
    if (!choice) throw new Error("Unsupported evidence classification");
    return choice;
}
export function resolvePassages(
    value: unknown,
    passages: ViewPassage[],
): ViewPassage[] {
    return evidenceArray(value).map((id) => {
        const passage = passages.find(
            (entry) => entry.passageId === evidenceText(id),
        );
        if (!passage) throw new Error("Unknown retained passage reference");
        return passage;
    });
}
export function exactEvidenceCoverage<T>(
    entries: T[],
    ids: string[],
    key: (entry: T) => string,
    message = "Evidence audit omitted or duplicated required identities",
): void {
    const actual = new Set(entries.map(key));
    if (
        actual.size !== entries.length ||
        actual.size !== ids.length ||
        ids.some((id) => !actual.has(id))
    )
        throw new Error(message);
}
