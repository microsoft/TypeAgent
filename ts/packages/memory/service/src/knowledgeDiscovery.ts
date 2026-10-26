// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CorpusQuestionInput,
    CorpusQuestionProposal,
    DiscoveryPolicy,
    DiscoveryReceipt,
    DiscoveryRoute,
    KnowledgeSource,
    KnowledgeDiscoveryState,
} from "./knowledgeTypes.js";
import { knowledgeLimits } from "./knowledgeTypes.js";
import type { QuestionSlot } from "./schemaViewTypes.js";
import { validateQuestionSlot } from "./schemaView.js";
import { viewHash } from "./viewMerge.js";

export const corpusDiscoveryRecipe = "corpus-questions-v2";

type Passage = CorpusQuestionInput["passages"][number];

export interface CorpusQuestionPlanInput {
    corpusId: string;
    passages: Passage[];
    adapterIdentity: string;
    existingQuestions?: string[];
    receipts?: DiscoveryReceipt[];
}

export interface CorpusQuestionPlan {
    windows: CorpusQuestionInput[];
    inspectedSources: KnowledgeSource[];
    deferredSources: KnowledgeSource[];
}

export interface DiscoverySource extends KnowledgeSource {
    title: string;
    content: string;
}

/** Uses retained UTF-16 offsets; evenly spaced paragraph starts cover long sessions. */
function sourcePassages(source: DiscoverySource): Passage[] {
    const ranges = [
        ...source.content.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g),
    ].flatMap((match) => {
        const ranges: Array<{ start: number; end: number }> = [];
        for (
            let start = match.index!;
            start < match.index! + match[0].length;
            start += 1600
        )
            ranges.push({
                start,
                end: Math.min(start + 1600, match.index! + match[0].length),
            });
        return ranges;
    });
    const limit = knowledgeLimits.windowPassages * knowledgeLimits.windows;
    const selected =
        ranges.length <= limit
            ? ranges
            : Array.from(
                  { length: limit },
                  (_, index) =>
                      ranges[
                          Math.floor(
                              (index * (ranges.length - 1)) / (limit - 1),
                          )
                      ],
              );
    return selected
        .filter(({ start, end }) => source.content.slice(start, end).trim())
        .map(({ start, end }) => ({
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            title: source.title,
            passageId: `original-${viewHash([source.sourceId, source.revisionId, start, end]).slice(0, 24)}`,
            locator: `chars:${start}-${end}`,
            excerpt: source.content.slice(start, end),
        }));
}

export function planDiscoveryWindows(
    corpusId: string,
    sourceRecords: DiscoverySource[],
    existingQuestions: string[],
    state: KnowledgeDiscoveryState,
    adapterIdentity: string,
): CorpusQuestionInput[] {
    return planDiscoveryWindowsWithCoverage(
        corpusId,
        sourceRecords,
        existingQuestions,
        state,
        adapterIdentity,
    ).windows;
}

export function planDiscoveryWindowsWithCoverage(
    corpusId: string,
    sourceRecords: DiscoverySource[],
    existingQuestions: string[],
    state: KnowledgeDiscoveryState,
    adapterIdentity: string,
): CorpusQuestionPlan {
    const passages = sourceRecords.flatMap(sourcePassages);
    const plan = planCorpusQuestionWindows({
        corpusId,
        passages,
        existingQuestions,
        receipts: state.receipts,
        adapterIdentity,
    });
    const deferredKeys = new Set(plan.deferredSources.map(sourceKey));
    const deferred = sourceRecords.filter((source) => {
        const retained = sourcePassages(source);
        return (
            deferredKeys.has(sourceKey(source)) ||
            retained.reduce((sum, p) => sum + p.excerpt.length, 0) <
                source.content.replace(/[\r\n]/g, "").length
        );
    });
    plan.deferredSources = sources(
        deferred.map((source) => ({
            ...source,
            passageId: "",
            locator: "",
            excerpt: "",
        })),
    );
    return plan;
}

