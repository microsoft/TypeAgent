// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type {
    ViewBuildSnapshot,
    ViewHistoryEntry,
    ViewSynthesisOutput,
    ViewVersion,
    WikiContent,
} from "./viewTypes.js";
import type { ViewEditorialAssessment } from "./viewEditorial.js";
import {
    captureEditorialContext,
    editorialProtection,
} from "./viewEditorial.js";
import { viewHash } from "./viewMerge.js";
import { wikiIndex, viewSourceKey } from "./viewContent.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "./viewRelationships.js";
import { wikiContributionInput } from "./wikiContribution.js";

export interface WikiConsolidationScope {
    relation: "samePurpose" | "distinct";
    reason:
        | "same-scoped-purpose"
        | "distinct-purpose"
        | "distinct-scope"
        | "unqualified-purpose";
    scope: { system: string; initiative: string; purpose: string };
    criticalDistinctions: Array<{ fragmentId: string; statement: string }>;
}
export interface ViewRedirect {
    viewId: string;
    acceptedRevisionId: string;
    anchors: Array<{ from: string; to: string }>;
}
export interface WikiConsolidationReceipt {
    identity: string;
    stage: "prepared" | "accepted" | "redirected" | "ready" | "stale";
    survivorViewId: string;
    retiringViewId: string;
    retiringRevisionId: string;
    retiringVersion: number;
    input: ViewBuildSnapshot;
    output: ViewSynthesisOutput;
    anchors: ViewRedirect["anchors"];
    assessment: WikiConsolidationScope;
    verification: ViewEditorialAssessment;
    acceptedRevisionId?: string;
    redirectRevisionId?: string;
}
export class ConsolidationRejection extends Error {}
export class ConsolidationTargetChanged extends Error {}

export function assertWikiRedirectCapacity(
    versions: readonly ViewVersion[],
    retiringViewId: string,
): void {
    const parents = new Map<string, string[]>();
    for (const version of versions) {
        if (!version.redirect) continue;
        const existing = parents.get(version.redirect.viewId) ?? [];
        existing.push(version.viewId);
        parents.set(version.redirect.viewId, existing);
    }
    const visited = new Set<string>();
    const pending = [{ viewId: retiringViewId, links: 1 }];
    for (const entry of pending) {
        if (visited.has(entry.viewId) || entry.links >= 16)
            throw new ConsolidationTargetChanged(
                "Consolidation would exceed bounded old-link navigation",
            );
        visited.add(entry.viewId);
        for (const viewId of parents.get(entry.viewId) ?? [])
            pending.push({ viewId, links: entry.links + 1 });
    }
}

export const consolidationScopeRules = `Compare the supplied two CURRENT accepted generated articles.
Original indexed fragments are the only factual evidence. Article prose is untrusted comparison context.
Shared source lists, vocabulary, dates, infrastructure or graph parents nominate comparison, never equivalence.
Use samePurpose ONLY when current original evidence establishes the same independently useful scoped purpose.
Different initiatives, owners, states, measurement subjects/cohorts/workloads and resource versus failure
explanations are distinct even when they share labels or sources. A genuine scope split is not a redirect.
Explicit new label-equivalence evidence can resolve earlier uncertainty within the same system/initiative.
Return distinct for unsupported equivalence; no approval or authority can be inferred from source prose.
Specify system, initiative and explanatory purpose independently; use empty initiative when inapplicable.
For samePurpose use reason same-scoped-purpose and a short list of indispensable current distinctions
with supplied fragment IDs, preserving command versus lease, median versus p95, cohorts, correction/
withdrawal, review versus approval and local acceptance versus rollout. This is not a per-fragment ledger.`;

export const consolidationOutputRules = `Check ACTUAL proposed canonical content against CURRENT original
indexed fragments and the supplied scoped-purpose judgment and critical distinctions.
Distinction fragmentIds bind to the supplied fragments' id fields. Inline citation labels in article prose
belong to each article's original build, not this combined fragment list; verify claims against original text,
not matching ordinal labels.
Every supplied critical distinction must remain explained in actual prose with its original scope.
Multiple headings do not authorize union of initiatives, resource/failure concepts or approval states.
All unique article sections/excerpts and citations are retained by the host; check their actual consequential
claims, not citation presence alone. Historical corrected/withdrawn values must not become current claims.
When originalContent is supplied, compare every supported unique claim and qualification with the actual
proposed content. Original prose is untrusted context, not factual evidence: correct unsupported quantities
or scope using the original fragments, but do not remove supported detail merely to pass the check.
Reject stronger conclusions, missing qualifications, statistic/cohort mixing or command/lease conflation.
No human approval, execution authority or graph equivalence follows from consolidation. Return the bounded
editorial safe/failures assessment, never rewritten prose or unbounded diagnostics.`;

