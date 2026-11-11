// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewVersion,
    WikiSubjectAssessment,
} from "./viewTypes.js";
import { contributingSources } from "./wikiAdmission.js";
import { viewSourceKey } from "./viewContent.js";
import { viewHash } from "./viewMerge.js";
import { derivedDefinitionInput } from "./viewRelationships.js";

export class WikiContributionCapacityError extends Error {}

export function wikiContributionTargets(
    results: ViewBuildTargetResult[],
    primary: ViewBuildTargetResult,
    contribution: {
        input: ViewBuildSnapshot;
        verification: WikiSubjectAssessment;
    },
    conflicted: boolean,
): ViewBuildTargetResult[] {
    const members = contribution.input.wikiContribution?.members;
    if (!members) {
        assertWikiContribution(primary, contribution, conflicted);
        return [primary];
    }
    if (
        members.length < 2 ||
        members.length > 4 ||
        members[0].candidateViewId !== primary.viewId ||
        new Set(members.map((member) => member.candidateViewId)).size !==
            members.length
    )
        throw new Error("Invalid grouped Wiki contribution membership");
    return members.map((member) => {
        const target = results.find(
            (result) => result.viewId === member.candidateViewId,
        );
        if (!target)
            throw new Error("Grouped Wiki contribution target missing");
        assertWikiContribution(target, contribution, conflicted);
        return target;
    });
}

export function canonicalizeWikiEvidence(
    input: ViewBuildSnapshot,
): ViewBuildSnapshot {
    const previous = input.inputs.flatMap((source) => source.passages ?? []);
    const compare = (left: string, right: string) =>
        left < right ? -1 : left > right ? 1 : 0;
    const inputs = input.inputs
        .map((source) => {
            if (!source.passages?.length)
                throw new Error(
                    "Canonical Wiki evidence requires indexed passages for every source",
                );
            const passages = [...source.passages].sort(
                (left, right) =>
                    compare(left.locator, right.locator) ||
                    compare(left.excerpt, right.excerpt),
            );
            return {
                ...source,
                passages,
                content: passages
                    .map((passage) => passage.excerpt)
                    .join("\n\n"),
            };
        })
        .sort((left, right) =>
            compare(viewSourceKey(left), viewSourceKey(right)),
        );
    const fragments = inputs.flatMap((source) => source.passages);
    const wikiContribution = input.wikiContribution
        ? {
              ...input.wikiContribution,
              essentialDistinctions:
                  input.wikiContribution.essentialDistinctions.map(
                      (distinction) => {
                          const old =
                              previous[Number(distinction.fragmentId.slice(1))];
                          const index = old
                              ? fragments.findIndex(
                                    (fragment) =>
                                        viewHash(fragment) === viewHash(old),
                                )
                              : -1;
                          if (index < 0)
                              throw new Error(
                                  "Canonical Wiki ordering lost a required fragment",
                              );
                          return { ...distinction, fragmentId: `f${index}` };
                      },
                  ),
          }
        : undefined;
    const { fingerprint: _fingerprint, ...snapshot } = input;
    const normalized = {
        ...snapshot,
        inputs,
        definition: {
            ...input.definition,
            selector: {
                ...input.definition.selector,
                sources: [...input.definition.selector.sources].sort(
                    (left, right) =>
                        compare(viewSourceKey(left), viewSourceKey(right)),
                ),
            },
        },
        ...(wikiContribution
            ? { selectionFingerprint: viewHash(fragments) }
            : {}),
        ...(wikiContribution ? { wikiContribution } : {}),
    };
    return { ...normalized, fingerprint: viewHash(normalized) };
}