function sourceKey(source: KnowledgeSource): string {
    return JSON.stringify([source.sourceId, source.revisionId]);
}

function sources(passages: Passage[]): KnowledgeSource[] {
    return [
        ...new Map(
            passages.map(({ sourceId, revisionId }) => [
                sourceKey({ sourceId, revisionId }),
                { sourceId, revisionId },
            ]),
        ).values(),
    ];
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function validatePassages(passages: Passage[]): void {
    const ids = new Set<string>();
    for (const passage of passages) {
        if (
            [
                passage.passageId,
                passage.sourceId,
                passage.revisionId,
                passage.locator,
                passage.excerpt,
            ].some((value) => typeof value !== "string" || !value.trim()) ||
            typeof passage.title !== "string" ||
            passage.evidence !== undefined ||
            ids.has(passage.passageId)
        )
            throw new Error(
                "Discovery requires unique host-issued original passages",
            );
        ids.add(passage.passageId);
    }
}

/** Stable round-robin windows preserve receipt identity across discovery runs. */
export function planCorpusQuestionWindows(
    input: CorpusQuestionPlanInput,
): CorpusQuestionPlan {
    validatePassages(input.passages);
    if (!input.adapterIdentity.trim() || !input.corpusId.trim())
        throw new Error("Discovery requires corpus and adapter identities");
    const groups = new Map<string, Passage[]>();
    for (const original of input.passages) {
        const passage: Passage = {
            sourceId: original.sourceId,
            revisionId: original.revisionId,
            title: original.title,
            passageId: original.passageId,
            locator: original.locator,
            excerpt: original.excerpt,
        };
        const key = sourceKey(passage);
        groups.set(key, [...(groups.get(key) ?? []), passage]);
    }
    const keys = [...groups.keys()].sort(compare);
    for (const group of groups.values())
        group.sort((a, b) => compare(a.passageId, b.passageId));
    const queue: Passage[] = [];
    const rounds = Math.max(0, ...[...groups.values()].map((v) => v.length));
    for (let round = 0; round < rounds; round++)
        for (const key of keys) {
            const passage = groups.get(key)![round];
            if (passage) queue.push(passage);
        }
    const existingQuestions = [...new Set(input.existingQuestions ?? [])].sort(
        compare,
    );
    const remaining = new Set(queue);
    const windows: CorpusQuestionInput[] = [];
    while (remaining.size) {
        const passages: Passage[] = [];
        const windowSources = new Set<string>();
        const perSourceCounts = new Map<string, number>();
        const distinctRemainingSources = new Set(
            [...remaining].map((passage) => sourceKey(passage)),
        ).size;
        const maxPerSource =
            distinctRemainingSources <= 1
                ? knowledgeLimits.windowPassages
                : Math.max(
                      3,
                      Math.ceil(
                          knowledgeLimits.windowPassages /
                              Math.min(
                                  distinctRemainingSources,
                                  knowledgeLimits.windowSources,
                              ),
                      ),
                  );
        for (const passage of remaining) {
            const key = sourceKey(passage);
            const currentCount = perSourceCounts.get(key) ?? 0;
            if (
                passages.length >= knowledgeLimits.windowPassages ||
                currentCount >= maxPerSource ||
                (!windowSources.has(key) &&
                    windowSources.size >= knowledgeLimits.windowSources) ||
                JSON.stringify([...passages, passage]).length >
                    knowledgeLimits.windowChars
            )
                continue;
            passages.push(passage);
            windowSources.add(key);
            perSourceCounts.set(key, currentCount + 1);
            remaining.delete(passage);
        }
        if (!passages.length) break;
        const content = {
            corpusId: input.corpusId,
            passages,
            existingQuestions,
            maxProposals: knowledgeLimits.proposals,
        };
        windows.push({
            ...structuredClone(content),
            fingerprint: viewHash([
                corpusDiscoveryRecipe,
                input.adapterIdentity,
                {
                    corpusId: content.corpusId,
                    passages: content.passages,
                    maxProposals: content.maxProposals,
                },
            ]),
        });
    }
    const receipts = new Map(
        (input.receipts ?? []).map((receipt) => [receipt.fingerprint, receipt]),
    );
    const eligible = windows.filter(
        (window) => receipts.get(window.fingerprint)?.state !== "complete",
    );
    const rank = (window: CorpusQuestionInput) => {
        const receipt = receipts.get(window.fingerprint);
        return receipt?.state === "deferred" ? 0 : receipt ? 1 : 2;
    };
    eligible.sort((a, b) => rank(a) - rank(b));
    const selected = eligible.slice(0, knowledgeLimits.windows);
    const selectedFingerprints = new Set(
        selected.map((window) => window.fingerprint),
    );
    return {
        windows: selected,
        inspectedSources: sources(
            selected.flatMap((window) => window.passages),
        ),
        deferredSources: sources([
            ...remaining,
            ...eligible
                .filter(
                    (window) => !selectedFingerprints.has(window.fingerprint),
                )
                .flatMap((window) => window.passages),
        ]),
    };
}

function normalized(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => compare(a, b))
                .map(([key, child]) => [key, canonical(child)]),
        );
    return value;
}

