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

export function assertWikiContribution(
    result: ViewBuildTargetResult,
    contribution: {
        input: ViewBuildSnapshot;
        verification: WikiSubjectAssessment;
    },
    conflicted: boolean,
): void {
    const input = contribution.input;
    if (
        result.snapshot.pipeline !== "informational-wiki-v1" ||
        result.snapshot.expectedVersion !== 0 ||
        input.pipeline !== "informational-wiki-v1" ||
        input.expectedVersion < 1 ||
        input.model !== result.snapshot.model ||
        input.wikiContribution?.candidateViewId !== result.viewId ||
        result.wikiAssessment?.disposition !== "contribute" ||
        result.wikiAssessment.canonicalViewId !== input.definition.viewId ||
        contribution.verification.canonicalViewId !== input.definition.viewId ||
        (!conflicted && contribution.verification.disposition !== "covered")
    )
        throw new Error(
            "Wiki contribution cannot materialize or bind an unsupported candidate/canonical assessment",
        );
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
        throw new Error(
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
        throw new Error(
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