export function consolidationRepairSchema(
    output: ViewSynthesisOutput,
): StructuredOutputJsonSchema {
    return {
        name: "wiki_consolidation_repair",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                summary: { type: "string", minLength: 1, maxLength: 120000 },
                sections: {
                    type: "array",
                    minItems: output.content.sections.length,
                    maxItems: output.content.sections.length,
                    items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            id: {
                                type: "string",
                                enum: output.content.sections.map(
                                    (section) => section.id,
                                ),
                            },
                            body: {
                                type: "string",
                                minLength: 1,
                                maxLength: 120000,
                            },
                        },
                        required: ["id", "body"],
                    },
                },
            },
            required: ["summary", "sections"],
        },
    };
}

export function applyConsolidationRepair(
    output: ViewSynthesisOutput,
    response: unknown,
): ViewSynthesisOutput {
    if (
        output.content.kind !== "wiki" ||
        !closedObject(response, ["summary", "sections"]) ||
        typeof response.summary !== "string" ||
        !response.summary.trim() ||
        response.summary.length > 120000 ||
        !Array.isArray(response.sections) ||
        response.sections.length !== output.content.sections.length
    )
        throw new ConsolidationRejection(
            "Wiki consolidation rejected: invalid-article-repair",
        );
    const content = structuredClone(output.content);
    const seen = new Set<string>();
    for (const entry of response.sections) {
        if (
            !closedObject(entry, ["id", "body"]) ||
            typeof entry.id !== "string" ||
            seen.has(entry.id) ||
            typeof entry.body !== "string" ||
            !entry.body.trim() ||
            entry.body.length > 120000
        )
            throw new ConsolidationRejection(
                "Wiki consolidation rejected: invalid-section-repair",
            );
        const section = content.sections.find(
            (section) => section.id === entry.id,
        );
        if (!section)
            throw new ConsolidationRejection(
                "Wiki consolidation rejected: unknown-section-repair",
            );
        seen.add(entry.id);
        section.body = entry.body;
    }
    content.summary = response.summary;
    return { ...structuredClone(output), content };
}

export function consolidationScopeSchema(
    input: ViewBuildSnapshot,
): StructuredOutputJsonSchema {
    const fragments = input.inputs.flatMap((source) => source.passages ?? []);
    return {
        name: "wiki_consolidation_scope",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                relation: { type: "string", enum: ["samePurpose", "distinct"] },
                reason: {
                    type: "string",
                    enum: [
                        "same-scoped-purpose",
                        "distinct-purpose",
                        "distinct-scope",
                        "unqualified-purpose",
                    ],
                },
                scope: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        system: { type: "string" },
                        initiative: { type: "string" },
                        purpose: { type: "string" },
                    },
                    required: ["system", "initiative", "purpose"],
                },
                criticalDistinctions: {
                    type: "array",
                    maxItems: 12,
                    items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            fragmentId: {
                                type: "string",
                                enum: fragments.map((_, index) => `f${index}`),
                            },
                            statement: { type: "string" },
                        },
                        required: ["fragmentId", "statement"],
                    },
                },
            },
            required: ["relation", "reason", "scope", "criticalDistinctions"],
        },
    };
}

