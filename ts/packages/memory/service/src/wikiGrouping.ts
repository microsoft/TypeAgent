// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { normalizeInitiativeSelector } from "./initiativeDiscovery.js";
import type { IndexedSubject, IndexedSubjectIdentity } from "./types.js";
import type { WikiFamilyState } from "./viewStore.js";
import type { ViewVersion } from "./viewTypes.js";
import type { ViewMaintenancePlan } from "./viewMaintenanceTypes.js";

const conversationalQuestionPrefix =
    /^(?:what|how|why|when|where|who|which|can|could|would|should|please|tell\s+me|show\s+me)\s+(?:is|are|was|were|do|does|did|can|could|would|should|to|the|a|an|we|you|i)\b/i;

export function usefulWikiSubjectLabel(term: string): boolean {
    const trimmed = term.trim();
    const name = normalizeInitiativeSelector(trimmed);
    if (!name || name.length > 200 || !/\p{L}/u.test(name)) return false;
    const words = name.split(/\s+/).filter(Boolean);
    if (
        words.length > 8 ||
        /[?!]$/.test(trimmed) ||
        conversationalQuestionPrefix.test(name)
    )
        return false;
    return !(
        /^\d{4}-\d{2}-\d{2}(?:[t ][\d:.+-]+z?)?$/i.test(name) ||
        /^[+-]?\d[\d.,]*\s*(?:%|[\p{L}/]+)$/u.test(name)
    );
}

export function usefulWikiSubject(term: string, indexedText: string): boolean {
    if (!usefulWikiSubjectLabel(term)) return false;
    const name = normalizeInitiativeSelector(term);
    const paragraphs = indexedText
        .split(/\n\s*\n/)
        .filter(
            (paragraph) =>
                !paragraph
                    .split("\n")
                    .every((line) =>
                        /^\s*(?:subject|title|name|type|date|time|status|owner|quantity|value|project|initiative|scope)\s*:/i.test(
                            line,
                        ),
                    ),
        )
        .map(normalizeInitiativeSelector);
    const substantive = paragraphs.some(
        (text) =>
            text.includes(name) &&
            /\p{L}/u.test(
                text.replaceAll(name, "").replace(/\b(the|a|an|is|are)\b/g, ""),
            ) &&
            !/^#{1,6}\s+[^\n]+$/.test(text),
    );
    if (!substantive) return false;
    if (
        /^(status|owner|date|time|quantity|value|property|metadata|context|goals?|scope|user|assistant|human|agent|prompt|response|question|answer|conversation|chat|transcript|speaker)$/i.test(
            name,
        )
    )
        return paragraphs.some(
            (text) =>
                text.includes(name) &&
                /\b(means|defined as|refers to|represents|distinguishes)\b/.test(
                    text,
                ),
        );
    return true;
}

export function retireWikiCandidate(
    family: WikiFamilyState,
    viewId: string,
    plan: ViewMaintenancePlan,
): void {
    family.descriptors = family.descriptors.filter(
        (entry) => entry.viewId !== viewId,
    );
    plan.targets.push({
        viewId,
        expectedVersion: 0,
        state: "blocked",
        reason: "Candidate usefulness filter: selected indexed evidence is metadata or an unsupported standalone shell; no saved page was removed.",
    });
}

export function compatibleSubjectIdentity(
    left?: IndexedSubjectIdentity,
    right?: IndexedSubjectIdentity,
): boolean {
    if (!left || !right) return true;
    const normalized = (values: string[]) =>
        [...new Set(values.map(normalizeInitiativeSelector))].sort().join("\0");
    return (
        (!left.types.length ||
            !right.types.length ||
            normalized(left.types) === normalized(right.types)) &&
        (!left.scopes.length ||
            !right.scopes.length ||
            normalized(left.scopes) === normalized(right.scopes)) &&
        (!left.symbols?.length ||
            !right.symbols?.length ||
            [...left.symbols].sort().join("\0") ===
                [...right.symbols].sort().join("\0"))
    );
}

function sharedEvidence(left: string[], right: string[]): boolean {
    return left.some((id) => right.includes(id));
}

export function symbolicIdentity(identity?: IndexedSubjectIdentity): boolean {
    return (
        identity?.types.some((type) =>
            /\b(symbol|identifier|field|function|variable)\b/i.test(type),
        ) ?? false
    );
}

type WikiDescriptor = WikiFamilyState["descriptors"][number];

export function rankWikiCandidates(
    descriptors: readonly WikiDescriptor[],
    views: readonly ViewVersion[],
    enabled: boolean,
    afterViewId?: string,
): readonly WikiDescriptor[] {
    const existing = new Set(views.map((view) => view.viewId));
    const ranked = enabled
        ? [...descriptors].sort(
              (left, right) =>
                  Number(existing.has(right.viewId)) -
                      Number(existing.has(left.viewId)) ||
                  (right.salience ?? right.postingCount ?? 1) -
                      (left.salience ?? left.postingCount ?? 1) ||
                  right.sourceIds.length - left.sourceIds.length ||
                  (right.postingCount ?? 1) - (left.postingCount ?? 1) ||
                  left.query.localeCompare(right.query),
          )
        : descriptors;
    const previous =
        afterViewId === undefined
            ? -1
            : ranked.findIndex((entry) => entry.viewId === afterViewId);
    return ranked.slice(previous + 1);
}

function viewRetrieval(view: ViewVersion, kind: "wiki" | "projects") {
    return kind === "wiki"
        ? view.definition.wiki
        : view.definition.projectSummary;
}