export function assertWikiContribution(
    result: ViewBuildTargetResult,
    contribution: {
        input: ViewBuildSnapshot;
        verification: WikiSubjectAssessment;
    },
    conflicted: boolean,
): void {
    const input = contribution.input;
    const member = input.wikiContribution?.members?.find(
        (entry) => entry.candidateViewId === result.viewId,
    );
    const { canonicalRevisionId, ...assessment } = result.wikiAssessment ?? {};
    const membership = input.wikiContribution?.members
        ? member?.inputFingerprint === viewHash(result.snapshot) &&
          member.assessmentFingerprint === viewHash(assessment) &&
          member.assessmentKey === result.wikiAssessmentKey &&
          canonicalRevisionId === input.targetRevisionId
        : input.wikiContribution?.candidateViewId === result.viewId;
    if (member) assertWikiContributionMemberEvidence(result, input);
    if (
        result.snapshot.pipeline !== "informational-wiki-v1" ||
        result.snapshot.expectedVersion !== 0 ||
        input.pipeline !== "informational-wiki-v1" ||
        input.expectedVersion < 1 ||
        input.model !== result.snapshot.model ||
        !membership ||
        result.wikiAssessment?.disposition !== "contribute" ||
        result.wikiAssessment.canonicalViewId !== input.definition.viewId ||
        contribution.verification.canonicalViewId !== input.definition.viewId ||
        (!conflicted && contribution.verification.disposition !== "covered")
    )
        throw new Error(
            "Wiki contribution cannot materialize or bind an unsupported candidate/canonical assessment",
        );
}

function assertWikiContributionMemberEvidence(
    result: ViewBuildTargetResult,
    input: ViewBuildSnapshot,
): void {
    const original = result.snapshot.inputs.flatMap(
        (source) => source.passages ?? [],
    );
    const combined = input.inputs.flatMap((source) => source.passages ?? []);
    if (
        original.some(
            (fragment) =>
                !combined.some(
                    (entry) => viewHash(entry) === viewHash(fragment),
                ),
        )
    )
        throw new Error("Grouped Wiki contribution omitted member evidence");
    for (const requirement of result.wikiAssessment?.essentialDistinctions ??
        []) {
        const fragment = original[Number(requirement.fragmentId.slice(1))];
        const position = combined.findIndex(
            (entry) => viewHash(entry) === viewHash(fragment),
        );
        if (
            !fragment ||
            position < 0 ||
            !input.wikiContribution?.essentialDistinctions.some(
                (entry) =>
                    entry.fragmentId === `f${position}` &&
                    entry.statement === requirement.statement &&
                    entry.canonicalExcerpt === requirement.canonicalExcerpt,
            )
        )
            throw new Error(
                "Grouped Wiki contribution omitted a member distinction",
            );
    }
}