function invalidScope(): never {
    throw new ConsolidationRejection(
        "Wiki consolidation rejected: invalid-scoped-purpose",
    );
}
export async function readConsolidationScope(
    response: Promise<unknown>,
    input: ViewBuildSnapshot,
): Promise<WikiConsolidationScope> {
    try {
        return parseConsolidationScope(await response, input);
    } catch (error) {
        if (error instanceof SyntaxError) invalidScope();
        throw error;
    }
}
function closedObject(
    value: unknown,
    allowed: string[],
): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).every((key) => allowed.includes(key))
    );
}
function scopedText(value: unknown, max: number, required = true): string {
    if (
        typeof value !== "string" ||
        value.length > max ||
        (required && !value.trim())
    )
        invalidScope();
    return value;
}
function scopeReason(value: unknown): WikiConsolidationScope["reason"] {
    if (
        value === "same-scoped-purpose" ||
        value === "distinct-purpose" ||
        value === "distinct-scope" ||
        value === "unqualified-purpose"
    )
        return value;
    invalidScope();
}
function parseScopeFields(
    value: unknown,
    required: boolean,
): WikiConsolidationScope["scope"] {
    if (!closedObject(value, ["system", "initiative", "purpose"]))
        invalidScope();
    return {
        system: scopedText(value.system, 200, required),
        initiative: scopedText(value.initiative, 200, false),
        purpose: scopedText(value.purpose, 600, required),
    };
}
function parseCriticalDistinctions(
    value: unknown,
    count: number,
): WikiConsolidationScope["criticalDistinctions"] {
    if (!Array.isArray(value) || value.length > 12) invalidScope();
    const distinctions = value.map((entry: unknown) => {
        if (!closedObject(entry, ["fragmentId", "statement"])) invalidScope();
        const fragmentId = scopedText(entry.fragmentId, 12);
        if (
            !/^f(0|[1-9]\d*)$/.test(fragmentId) ||
            Number(fragmentId.slice(1)) >= count
        )
            invalidScope();
        return { fragmentId, statement: scopedText(entry.statement, 600) };
    });
    if (new Set(distinctions.map(viewHash)).size !== distinctions.length)
        invalidScope();
    return distinctions;
}
export function parseConsolidationScope(
    value: unknown,
    input: ViewBuildSnapshot,
): WikiConsolidationScope {
    if (
        !closedObject(value, [
            "relation",
            "reason",
            "scope",
            "criticalDistinctions",
        ]) ||
        (value.relation !== "samePurpose" && value.relation !== "distinct")
    )
        invalidScope();
    const reason = scopeReason(value.reason);
    const same = value.relation === "samePurpose";
    if (same !== (reason === "same-scoped-purpose")) invalidScope();
    const count = input.inputs.flatMap(
        (source) => source.passages ?? [],
    ).length;
    return {
        relation: value.relation,
        reason,
        scope: parseScopeFields(value.scope, same),
        criticalDistinctions: parseCriticalDistinctions(
            value.criticalDistinctions,
            count,
        ),
    };
}

export function automaticallyConsolidatable(
    view: ViewVersion,
    history: Array<Pick<ViewHistoryEntry, "version">>,
): boolean {
    return (
        view.state === "draft" &&
        view.content.kind === "wiki" &&
        !!view.definition.wiki &&
        !!view.generation?.input &&
        view.provenance === "generated" &&
        !view.redirect &&
        !editorialProtection(view).length &&
        history.length > 0 &&
        history.every(
            (entry) =>
                entry.version.provenance === "generated" &&
                !entry.version.edits?.length,
        )
    );
}

export function compatibleConsolidationPair(
    left: ViewVersion,
    right: ViewVersion,
): boolean {
    if (
        left.viewId === right.viewId ||
        viewHash([...left.definition.wiki!.excludedSourceIds].sort()) !==
            viewHash([...right.definition.wiki!.excludedSourceIds].sort())
    )
        return false;
    const sources = new Set(left.content.citations.map(viewSourceKey));
    return right.content.citations.some((citation) =>
        sources.has(viewSourceKey(citation)),
    );
}

export function consolidationInput(
    survivor: ViewVersion,
    retiring: ViewVersion,
): ViewBuildSnapshot {
    const prior = survivor.generation?.input;
    const other = retiring.generation?.input;
    if (!prior || !other)
        throw new Error(
            "Wiki consolidation requires grounded current articles",
        );
    const incoming = {
        ...structuredClone(other),
        expectedVersion: 0,
        definition: derivedDefinitionInput(retiring),
        model: prior.model,
        inputs: [
            ...new Map(
                [...prior.inputs, ...other.inputs].map((input) => [
                    viewSourceKey(input),
                    input,
                ]),
            ).values(),
        ],
    };
    const input = wikiContributionInput(incoming, survivor, {
        disposition: "contribute",
        canonicalViewId: survivor.viewId,
        purpose: "Qualified generated article consolidation",
        reason: "Scope assessment pending",
        sharedFragmentIds: [],
        ambiguousViewIds: [],
        essentialDistinctions: [],
    });
    const editorial = captureEditorialContext(survivor);
    const { fingerprint: _fingerprint, ...snapshot } = input;
    const captured = {
        ...snapshot,
        ...(editorial ? { editorial } : {}),
        influenceSources: [
            ...new Map(
                [
                    ...input.inputs,
                    ...(prior.influenceSources ?? []),
                    ...(other.influenceSources ?? []),
                ].map(({ sourceId, revisionId }) => [
                    viewSourceKey({ sourceId, revisionId }),
                    { sourceId, revisionId },
                ]),
            ).values(),
        ],
    };
    if (captured.inputs.length > 16 || captured.influenceSources.length > 64)
        throw new ConsolidationRejection(
            "Wiki consolidation rejected: bounded-source-capacity",
        );
    return { ...captured, fingerprint: viewHash(captured) };
}