export function questionContractIdentity(slot: QuestionSlot): string {
    return viewHash([
        normalized(slot.question),
        slot.cardinality,
        slot.itemKey ?? null,
        canonical(slot.schema),
        slot.rubric.selection,
        slot.rubric.freshnessDays ?? null,
    ]);
}

export function corpusQuestionIdentity(
    proposal: CorpusQuestionProposal,
): string {
    return viewHash([
        corpusDiscoveryRecipe,
        normalized(proposal.subject),
        questionContractIdentity(proposal.slot),
    ]);
}

export function cachedCorpusQuestionReceipt(
    receipts: DiscoveryReceipt[],
    fingerprint: string,
): DiscoveryReceipt | undefined {
    return receipts.find(
        (receipt) =>
            receipt.fingerprint === fingerprint && receipt.state === "complete",
    );
}

export function admitCorpusQuestion(
    proposal: CorpusQuestionProposal,
    input: {
        policy: DiscoveryPolicy;
        inputFingerprint: string;
        adapterIdentity: string;
    },
): QuestionSlot {
    if (input.policy === "off")
        throw new Error("Question discovery is disabled");
    validateQuestionSlot(proposal.slot);
    if (
        !proposal.subject.trim() ||
        proposal.subject.length > 240 ||
        proposal.slot.question.length > 240 ||
        !proposal.reason.trim() ||
        !proposal.slot.discoveryCitations.length ||
        proposal.slot.rubric.authoritySourceIds.length
    )
        throw new Error(
            "Question admission requires subject, utility and original evidence",
        );
    if (
        proposal.slot.discoveryCitations.some(
            (citation) =>
                citation.evidence !== undefined ||
                [
                    citation.sourceId,
                    citation.revisionId,
                    citation.locator,
                    citation.excerpt,
                ].some((value) => typeof value !== "string" || !value.trim()),
        )
    )
        throw new Error("Question admission requires original citations");
    const slot: QuestionSlot = {
        ...structuredClone(proposal.slot),
        id: `question-${corpusQuestionIdentity(proposal).slice(0, 24)}`,
        approval: input.policy === "sourceObserved" ? "approved" : "proposed",
        rubric: {
            ...structuredClone(proposal.slot.rubric),
            requireConfirmation: input.policy !== "sourceObserved",
        },
        admission: {
            version: 1,
            actor: "policy",
            policyVersion: 1,
            recipeIdentity: corpusDiscoveryRecipe,
            modelIdentity: input.adapterIdentity,
            inputFingerprint: input.inputFingerprint,
            reason: proposal.reason,
        },
    };
    validateQuestionSlot(slot);
    return slot;
}