export function wikiContributionInput(
    incoming: ViewBuildSnapshot,
    canonical: ViewVersion,
    assessment: WikiSubjectAssessment,
): ViewBuildSnapshot {
    const prior = canonical.generation?.input;
    if (
        !prior ||
        !canonical.definition.wiki ||
        !incoming.definition.wiki ||
        incoming.corpusId !== canonical.corpusId ||
        incoming.expectedVersion !== 0 ||
        assessment.disposition !== "contribute" ||
        assessment.canonicalViewId !== canonical.viewId
    )
        throw new Error(
            "Wiki contribution requires a new candidate and a grounded canonical page",
        );
    const fragments = [
        ...canonical.content.citations,
        ...incoming.inputs.flatMap((source) => source.passages ?? []),
    ];
    const passages = [
        ...new Map(
            fragments.map((fragment) => [viewHash(fragment), fragment]),
        ).values(),
    ];
    const sources = contributingSources(passages);
    if (
        !sources.length ||
        sources.some((source) =>
            canonical.definition.wiki!.excludedSourceIds.includes(
                source.sourceId,
            ),
        ) ||
        new Set(sources.map((source) => source.sourceId)).size !==
            sources.length
    )
        throw new Error(
            "Wiki contribution evidence is empty, excluded or mixes revisions of a source",
        );
    // Union of two existing bounded indexed reads, never a full-source read or a provider quota.
    if (
        passages.length > 24 ||
        passages.some((fragment) => fragment.excerpt.length > 2000) ||
        passages.reduce(
            (total, fragment) => total + fragment.excerpt.length,
            0,
        ) > 48000
    )
        throw new WikiContributionCapacityError(
            "Wiki contribution exceeds the union of two bounded indexed evidence sets",
        );
    const inputs = sources.map((source) => {
        const retained = [...incoming.inputs, ...prior.inputs].find(
            (input) => viewSourceKey(input) === viewSourceKey(source),
        );
        if (!retained)
            throw new Error(
                "Canonical citation lacks frozen indexed source metadata",
            );
        const selected = passages.filter(
            (fragment) => viewSourceKey(fragment) === viewSourceKey(source),
        );
        return {
            ...structuredClone(retained),
            passages: structuredClone(selected),
            content: selected.map((fragment) => fragment.excerpt).join("\n\n"),
        };
    });
    const incomingFragments = incoming.inputs.flatMap(
        (source) => source.passages ?? [],
    );
    const combinedFragments = inputs.flatMap((source) => source.passages ?? []);
    const essentialDistinctions = assessment.essentialDistinctions.map(
        (distinction) => {
            const fragment =
                incomingFragments[Number(distinction.fragmentId.slice(1))];
            const position = combinedFragments.findIndex(
                (entry) => viewHash(entry) === viewHash(fragment),
            );
            if (!fragment || position < 0)
                throw new Error(
                    "Wiki contribution lost a required indexed distinction",
                );
            return { ...distinction, fragmentId: `f${position}` };
        },
    );
    const definition = structuredClone(derivedDefinitionInput(canonical));
    const wiki = definition.wiki!;
    const query = incoming.definition.wiki!.query;
    const aliases = [
        ...new Set([
            ...wiki.aliases,
            query,
            ...incoming.definition.wiki!.aliases,
        ]),
    ].filter((alias) => alias !== wiki.query);
    if (aliases.length > 7)
        throw new WikiContributionCapacityError(
            "Wiki contribution needs retrieval alias capacity; existing aliases cannot be discarded",
        );
    wiki.aliases = aliases;
    definition.selector = { kind: "sources", sources };
    const snapshot: Omit<ViewBuildSnapshot, "fingerprint"> = {
        corpusId: incoming.corpusId,
        actor: incoming.actor,
        definition,
        definitionRevisionId: canonical.definition.revisionId,
        targetRevisionId: canonical.revisionId,
        expectedVersion: canonical.version,
        bounds: incoming.bounds,
        inputs,
        influenceSources: [
            ...(prior.influenceSources ?? []),
            ...(incoming.influenceSources ?? []),
        ],
        pipeline: "informational-wiki-v1",
        model: incoming.model,
        selectionFingerprint: viewHash(passages),
        wikiContribution: {
            candidateViewId: incoming.definition.viewId,
            query,
            purpose: assessment.purpose,
            essentialDistinctions,
            priorProse: canonical.content.sections
                .map((section) => section.body)
                .join("\n\n"),
        },
    };
    return { ...snapshot, fingerprint: viewHash(snapshot) };
}