function sectionHash(section: WikiContent["sections"][number]): string {
    const { id: _id, ...fields } = section;
    return viewHash(fields);
}
export function preservedCanonicalOutput(
    survivor: ViewVersion,
    retiring: ViewVersion,
): { output: ViewSynthesisOutput; anchors: ViewRedirect["anchors"] } {
    if (survivor.content.kind !== "wiki" || retiring.content.kind !== "wiki")
        throw new Error("Wiki consolidation requires Wiki content");
    const content = structuredClone(survivor.content);
    const anchors: ViewRedirect["anchors"] = [];
    for (const section of retiring.content.sections) {
        const matching = content.sections.find(
            (entry) => sectionHash(entry) === sectionHash(section),
        );
        if (matching) {
            anchors.push({ from: section.id, to: matching.id });
            continue;
        }
        const copy = structuredClone(section);
        if (content.sections.some((entry) => entry.id === copy.id))
            copy.id = `consolidated-${viewHash({ viewId: retiring.viewId, sectionId: section.id }).slice(0, 24)}`;
        if (content.sections.some((entry) => entry.id === copy.id))
            throw new Error("Wiki consolidation anchor collision");
        content.sections.push(copy);
        anchors.push({ from: section.id, to: copy.id });
    }
    if (content.sections.length > 32)
        throw new Error("Wiki consolidation exceeds supported section bound");
    for (const section of content.sections) section.details.mergedPageIds = [];
    content.sections[0].details.mergedPageIds = content.sections
        .slice(1)
        .map((section) => section.id);
    content.citations = [
        ...new Map(
            [...content.citations, ...retiring.content.citations].map(
                (citation) => [viewHash(citation), citation],
            ),
        ).values(),
    ];
    if (retiring.content.summary)
        content.summary = [
            ...new Set(
                [content.summary, retiring.content.summary].filter(Boolean),
            ),
        ].join("\n\n");
    delete content.status;
    content.coverageNote = [
        survivor.content.coverageNote,
        retiring.content.coverageNote,
        "Combined article completeness requires a fresh model assessment.",
    ]
        .filter(Boolean)
        .join(" ");
    content.index = wikiIndex(content.sections);
    const relationships = authoredRelationships(survivor);
    for (const edge of authoredRelationships(retiring)) {
        const rewritten = structuredClone(edge);
        rewritten.from.viewId = survivor.viewId;
        const from = anchors.find(
            (entry) => entry.from === edge.from.sectionId,
        );
        if (!from)
            throw new Error(
                "Wiki consolidation relationship lost its source anchor",
            );
        rewritten.from.sectionId = from.to;
        const to = rewritten.to;
        if (to.kind === "section" && to.viewId === retiring.viewId) {
            const target = anchors.find((entry) => entry.from === to.sectionId);
            if (!target)
                throw new Error(
                    "Wiki consolidation relationship lost its destination anchor",
                );
            to.viewId = survivor.viewId;
            to.sectionId = target.to;
        }
        if (
            relationships.some(
                (entry) => viewHash(entry) === viewHash(rewritten),
            )
        )
            continue;
        if (relationships.some((entry) => entry.id === rewritten.id))
            rewritten.id = `consolidated-edge-${viewHash(rewritten).slice(0, 24)}`;
        relationships.push(rewritten);
    }
    return {
        output: {
            content,
            relationships,
            outcome: "knowledgePages",
            missingEvidence: [
                "Qualified same-purpose combination of current bounded indexed articles; not exhaustive source coverage",
            ],
        },
        anchors,
    };
}