export function policyAdmittedSlot(
    proposal: CorpusQuestionProposal,
    input: CorpusQuestionInput,
    policy: DiscoveryPolicy,
    modelIdentity: string,
): QuestionSlot {
    const slot = admitCorpusQuestion(proposal, {
        policy,
        inputFingerprint: input.fingerprint,
        adapterIdentity: modelIdentity,
    });
    for (const citation of slot.discoveryCitations)
        if (
            !input.passages.some(
                (passage) =>
                    citation.sourceId === passage.sourceId &&
                    citation.revisionId === passage.revisionId &&
                    citation.locator === passage.locator &&
                    citation.excerpt === passage.excerpt &&
                    !passage.evidence,
            )
        )
            throw new Error(
                "Admission citation is outside the discovery input",
            );
    const subject = normalized(proposal.subject);
    if (
        !subject ||
        !input.passages.some(
            (passage) =>
                slot.discoveryCitations.some(
                    (citation) =>
                        citation.sourceId === passage.sourceId &&
                        citation.revisionId === passage.revisionId &&
                        citation.locator === passage.locator &&
                        citation.excerpt === passage.excerpt,
                ) &&
                ` ${normalized(`${passage.title} ${passage.excerpt}`)} `.includes(
                    ` ${subject} `,
                ),
        )
    )
        throw new Error(
            "Admission subject is not resolvable in cited original evidence",
        );
    return slot;
}

const genericDiscoveryRouteTerms = new Set([
    "the",
    "and",
    "for",
    "are",
    "was",
    "were",
    "been",
    "being",
    "can",
    "could",
    "would",
    "should",
    "will",
    "may",
    "might",
    "its",
    "his",
    "her",
    "our",
    "your",
    "they",
    "them",
    "you",
    "not",
    "user",
    "users",
    "assistant",
    "human",
    "agent",
    "speaker",
    "author",
    "session",
    "conversation",
    "chat",
    "message",
    "messages",
    "transcript",
    "document",
    "source",
    "note",
    "notes",
    "question",
    "answer",
    "summary",
    "status",
    "current",
    "general",
    "what",
    "who",
    "where",
    "when",
    "which",
    "how",
    "does",
    "did",
    "have",
    "has",
    "had",
    "with",
    "from",
    "into",
    "that",
    "this",
    "their",
    "there",
    "about",
    "user's",
]);

export function isGenericDiscoveryRouteTerm(term: string): boolean {
    const clean = normalized(term);
    if (!clean) return true;
    const words = clean.split(" ").filter(Boolean);
    if (!words.length) return true;
    return words.every(
        (word) => word.length <= 2 || genericDiscoveryRouteTerms.has(word),
    );
}

export function deriveDiscoveryRouteTerms(
    subject: string,
    question?: string,
): string[] {
    const extract = (text: string) =>
        normalized(text)
            .split(" ")
            .filter(
                (word) =>
                    word.length > 2 && !genericDiscoveryRouteTerms.has(word),
            );
    const subjectTerms = extract(subject);
    if (subjectTerms.length) return [...new Set(subjectTerms)];
    return [...new Set(extract(question ?? ""))];
}

export function discoveryRouteMatches(
    route: DiscoveryRoute,
    input: { title?: string; terms?: string[]; sourceId?: string },
): boolean {
    if (route.detached) return false;
    if (input.sourceId && route.sourceIds.includes(input.sourceId)) return true;
    const terms = new Set(
        (input.terms ?? [])
            .map(normalized)
            .filter(
                (term) => Boolean(term) && !isGenericDiscoveryRouteTerm(term),
            ),
    );
    const title = ` ${normalized(input.title ?? "")} `;
    return [route.subject, ...route.terms]
        .map(normalized)
        .filter((term) => Boolean(term) && !isGenericDiscoveryRouteTerm(term))
        .some((term) => terms.has(term) || title.includes(` ${term} `));
}