function synchronizeDescriptors(
    family: WikiFamilyState,
    views: ViewVersion[],
    kind: "wiki" | "projects",
): void {
    for (const view of views) {
        const retrieval = viewRetrieval(view, kind);
        if (!retrieval) continue;
        const prior = family.descriptors.find(
            (entry) => entry.viewId === view.viewId,
        );
        if (prior) {
            prior.query = retrieval.query;
        } else {
            family.descriptors.push({
                viewId: view.viewId,
                query: retrieval.query,
                sourceIds: view.content.citations.map(
                    (citation) => citation.sourceId,
                ),
            });
        }
    }
}

function inferDescriptorIdentities(
    descriptors: WikiDescriptor[],
    subjects: IndexedSubject[],
): void {
    for (const descriptor of descriptors) {
        if (descriptor.identity) continue;
        const exact = subjects.filter(
            (subject) =>
                subject.term.trim().toLocaleLowerCase() ===
                    descriptor.query.trim().toLocaleLowerCase() &&
                sharedEvidence(descriptor.sourceIds, subject.sourceIds),
        );
        if (exact.length === 1 && exact[0].identity)
            descriptor.identity = exact[0].identity;
    }
}

function lexicalDescriptors(
    descriptors: WikiDescriptor[],
    subject: IndexedSubject,
    query: string,
    views: ViewVersion[],
    kind: "wiki" | "projects",
): WikiDescriptor[] {
    return descriptors.filter((descriptor) => {
        const view = views.find((entry) => entry.viewId === descriptor.viewId);
        const retrieval = view && viewRetrieval(view, kind);
        const aliases = retrieval
            ? [retrieval.query, ...retrieval.aliases]
            : [descriptor.query];
        const symbol =
            symbolicIdentity(subject.identity) ||
            symbolicIdentity(descriptor.identity);
        return (
            aliases.some(
                (alias) =>
                    normalizeInitiativeSelector(alias) ===
                    normalizeInitiativeSelector(query),
            ) &&
            compatibleSubjectIdentity(descriptor.identity, subject.identity) &&
            (!symbol ||
                aliases.some((alias) => alias.trim() === subject.term.trim()))
        );
    });
}

function mergeSubjectIdentity(
    prior: WikiDescriptor,
    identity: IndexedSubjectIdentity,
): void {
    prior.identity = {
        types: prior.identity?.types.length
            ? prior.identity.types
            : identity.types,
        scopes: prior.identity?.scopes.length
            ? prior.identity.scopes
            : identity.scopes,
        ...(prior.identity?.symbols?.length || identity.symbols?.length
            ? {
                  symbols: prior.identity?.symbols?.length
                      ? prior.identity.symbols
                      : identity.symbols,
              }
            : {}),
    };
}

function applySubject(
    family: WikiFamilyState,
    subject: IndexedSubject,
    views: ViewVersion[],
    kind: "wiki" | "projects",
): void {
    if ((subject.identity?.symbols?.length ?? 0) > 1) {
        family.error = `Ambiguous ${kind} indexed symbol '${subject.term}': multiple exact spellings share one folded index term. Existing records remain separate; scope review required.`;
        return;
    }
    const query = symbolicIdentity(subject.identity)
        ? subject.term.trim()
        : subject.term.trim().toLocaleLowerCase();
    const lexical = lexicalDescriptors(
        family.descriptors,
        subject,
        query,
        views,
        kind,
    );
    const nominations = lexical.filter((descriptor) => {
        const view = views.find((entry) => entry.viewId === descriptor.viewId);
        return sharedEvidence(
            [
                ...descriptor.sourceIds,
                ...(view?.content.citations.map(
                    (citation) => citation.sourceId,
                ) ?? []),
            ],
            subject.sourceIds,
        );
    });
    if (lexical.length && !nominations.length) {
        family.error = `Ambiguous ${kind} selector '${query}': lexical similarity lacks shared indexed subject evidence. Existing records remain separate; scope review required.`;
        return;
    }
    const saved = nominations.filter((entry) =>
        views.some((view) => view.viewId === entry.viewId),
    );
    if (saved.length > 1) {
        family.error = `Ambiguous ${kind} selector '${query}': existing page records remain separate; queries/aliases and scope evidence require review. No pages were merged.`;
        return;
    }
    const prior = saved[0] ?? nominations[0];
    if (!prior) {
        if (query && query.length <= 200)
            family.descriptors.push({
                viewId: randomUUID(),
                query,
                sourceIds: subject.sourceIds,
                ...(subject.postingCount !== undefined &&
                subject.postingCount > 1
                    ? { postingCount: subject.postingCount }
                    : {}),
                ...(subject.salience !== undefined &&
                subject.salience !== (subject.postingCount ?? 1)
                    ? { salience: subject.salience }
                    : {}),
                ...(subject.identity ? { identity: subject.identity } : {}),
            });
        return;
    }
    prior.sourceIds = [...new Set([...prior.sourceIds, ...subject.sourceIds])];
    if (subject.postingCount !== undefined)
        prior.postingCount = subject.postingCount;
    if (subject.salience !== undefined) prior.salience = subject.salience;
    else delete prior.salience;
    if (subject.identity) mergeSubjectIdentity(prior, subject.identity);
    // Only unmaterialized nominations can be retired; saved records and their edits remain intact.
    family.descriptors = family.descriptors.filter(
        (entry) =>
            entry === prior ||
            !nominations.includes(entry) ||
            views.some((view) => view.viewId === entry.viewId),
    );
}

export function discoverInformationalDescriptors(
    family: WikiFamilyState,
    subjects: IndexedSubject[],
    views: ViewVersion[],
    kind: "wiki" | "projects",
): void {
    synchronizeDescriptors(family, views, kind);
    inferDescriptorIdentities(family.descriptors, subjects);
    for (const subject of subjects) applySubject(family, subject, views, kind);
}