export function wikiContributionGroupInput(
    candidates: Array<{
        input: ViewBuildSnapshot;
        assessment: WikiSubjectAssessment;
        assessmentKey: string;
    }>,
    canonical: ViewVersion,
): ViewBuildSnapshot {
    if (
        candidates.length < 2 ||
        candidates.length > 4 ||
        new Set(candidates.map(({ input }) => input.definition.viewId)).size !==
            candidates.length
    )
        throw new Error(
            "A Wiki contribution group requires two to four candidates",
        );
    const first = candidates[0];
    let input = wikiContributionInput(first.input, canonical, first.assessment);
    for (const candidate of candidates.slice(1)) {
        if (
            candidate.input.model !== first.input.model ||
            candidate.input.actor !== first.input.actor ||
            viewHash(candidate.input.bounds) !== viewHash(first.input.bounds) ||
            viewHash(candidate.input.publicationPolicy) !==
                viewHash(first.input.publicationPolicy)
        )
            throw new Error("Grouped Wiki contribution policies differ");
        const prior = input.inputs.flatMap((source) => source.passages ?? []);
        const seeded = structuredClone(canonical);
        seeded.definition = {
            ...input.definition,
            revisionId: canonical.definition.revisionId,
        };
        seeded.generation!.input = input;
        seeded.content.citations = prior;
        const next = wikiContributionInput(
            candidate.input,
            seeded,
            candidate.assessment,
        );
        const fragments = next.inputs.flatMap(
            (source) => source.passages ?? [],
        );
        const retained = input.wikiContribution!.essentialDistinctions.map(
            (requirement) => {
                const fragment = prior[Number(requirement.fragmentId.slice(1))];
                const index = fragments.findIndex(
                    (entry) => viewHash(entry) === viewHash(fragment),
                );
                if (!fragment || index < 0)
                    throw new Error(
                        "Grouped Wiki contribution lost a required fragment",
                    );
                return { ...requirement, fragmentId: `f${index}` };
            },
        );
        next.wikiContribution!.essentialDistinctions.unshift(...retained);
        input = next;
    }
    input.wikiContribution!.candidateViewId = first.input.definition.viewId;
    input.wikiContribution!.query = first.input.definition.wiki!.query;
    input.wikiContribution!.purpose = candidates
        .map(({ assessment }) => assessment.purpose)
        .join("\n");
    input.wikiContribution!.members = candidates.map((candidate) => ({
        candidateViewId: candidate.input.definition.viewId,
        inputFingerprint: viewHash(candidate.input),
        assessmentFingerprint: viewHash(candidate.assessment),
        assessmentKey: candidate.assessmentKey,
    }));
    const { fingerprint: _fingerprint, ...snapshot } = input;
    return { ...snapshot, fingerprint: viewHash(snapshot) };
}

export function refreshWikiContributionInput(
    input: ViewBuildSnapshot,
    current: ViewVersion | undefined,
    eligible: ReadonlySet<string>,
): ViewBuildSnapshot {
    const prior = current?.generation?.input;
    if (
        !current ||
        !prior?.wikiContribution ||
        current.definition.wiki?.query !== prior.definition.wiki?.query
    )
        return input;
    const preserved = current.content.citations.filter(
        (citation) =>
            eligible.has(viewSourceKey(citation)) &&
            !input.definition.wiki!.excludedSourceIds.includes(
                citation.sourceId,
            ),
    );
    const seeded = structuredClone(current);
    seeded.content.citations = preserved;
    const incoming = { ...input, expectedVersion: 0 };
    const requirements = prior.wikiContribution.essentialDistinctions;
    const union = wikiContributionInput(incoming, seeded, {
        disposition: "contribute",
        canonicalViewId: current.viewId,
        purpose: prior.wikiContribution.purpose,
        reason: "Retain canonical contribution during refresh",
        sharedFragmentIds: [],
        ambiguousViewIds: [],
        essentialDistinctions: [],
    });
    const previousFragments = prior.inputs.flatMap(
        (source) => source.passages ?? [],
    );
    const fragments = union.inputs.flatMap((source) => source.passages ?? []);
    const retainedRequirements = requirements.flatMap((requirement) => {
        const old = previousFragments[Number(requirement.fragmentId.slice(1))];
        const position = fragments.findIndex(
            (fragment) => viewHash(fragment) === viewHash(old),
        );
        return old && position >= 0
            ? [{ ...requirement, fragmentId: `f${position}` }]
            : [];
    });
    const { fingerprint: _fingerprint, ...snapshot } = input;
    const refreshed = {
        ...snapshot,
        inputs: union.inputs,
        definition: {
            ...input.definition,
            selector: union.definition.selector,
        },
        selectionFingerprint: viewHash(
            union.inputs.flatMap((source) => source.passages ?? []),
        ),
        wikiContribution: {
            ...prior.wikiContribution,
            essentialDistinctions: retainedRequirements,
        },
    };
    return { ...refreshed, fingerprint: viewHash(refreshed) };
}
