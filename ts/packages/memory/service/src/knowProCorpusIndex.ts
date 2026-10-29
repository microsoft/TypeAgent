// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    DocPart,
    type DocMemorySettings,
    createDocMemorySettings,
    docPartsFromHtml,
    docPartsFromMarkdown,
    docPartsFromText,
    docPartsFromVtt,
    splitDocPartTextForEmbedding,
} from "@typeagent/conversation-memory";
import * as kp from "@typeagent/knowpro";
import { maintenanceExtractionModel } from "./maintenanceConcurrency.js";
import { isInitiativeSubject } from "./initiativeDiscovery.js";
import { indexedTopicOccurrence } from "./topicIncidence.js";
import {
    admitGraphReference,
    excludedGraphKnowledge,
} from "./graphProjection.js";
import type { TopicOccurrence } from "./topicTypes.js";
import { symbolicIdentity, usefulWikiSubject } from "./wikiGrouping.js";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { projectRetainedIndex } from "./retainedIndex.js";
import { temporalQuestion } from "./temporalContext.js";
import {
    indexedTextHash,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "./indexedFragments.js";
import type {
    CorpusIndex,
    CorpusIndexAnswer,
    AnswerContextDiagnostics,
    CorpusIndexMatch,
    IndexedDocument,
    IndexedSubject,
    IndexedSubjectIdentity,
    IndexedFragmentRequest,
    IndexedFragmentSelection,
    MemoryPage,
    JobProgress,
    MemoryKnowledgeGraph,
} from "./types.js";

const indexBaseName = "corpus";
const structuralChunkCharacters = 8_000;
const extractionChunkTokens = 24_000;
const durableDocPartOptions = {
    collectLinkKnowledge: false,
    collectStructuralKnowledge: false,
    maxTokensPerPart: extractionChunkTokens,
};

interface EntityKnowledge {
    name: string;
    type: string[];
    facets?: Array<{ name: string; value: unknown }>;
}

function initiativeKnowledgeTypes(ref: {
    knowledgeType: string;
    knowledge: unknown;
}): string[] {
    return ref.knowledgeType === "entity"
        ? (ref.knowledge as EntityKnowledge).type
        : [];
}

interface TopicKnowledge {
    text: string;
}

function indexedSubjectIdentity(ref: {
    knowledgeType: string;
    knowledge: unknown;
}): IndexedSubjectIdentity {
    if (ref.knowledgeType !== "entity") return { types: [], scopes: [] };
    const entity = ref.knowledge as EntityKnowledge;
    return {
        types: entity.type,
        scopes: (entity.facets ?? []).flatMap((facet) =>
            /^(project|initiative|episode|scope)$/i.test(facet.name) &&
            typeof facet.value === "string" &&
            facet.value.trim()
                ? [`${facet.name.toLocaleLowerCase()}:${facet.value.trim()}`]
                : [],
        ),
        ...(symbolicIdentity({ types: entity.type, scopes: [] })
            ? { symbols: [entity.name] }
            : {}),
    };
}

interface ActionKnowledge {
    verbs: string[];
    subjectEntityName: string;
    objectEntityName: string;
}

function indexedWords(text: string): string[] {
    return text.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
}

function matchingIndexTerms(
    memory: DocMemory,
    request: IndexedFragmentRequest,
): { requested: Set<string>; terms: string[] } {
    const requested = new Set(request.terms.flatMap(indexedWords));
    const vocabulary = [...memory.semanticRefIndex.getTerms()];
    const words = [...new Set(vocabulary.flatMap(indexedWords))];
    for (const word of [...requested]) {
        if (word.length < 5) continue;
        for (const match of kp.nearestNeighborEditDistance(
            words,
            word,
            4,
            word.length >= 8 ? 2 : 1,
        ))
            if (match.item.startsWith(word.slice(0, 3)))
                requested.add(match.item);
    }
    return {
        requested,
        terms: vocabulary.filter(
            (term) =>
                request.terms.some(
                    (query) =>
                        term.toLocaleLowerCase() === query.toLocaleLowerCase(),
                ) ||
                indexedWords(term).some(
                    (word) => requested.has(word) && word.length > 2,
                ),
        ),
    };
}

type MessageSpeakerRole = "user" | "assistant" | "mixed" | "document";

const userRolePattern = /^(?:user|human|prompt|question|requester|author)$/i;
const assistantRolePattern =
    /^(?:assistant|agent|ai|model|bot|response|answer)$/i;
const speakerLinePattern =
    /^\s*(?:#{1,6}\s+|\*\*)?(user|human|assistant|agent|ai)(?:\*\*)?(?:\s*:(?:\s|$)|\s*$)/gim;
const leadingUserTurnPattern =
    /^\s*(?:#{1,6}\s+|\*\*)?(?:user|human)(?:\*\*)?(?:\s*:|\s*\r?\n)/i;
const leadingAssistantTurnPattern =
    /^\s*(?:#{1,6}\s+|\*\*)?(?:assistant|agent|ai)(?:\*\*)?(?:\s*:|\s*\r?\n)/i;

function inferMessageTurnRole(
    message: DocPart,
    text = (message?.textChunks ?? []).join("\n"),
): MessageSpeakerRole {
    const contextRole = message.metadata.temporalContext?.role?.trim();
    if (contextRole) {
        if (userRolePattern.test(contextRole)) return "user";
        if (assistantRolePattern.test(contextRole)) return "assistant";
    }
    for (const tag of message.tags ?? []) {
        if (typeof tag !== "string") continue;
        const normalized = tag.trim().toLocaleLowerCase();
        if (["role:user", "user"].includes(normalized)) return "user";
        if (["role:assistant", "assistant"].includes(normalized))
            return "assistant";
    }
    let hasUser = false;
    let hasAssistant = false;
    for (const match of text.matchAll(speakerLinePattern)) {
        const label = match[1]?.toLocaleLowerCase() ?? "";
        if (userRolePattern.test(label)) hasUser = true;
        else if (label === "assistant" || label === "agent" || label === "ai")
            hasAssistant = true;
    }
    if (hasUser && hasAssistant) return "mixed";
    if (leadingUserTurnPattern.test(text)) return "user";
    if (leadingAssistantTurnPattern.test(text)) return "assistant";
    return "document";
}

function splitMixedSpeakerSpans(
    text: string,
): Array<{ role: "user" | "assistant" | "document"; text: string }> {
    const spans: Array<{
        role: "user" | "assistant" | "document";
        text: string;
    }> = [];
    let currentRole: "user" | "assistant" | "document" = "document";
    let buffer: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const match =
            /^\s*(?:#{1,6}\s+|\*\*)?(user|human|assistant|agent|ai)(?:\*\*)?(?:\s*:(.*)|\s*)$/i.exec(
                line,
            );
        if (match) {
            if (buffer.length) {
                spans.push({ role: currentRole, text: buffer.join("\n") });
                buffer = [];
            }
            const label = match[1].toLocaleLowerCase();
            currentRole =
                label === "user" || label === "human" ? "user" : "assistant";
            if (match[2]?.trim()) buffer.push(match[2].trim());
        } else {
            buffer.push(line);
        }
    }
    if (buffer.length) {
        spans.push({ role: currentRole, text: buffer.join("\n") });
    }
    return spans;
}

function termMentionedInText(text: string, term: string): boolean {
    const lowerText = text.toLocaleLowerCase();
    const lowerTerm = term.trim().toLocaleLowerCase();
    if (!lowerTerm) return false;
    if (lowerText.includes(lowerTerm)) return true;
    const words = indexedWords(lowerTerm).filter((word) => word.length > 2);
    if (!words.length) return false;
    const textWords = new Set(indexedWords(lowerText));
    const matched = words.filter((word) => textWords.has(word)).length;
    return (
        matched === words.length ||
        (words.length >= 2 && matched / words.length >= 0.8)
    );
}

function effectiveTermRole(
    message: DocPart,
    text: string,
    term: string,
): "user" | "assistant" | "document" {
    const role = inferMessageTurnRole(message, text);
    if (role !== "mixed") return role;
    const spans = splitMixedSpeakerSpans(text);
    const inUser = spans.some(
        (span) => span.role === "user" && termMentionedInText(span.text, term),
    );
    if (inUser) return "user";
    const inAssistant = spans.some(
        (span) =>
            span.role === "assistant" && termMentionedInText(span.text, term),
    );
    if (inAssistant) return "assistant";
    return "document";
}

function roleSalienceWeight(role: "user" | "assistant" | "document"): number {
    if (role === "user") return 1.5;
    if (role === "assistant") return 0.65;
    return 1.0;
}

function findPrecedingUserEchoOrdinal(
    memory: DocMemory,
    assistantOrdinal: number,
    sourceId: string,
    revisionId: string,
    term: string,
): number | undefined {
    for (let prev = assistantOrdinal - 1; prev >= 0; prev--) {
        const prevMessage = memory.messages.get(prev);
        const prevSource = parseSourceUri(prevMessage?.metadata.sourceUrl);
        if (
            !prevMessage ||
            !prevSource ||
            prevSource.sourceId !== sourceId ||
            prevSource.revisionId !== revisionId
        )
            break;
        const prevText = (prevMessage.textChunks ?? []).join("\n");
        const prevRole = effectiveTermRole(prevMessage, prevText, term);
        if (prevRole === "user") {
            return termMentionedInText(prevText, term) ? prev : undefined;
        }
    }
    return undefined;
}

function countIndependentMention(
    memory: DocMemory,
    ordinal: number,
    term: string,
    counted: Set<number>,
): number {
    const message = memory.messages.get(ordinal);
    const source = parseSourceUri(message?.metadata.sourceUrl);
    const role = effectiveTermRole(
        message,
        (message.textChunks ?? []).join("\n"),
        term,
    );
    const independentOrdinal =
        role === "assistant" && source
            ? (findPrecedingUserEchoOrdinal(
                  memory,
                  ordinal,
                  source.sourceId,
                  source.revisionId,
                  term,
              ) ?? ordinal)
            : ordinal;
    if (counted.has(independentOrdinal)) return 0;
    counted.add(independentOrdinal);
    return 1;
}

function postingSpeakerContext(
    memory: DocMemory,
    matches: Map<number, Set<string>>,
) {
    const roles = new Map<number, MessageSpeakerRole>();
    const echoedWordsByOrdinal = new Map<number, Set<string>>();
    for (const [ordinal, words] of matches) {
        const message = memory.messages.get(ordinal);
        if (!message) continue;
        const role = inferMessageTurnRole(message);
        roles.set(ordinal, role);
        const source = parseSourceUri(message.metadata.sourceUrl);
        if (role !== "assistant" || !source) continue;
        const echoed = new Set(
            [...words].filter((word) => {
                const preceding = findPrecedingUserEchoOrdinal(
                    memory,
                    ordinal,
                    source.sourceId,
                    source.revisionId,
                    word,
                );
                return (
                    preceding !== undefined && matches.get(preceding)?.has(word)
                );
            }),
        );
        if (echoed.size) echoedWordsByOrdinal.set(ordinal, echoed);
    }
    return { roles, echoedWordsByOrdinal };
}

function collectPostingMatches(
    memory: DocMemory,
    terms: string[],
    requested: Set<string>,
    eligible: (ordinal: number) => boolean,
): Map<number, Set<string>> {
    const matches = new Map<number, Set<string>>();
    for (const term of terms) {
        const matchedWords = indexedWords(term).filter((word) =>
            requested.has(word),
        );
        for (const posting of memory.semanticRefIndex.lookupTerm(term)) {
            const ref = memory.semanticRefs.get(posting.semanticRefOrdinal);
            const start = ref.range.start.messageOrdinal;
            if (!eligible(start)) continue;
            const end = ref.range.end
                ? ref.range.end.messageOrdinal -
                  ((ref.range.end.chunkOrdinal ?? 0) === 0 ? 1 : 0)
                : start;
            for (
                let ordinal = start;
                ordinal <= Math.min(end, start + 4);
                ordinal++
            ) {
                if (!eligible(ordinal)) continue;
                const words = matches.get(ordinal) ?? new Set<string>();
                matchedWords.forEach((word) => words.add(word));
                matches.set(ordinal, words);
            }
        }
    }
    return matches;
}

function collectPostingScores(
    memory: DocMemory,
    terms: string[],
    requested: Set<string>,
    eligible: (ordinal: number) => boolean,
    messageCount: number,
): Map<number, number> {
    const matches = collectPostingMatches(memory, terms, requested, eligible);
    const { roles, echoedWordsByOrdinal } = postingSpeakerContext(
        memory,
        matches,
    );
    const supportCounts = new Map<string, number>();
    for (const [ordinal, words] of matches)
        for (const word of words)
            if (!echoedWordsByOrdinal.get(ordinal)?.has(word))
                supportCounts.set(word, (supportCounts.get(word) ?? 0) + 1);
    const scores = new Map<number, number>();
    for (const [ordinal, words] of matches) {
        const role = roles.get(ordinal) ?? "document";
        const echoed = echoedWordsByOrdinal.get(ordinal);
        const rawScore = [...words].reduce((score, word) => {
            const independentCount = Math.max(1, supportCounts.get(word) ?? 0);
            const wordWeight = echoed?.has(word) ? 0.5 : 1.0;
            return (
                score +
                wordWeight * Math.log(1 + messageCount / independentCount)
            );
        }, 0);
        const roleMultiplier =
            role === "user" ? 1.25 : role === "assistant" ? 0.8 : 1.0;
        scores.set(ordinal, rawScore * roleMultiplier);
    }
    return scores;
}

function sourceUri(document: IndexedDocument): string {
    return `typeagent-memory://sources/${encodeURIComponent(document.source.sourceId)}/revisions/${encodeURIComponent(document.revision.revisionId)}`;
}

function parseDocParts(document: IndexedDocument): DocPart[] {
    const uri = sourceUri(document);
    const chunkCharacters =
        document.pipeline.maxCharsPerChunk ?? structuralChunkCharacters;
    let parts: DocPart[];
    switch (document.source.sourceType) {
        case "html":
            parts = docPartsFromHtml(
                document.content,
                false,
                chunkCharacters,
                uri,
                undefined,
                durableDocPartOptions,
            );
            break;
        case "markdown":
        case "web":
            parts = docPartsFromMarkdown(
                document.content,
                chunkCharacters,
                uri,
                durableDocPartOptions,
            );
            break;
        case "vtt":
            parts = docPartsFromVtt(
                document.content,
                uri,
                durableDocPartOptions,
            );
            break;
        case "text":
            parts = docPartsFromText(
                document.content,
                chunkCharacters,
                uri,
                durableDocPartOptions,
            );
            break;
    }
    for (const part of parts) {
        part.tags.push(...(document.indexTags ?? []));
    }
    return parts;
}

function toDocParts(document: IndexedDocument): DocPart[] {
    const temporal: kp.SourceTemporalContext = document.revision
        .temporalContext ?? {
        version: 1,
        scopes: [
            { ownerId: "document", start: 0, end: document.content.length },
        ],
    };
    const ordinals = new Map<string, number>();
    return kp
        .temporalSegments(
            document.content,
            temporal,
            document.revision.revisionId,
        )
        .flatMap((segment) => {
            const parts = parseDocParts({ ...document, content: segment.text });
            for (const part of parts) {
                if (!segment.context) continue;
                const context = structuredClone(segment.context);
                const partOrdinal = ordinals.get(context.ownerId) ?? 0;
                ordinals.set(context.ownerId, partOrdinal + 1);
                context.partOrdinal = partOrdinal;
                context.eventMentions = kp.temporalMentions(
                    part.textChunks.join("\n"),
                    context,
                );
                part.metadata.temporalContext = context;
                part.timestamp = context.messageTime?.instantUtc;
            }
            return parts;
        });
}

function parseSourceUri(
    uri: string | undefined,
): { sourceId: string; revisionId: string } | undefined {
    if (uri === undefined) {
        return undefined;
    }
    const match =
        /^typeagent-memory:\/\/sources\/([^/]+)\/revisions\/(.+)$/.exec(uri);
    if (match === null) {
        return undefined;
    }
    return {
        sourceId: decodeURIComponent(match[1]),
        revisionId: decodeURIComponent(match[2]),
    };
}

export class KnowProCorpusIndex implements CorpusIndex {
    private memory: DocMemory | undefined;
    private activeRevisions = new Map<string, string>();

    private eligible(ordinal: number): boolean {
        const source = parseSourceUri(
            this.memory?.messages.get(ordinal)?.metadata.sourceUrl,
        );
        return (
            source !== undefined &&
            this.activeRevisions.get(source.sourceId) === source.revisionId
        );
    }

    private eligibleRanges(sourceIds?: ReadonlySet<string>): kp.TextRange[] {
        const ranges: kp.TextRange[] = [];
        for (
            let ordinal = 0;
            this.memory && ordinal < this.memory.messages.length;
            ordinal++
        ) {
            const source = parseSourceUri(
                this.memory.messages.get(ordinal).metadata.sourceUrl,
            );
            if (
                !this.eligible(ordinal) ||
                (sourceIds && (!source || !sourceIds.has(source.sourceId)))
            )
                continue;
            // TextRangeCollection looks up ranges by their starting message ordinal.
            ranges.push({
                start: { messageOrdinal: ordinal },
                end: { messageOrdinal: ordinal + 1 },
            });
        }
        return ranges;
    }

    private async saveEligibility(): Promise<void> {
        await writeRunbookJson(
            path.join(this.indexDirectory, "eligibility.json"),
            `${JSON.stringify({
                version: 1,
                revisions: [...this.activeRevisions],
            })}\n`,
        );
    }

    private async loadEligibility(): Promise<void> {
        this.activeRevisions.clear();
        for (const [sourceId, messages] of this.sourceMessages)
            if (messages.length)
                this.activeRevisions.set(sourceId, messages.at(-1)!.revisionId);
        let value: unknown;
        try {
            value = JSON.parse(
                await readFile(
                    path.join(this.indexDirectory, "eligibility.json"),
                    "utf8",
                ),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        if (
            !value ||
            typeof value !== "object" ||
            !("version" in value) ||
            value.version !== 1 ||
            !("revisions" in value) ||
            !Array.isArray(value.revisions)
        )
            throw new Error(
                "Invalid document revision eligibility; rebuild the derived index",
            );
        const active = new Map<string, string>();
        for (const entry of value.revisions) {
            if (
                !Array.isArray(entry) ||
                entry.length !== 2 ||
                typeof entry[0] !== "string" ||
                typeof entry[1] !== "string" ||
                active.has(entry[0]) ||
                !this.sourceMessages
                    .get(entry[0])
                    ?.some((message) => message.revisionId === entry[1])
            )
                throw new Error("Invalid document revision eligibility entry");
            active.set(entry[0], entry[1]);
        }
        if (active.size !== this.sourceMessages.size)
            throw new Error("Incomplete document revision eligibility");
        this.activeRevisions = active;
    }
    private sourceMessages = new Map<
        string,
        Array<{
            revisionId: string;
            messageOrdinal: number;
        }>
    >();

    private refreshSourceMessages(memory?: DocMemory): void {
        this.sourceMessages.clear();
        for (
            let ordinal = 0;
            memory && ordinal < memory.messages.length;
            ordinal++
        ) {
            const source = parseSourceUri(
                memory.messages.get(ordinal).metadata.sourceUrl,
            );
            if (!source) continue;
            const messages = this.sourceMessages.get(source.sourceId) ?? [];
            messages.push({
                revisionId: source.revisionId,
                messageOrdinal: ordinal,
            });
            this.sourceMessages.set(source.sourceId, messages);
        }
    }

    public constructor(
        private readonly corpusId: string,
        private readonly indexDirectory: string,
        private readonly settingsFactory?: () => DocMemorySettings,
    ) {}

    private createSettings(): DocMemorySettings {
        const settings = this.settingsFactory?.() ?? createDocMemorySettings();
        if (!this.settingsFactory)
            settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                kp.createKnowledgeExtractor(
                    maintenanceExtractionModel(settings.languageModel),
                );
        settings.conversationSettings.messageTextIndexSettings.splitText ??=
            splitDocPartTextForEmbedding;
        return settings;
    }

    public async initialize(): Promise<void> {
        const semanticIndexPath = path.join(
            this.indexDirectory,
            `${indexBaseName}_data.json`,
        );
        const hasSemanticIndex = await access(semanticIndexPath).then(
            () => true,
            () => false,
        );
        if (this.settingsFactory !== undefined || hasSemanticIndex) {
            const settings = this.createSettings();
            const indexes = settings.conversationSettings;
            this.memory = await kp.timeSearchStage("ingestion.index.load", () =>
                DocMemory.readFromFile(
                    this.indexDirectory,
                    indexBaseName,
                    settings,
                    {
                        loadEmbeddings: [
                            indexes.relatedTermIndexSettings
                                .embeddingIndexSettings,
                            indexes.messageTextIndexSettings
                                .embeddingIndexSettings,
                            indexes.threadSettings,
                        ].some((lane) => lane?.embeddingModel !== undefined),
                    },
                ),
            );
            this.refreshSourceMessages(this.memory);
            await this.loadEligibility();
            if (hasSemanticIndex && this.memory?.messages.length === 0) {
                throw new Error(
                    `KnowPro semantic index has no messages: '${semanticIndexPath}'`,
                );
            }
        }
    }

    public async listSubjects(
        offset: number,
        limit: number,
        sourceIds: ReadonlySet<string>,
    ): Promise<MemoryPage<IndexedSubject>> {
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 48
        )
            throw new Error("Invalid indexed-subject page bounds");
        const memory = this.memory;
        const items = memory
            ? [...memory.semanticRefIndex.getTerms()].flatMap((term) => {
                  const subject = this.indexedSubject(memory, term, sourceIds);
                  return subject ? [subject] : [];
              })
            : [];
        items.sort(
            (a, b) =>
                (b.salience ?? b.postingCount) -
                    (a.salience ?? a.postingCount) ||
                b.sourceIds.length - a.sourceIds.length ||
                b.postingCount - a.postingCount ||
                a.term.localeCompare(b.term),
        );
        const remaining = new Set(items);
        const fair: IndexedSubject[] = [];
        while (remaining.size) {
            for (const sourceId of [...sourceIds].reverse()) {
                const candidate = [...remaining].find((item) =>
                    item.sourceIds.includes(sourceId),
                );
                if (candidate) {
                    remaining.delete(candidate);
                    fair.push(candidate);
                }
            }
        }
        const next = offset + limit;
        return {
            items: fair.slice(offset, next),
            total: items.length,
            ...(next < items.length
                ? { nextContinuationToken: String(next) }
                : {}),
        };
    }

    private indexedSubject(
        memory: DocMemory,
        term: string,
        sourceIds: ReadonlySet<string>,
    ): IndexedSubject | undefined {
        const sources = new Set<string>();
        let postingCount = 0;
        const supportWeights = new Map<string, number>();
        let initiative = false;
        const types = new Set<string>();
        const scopes = new Set<string>();
        const symbols = new Set<string>();
        const countedUserOrdinals = new Set<number>();
        for (const posting of memory.semanticRefIndex.lookupTerm(term)) {
            const ref = memory.semanticRefs.get(posting.semanticRefOrdinal);
            const messageOrdinal = ref.range.start.messageOrdinal;
            if (!this.eligible(messageOrdinal)) continue;
            const subject =
                ref.knowledgeType === "entity"
                    ? (ref.knowledge as EntityKnowledge).name
                    : ref.knowledgeType === "topic"
                      ? (ref.knowledge as TopicKnowledge).text
                      : undefined;
            if (
                !subject ||
                subject.toLocaleLowerCase() !== term.toLocaleLowerCase()
            )
                continue;
            const message = memory.messages.get(messageOrdinal);
            const source = parseSourceUri(message.metadata.sourceUrl);
            if (!source || !sourceIds.has(source.sourceId)) continue;
            const text = (message?.textChunks ?? []).join("\n");
            if (!usefulWikiSubject(subject, text)) continue;
            sources.add(source.sourceId);
            const identity = indexedSubjectIdentity(ref);
            identity.types.forEach((type) => types.add(type));
            identity.scopes.forEach((scope) => scopes.add(scope));
            identity.symbols?.forEach((symbol) => symbols.add(symbol));
            initiative ||= isInitiativeSubject(
                subject,
                initiativeKnowledgeTypes(ref),
                text,
            );
            const role = effectiveTermRole(message, text, subject);
            const echoUserOrdinal =
                role === "assistant"
                    ? findPrecedingUserEchoOrdinal(
                          memory,
                          messageOrdinal,
                          source.sourceId,
                          source.revisionId,
                          subject,
                      )
                    : undefined;
            const supportOrdinal = echoUserOrdinal ?? messageOrdinal;
            if (!countedUserOrdinals.has(supportOrdinal)) {
                countedUserOrdinals.add(supportOrdinal);
                postingCount++;
            }
            supportWeights.set(
                source.sourceId,
                Math.max(
                    supportWeights.get(source.sourceId) ?? 0,
                    roleSalienceWeight(
                        echoUserOrdinal !== undefined ? "user" : role,
                    ),
                ),
            );
        }
        const roundedSalience =
            Math.round(
                [...supportWeights.values()].reduce(
                    (sum, weight) => sum + weight,
                    0,
                ) * 100,
            ) / 100;
        return postingCount
            ? {
                  term: symbols.size === 1 ? [...symbols][0] : term,
                  postingCount,
                  ...(roundedSalience !== postingCount
                      ? { salience: roundedSalience }
                      : {}),
                  sourceIds: [...sources],
                  initiative,
                  identity: {
                      types: [...types].sort(),
                      scopes: [...scopes].sort(),
                      ...(symbols.size ? { symbols: [...symbols].sort() } : {}),
                  },
              }
            : undefined;
    }

    private *indexedBlocks(
        memory: DocMemory,
        scores?: ReadonlyMap<number, number>,
    ): Iterable<IndexedBlock> {
        const ordinals = new Map<string, number>();
        for (
            let messageOrdinal = 0;
            messageOrdinal < memory.messages.length;
            messageOrdinal++
        ) {
            const message = memory.messages.get(messageOrdinal);
            const source = parseSourceUri(message.metadata.sourceUrl);
            if (!source) continue;
            const key = `${source.sourceId}:${source.revisionId}`;
            const blockOrdinal = ordinals.get(key) ?? 0;
            ordinals.set(key, blockOrdinal + 1);
            if (!this.eligible(messageOrdinal)) continue;
            if (scores && !scores.has(messageOrdinal)) continue;
            yield {
                ...source,
                blockOrdinal,
                messageOrdinal,
                text: message.textChunks.join("\n"),
                score: scores?.get(messageOrdinal) ?? 1,
                ...(message.metadata.temporalContext
                    ? { temporalContext: message.metadata.temporalContext }
                    : {}),
            };
        }
    }

    public async readFragments(
        request: IndexedFragmentRequest,
    ): Promise<IndexedFragmentSelection> {
        const query = temporalQuestion(
            request.query ?? request.terms.join(" "),
            request.temporalContext,
        );
        const memory = this.memory;
        if (!memory) return { fragments: [], readChars: 0, limited: false };
        const ranges = this.eligibleRanges(new Set(request.sourceIds));
        const eligible = new Set(
            ranges.map((range) => range.start.messageOrdinal),
        );
        if (!eligible.size) return selectIndexedFragments([], request);
        const { requested, terms } = matchingIndexTerms(memory, request);
        const scores = collectPostingScores(
            memory,
            terms,
            requested,
            (ordinal) =>
                request.query ? eligible.has(ordinal) : this.eligible(ordinal),
            request.query ? eligible.size : this.eligibleRanges().length,
        );
        const postingScores = request.includeDiagnostics
            ? new Map(scores)
            : undefined;
        const languageScores = new Map<number, number>();
        const followed = this.sourceFollowingScores(request, scores);
        if (request.query) {
            const options = kp.createLanguageSearchOptionsTypical();
            options.maxMessageMatches = 8;
            options.maxKnowledgeMatches = 12;
            options.messageRangesInScope = ranges;
            options.fallbackRagOptions = { maxMessageMatches: 8 };
            const result = await memory.searchWithLanguage(query, options);
            if (!result.success) throw new Error(result.message);
            for (const match of result.data.flatMap(
                (item) => item.messageMatches,
            )) {
                if (!eligible.has(match.messageOrdinal)) continue;
                const score = Math.max(1, match.score);
                languageScores.set(
                    match.messageOrdinal,
                    (languageScores.get(match.messageOrdinal) ?? 0) + score,
                );
                scores.set(
                    match.messageOrdinal,
                    (scores.get(match.messageOrdinal) ?? 0) + score,
                );
            }
        }
        const preferred = new Set<number>();
        if (request.query)
            for (const ordinal of await this.preferredFollowupMessages(
                requested,
                memory,
                eligible,
            ))
                preferred.add(ordinal);
        const highest = Math.max(0, ...scores.values());
        for (const ordinal of preferred)
            scores.set(ordinal, highest + (scores.get(ordinal) ?? 0));
        if (
            request.query &&
            /\b(first|second|third|last|previous|next|earlier|later)\b/i.test(
                request.query,
            )
        )
            this.addConversationNeighbors(memory, eligible, scores);
        const blocks = [...this.indexedBlocks(memory, scores)];
        if (postingScores)
            this.fragmentScoreDiagnostics(
                blocks,
                postingScores,
                languageScores,
                preferred,
                highest,
            );
        const selection = selectIndexedFragments(
            blocks.sort((a, b) => b.score - a.score),
            {
                ...request,
                terms: request.query
                    ? [
                          ...new Set([
                              ...request.terms,
                              ...[...requested].filter(
                                  (term) => term.length <= 200,
                              ),
                          ]),
                      ]
                    : request.terms,
            },
        );
        selection.limited ||= followed.limited;
        if (selection.diagnostics)
            selection.diagnostics.limited = selection.limited;
        return selection;
    }

    private addConversationNeighbors(
        memory: DocMemory,
        eligible: Set<number>,
        scores: Map<number, number>,
    ): void {
        const sources = new Map<string, number>();
        const seeds = [...scores].sort((a, b) => b[1] - a[1]);
        for (const [ordinal, score] of seeds) {
            const uri = memory.messages.get(ordinal).metadata.sourceUrl;
            if (!uri) continue;
            const count = sources.get(uri) ?? 0;
            if (count >= 2 || (!count && sources.size >= 6)) continue;
            sources.set(uri, count + 1);
            for (const neighbor of this.conversationNeighbors(
                memory,
                eligible,
                ordinal,
                uri,
            ))
                scores.set(
                    neighbor,
                    Math.max(scores.get(neighbor) ?? 0, score / 2),
                );
        }
    }

    private *conversationNeighbors(
        memory: DocMemory,
        eligible: Set<number>,
        ordinal: number,
        uri: string,
    ): Iterable<number> {
        for (const direction of [-1, 1]) {
            let remaining = 2;
            let neighbor = ordinal + direction;
            while (
                remaining > 0 &&
                eligible.has(neighbor) &&
                memory.messages.get(neighbor).metadata.sourceUrl === uri
            ) {
                if (
                    memory.messages.get(neighbor).textChunks.join("\n").trim()
                ) {
                    yield neighbor;
                    remaining--;
                }
                neighbor += direction;
            }
        }
    }

    private fragmentScoreDiagnostics(
        blocks: IndexedBlock[],
        postingScores: Map<number, number>,
        languageScores: Map<number, number>,
        preferred: Set<number>,
        boost: number,
    ): void {
        for (const block of blocks) {
            const ordinal = block.messageOrdinal;
            if (ordinal === undefined)
                throw new Error("Indexed diagnostic block is unavailable");
            block.postingScore = postingScores.get(ordinal) ?? 0;
            block.languageScore = languageScores.get(ordinal) ?? 0;
            block.preferenceBoost = preferred.has(ordinal) ? boost : 0;
        }
    }

    private async preferredFollowupMessages(
        requested: Set<string>,
        memory: DocMemory,
        eligible: Set<number>,
    ): Promise<Set<number>> {
        const preferred = new Set<number>();
        const graph = await this.getKnowledgeGraph();
        const matchedSources = new Set(
            graph.entities
                .filter((item) =>
                    (
                        item.name
                            .toLocaleLowerCase()
                            .match(/[\p{L}\p{N}-]+/gu) ?? []
                    ).some((word) => requested.has(word)),
                )
                .flatMap((item) => item.sourceIds),
        );
        for (const entity of graph.entities.filter(
            (item) =>
                item.types.some((type) =>
                    /correction|follow.?up|qualification/i.test(type),
                ) &&
                item.sourceIds.some((sourceId) => matchedSources.has(sourceId)),
        )) {
            for (
                let ordinal = memory.messages.length - 1;
                ordinal >= 0;
                ordinal--
            ) {
                const source = parseSourceUri(
                    memory.messages.get(ordinal).metadata.sourceUrl,
                );
                if (
                    source &&
                    eligible.has(ordinal) &&
                    entity.sourceIds.includes(source.sourceId)
                )
                    preferred.add(ordinal);
            }
        }
        return preferred;
    }

    private sourceFollowingScores(
        request: IndexedFragmentRequest,
        scores: Map<number, number>,
    ): { limited: boolean } {
        const allowed = new Set(request.sourceIds);
        const sources = (request.followSources ?? []).flatMap((source) => {
            if (!allowed.has(source.sourceId)) return [];
            const messages = (
                this.sourceMessages.get(source.sourceId) ?? []
            ).filter(
                (entry) =>
                    entry.revisionId === source.revisionId &&
                    this.eligible(entry.messageOrdinal),
            );
            if (messages.some((entry) => scores.has(entry.messageOrdinal)))
                return [];
            return messages.length ? [messages] : [];
        });
        const score = Math.max(0, ...scores.values()) + 1;
        let admitted = 0;
        let limited = false;
        // Reanchor only known current dependencies, with one shared read budget.
        for (let rank = 0; rank < 4; rank++) {
            for (const messages of sources) {
                const entry = [
                    messages[0],
                    messages[messages.length - 1],
                    messages[Math.floor(messages.length / 2)],
                    messages[Math.floor(messages.length / 4)],
                ][rank];
                if (!entry || scores.has(entry.messageOrdinal)) continue;
                if (admitted === 4) {
                    limited = true;
                    continue;
                }
                scores.set(entry.messageOrdinal, score);
                admitted++;
            }
        }
        limited ||= sources.some((messages) =>
            messages.some((entry) => !scores.has(entry.messageOrdinal)),
        );
        return { limited };
    }

    public async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ): Promise<string> {
        const anchor = parseIndexedLocator(locator);
        const memory = this.memory;
        if (memory)
            for (const block of this.indexedBlocks(memory)) {
                if (
                    block.sourceId === sourceId &&
                    block.revisionId === revisionId &&
                    block.blockOrdinal === anchor.blockOrdinal &&
                    indexedTextHash(block.text) === anchor.hash &&
                    anchor.end <= block.text.length
                )
                    return block.text.slice(anchor.start, anchor.end);
            }
        throw new Error(
            "Indexed-text anchor is unavailable in the current index",
        );
    }

    public async rebuildRetained(
        previous: CorpusIndex,
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<boolean> {
        signal.throwIfAborted();
        const unavailable = (reason: string): false => {
            console.warn(
                `Memory retained-index reuse unavailable: ${reason}; rebuilding canonical retained sources`,
            );
            return false;
        };
        if (
            !(previous instanceof KnowProCorpusIndex) ||
            previous.corpusId !== this.corpusId
        )
            return unavailable("Incompatible corpus index");
        if (!documents.length) {
            await this.rebuild(documents, signal, onProgress);
            return true;
        }
        if (!previous.memory) await previous.initialize();
        const source = previous.memory;
        if (!source?.hasCompleteIndex)
            return unavailable(
                "Committed indexing completion is unknown or partial",
            );
        if (
            documents.some(
                (document) =>
                    previous.activeRevisions.get(document.source.sourceId) !==
                    document.revision.revisionId,
            )
        )
            return unavailable("Retained revision eligibility changed");
        const parts = documents.flatMap(toDocParts);
        const memory = new DocMemory(this.corpusId, [], this.createSettings());
        const settings = memory.settings.conversationSettings;
        const projection = projectRetainedIndex(
            await source.serialize(),
            parts,
            {
                related:
                    settings.relatedTermIndexSettings.embeddingIndexSettings
                        ?.embeddingModel !== undefined,
                message:
                    settings.messageTextIndexSettings.embeddingIndexSettings
                        .embeddingModel !== undefined,
            },
        );
        if (!projection.data) return unavailable(projection.reason);
        signal.throwIfAborted();
        await memory.deserialize(projection.data);
        if (projection.missingTermVectors) {
            console.warn(
                `Memory retained-index projection requires ${projection.missingTermVectors} missing retained term vectors; backfilling without knowledge extraction`,
            );
            await onProgress({
                completed: 0,
                total: projection.missingTermVectors,
                stage: "embedding",
                operation: "rebuild",
                message: "Backfilling missing retained term vectors",
                documentCount: documents.length,
                docPartCount: parts.length,
            });
        }
        const result = await kp.buildRelatedTermsIndex(
            memory,
            settings.relatedTermIndexSettings,
        );
        if (result.error) throw new Error(result.error);
        signal.throwIfAborted();
        await onProgress({
            completed: parts.length,
            total: parts.length,
            stage: "persisting",
            operation: "rebuild",
            message: "Persisting projected retained-source index",
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        await memory.writeToFile(this.indexDirectory, indexBaseName, true);
        signal.throwIfAborted();
        this.memory = memory;
        this.refreshSourceMessages(memory);
        this.activeRevisions = new Map(
            documents.map((document) => [
                document.source.sourceId,
                document.revision.revisionId,
            ]),
        );
        await this.saveEligibility();
        return true;
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const startedAt = performance.now();
        const parts = kp.timeSearchStage(
            "ingestion.document.prepare",
            () => documents.flatMap(toDocParts),
            { count: documents.length },
        );
        await onProgress({
            completed: parts.length,
            total: parts.length,
            message: "Documents chunked",
            stage: "chunking",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        if (documents.length === 0) {
            await kp.removeConversationData(this.indexDirectory, indexBaseName);
            this.memory = undefined;
            this.activeRevisions.clear();
            await rm(path.join(this.indexDirectory, "eligibility.json"), {
                force: true,
            });
            this.refreshSourceMessages();
            await onProgress({
                completed: parts.length,
                total: parts.length,
                message: "Index persisted",
                stage: "persisting",
                operation: "rebuild",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            });
            return;
        }
        const memory = new DocMemory(
            this.corpusId,
            parts,
            this.createSettings(),
        );
        let completed = 0;
        let progressTail = Promise.resolve();
        const total = Math.max(parts.length, 1);
        const report = (
            message: string,
            stage: NonNullable<JobProgress["stage"]>,
        ): boolean => {
            if (signal.aborted) {
                return false;
            }
            completed = Math.min(completed + 1, total);
            const progress: JobProgress = {
                completed,
                total,
                message,
                stage,
                operation: "rebuild",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            };
            progressTail = progressTail.then(() => onProgress(progress));
            return true;
        };
        const result = await kp.timeSearchStage("knowpro.index.prepare", () =>
            memory.buildIndex({
                onKnowledgeExtracted: () =>
                    report("Extracting knowledge", "extracting-knowledge"),
                onEmbeddingsCreated: () =>
                    report("Creating embeddings", "embedding"),
                onTextIndexed: () =>
                    report("Indexing text", "building-indexes"),
            }),
        );
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ingestion cancelled");
        }
        const indexingError =
            result.semanticRefs?.error ??
            result.secondaryIndexResults?.message?.error ??
            result.secondaryIndexResults?.relatedTerms?.error;
        if (indexingError !== undefined) {
            throw new Error(indexingError);
        }
        await progressTail;
        await onProgress({
            completed: total,
            total,
            message: "Persisting index",
            stage: "persisting",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        await kp.timeSearchStage("ingestion.index.persist", () =>
            memory.writeToFile(this.indexDirectory, indexBaseName, true),
        );
        this.memory = memory;
        this.refreshSourceMessages(memory);
        this.activeRevisions = new Map(
            documents.map((document) => [
                document.source.sourceId,
                document.revision.revisionId,
            ]),
        );
        await this.saveEligibility();
        await onProgress({
            completed: total,
            total,
            message: "Index persisted",
            stage: "persisting",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
    }

    public async append(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const startedAt = performance.now();
        await this.initialize();
        const parts = kp.timeSearchStage(
            "ingestion.document.prepare",
            () => documents.flatMap(toDocParts),
            { count: documents.length },
        );
        this.memory ??= new DocMemory(this.corpusId, [], this.createSettings());
        await onProgress({
            completed: parts.length,
            total: parts.length,
            message: "Documents chunked",
            stage: "chunking",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        const messages = this.memory.messages;
        kp.timeSearchStage(
            "ingestion.index.populate",
            () => {
                for (const part of parts) messages.append(part);
            },
            { count: parts.length },
        );
        let completed = 0;
        let progressTail = Promise.resolve();
        const total = Math.max(parts.length, 1);
        const report = (
            message: string,
            stage: NonNullable<JobProgress["stage"]>,
        ): boolean => {
            if (signal.aborted) {
                return false;
            }
            completed = Math.min(completed + 1, total);
            const progress: JobProgress = {
                completed,
                total,
                message,
                stage,
                operation: "append",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            };
            progressTail = progressTail.then(() => onProgress(progress));
            return true;
        };
        const memory = this.memory;
        const result = await kp.timeSearchStage("knowpro.index.prepare", () =>
            memory.addToIndex({
                onKnowledgeExtracted: () =>
                    report("Extracting knowledge", "extracting-knowledge"),
                onEmbeddingsCreated: () =>
                    report("Creating embeddings", "embedding"),
                onTextIndexed: () =>
                    report("Indexing text", "building-indexes"),
            }),
        );
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ingestion cancelled");
        }
        const indexingError =
            result.semanticRefs?.error ??
            result.secondaryIndexResults?.message?.error ??
            result.secondaryIndexResults?.relatedTerms?.error;
        if (indexingError !== undefined) {
            throw new Error(indexingError);
        }
        await progressTail;
        await onProgress({
            completed: total,
            total,
            message: "Persisting index",
            stage: "persisting",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        await kp.timeSearchStage("ingestion.index.persist", () =>
            memory.writeToFile(this.indexDirectory, indexBaseName, true),
        );
        this.refreshSourceMessages(this.memory);
        for (const document of documents)
            this.activeRevisions.set(
                document.source.sourceId,
                document.revision.revisionId,
            );
        await this.saveEligibility();
        await onProgress({
            completed: total,
            total,
            message: "Index persisted",
            stage: "persisting",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
    }

    public async search(
        query: string,
        limit: number,
        tags?: string[],
        temporalContext?: kp.TemporalQueryContext,
    ): Promise<CorpusIndexMatch[]> {
        return kp.timeSearchStage(
            "knowpro.index.search",
            () =>
                this.searchCore(
                    temporalQuestion(query, temporalContext),
                    limit,
                    tags,
                ),
            { limit, tagCount: tags?.length ?? 0 },
        );
    }

    public async replace(
        document: IndexedDocument,
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        await this.initialize();
        signal.throwIfAborted();
        if (
            !this.sourceMessages
                .get(document.source.sourceId)
                ?.some(
                    (message) =>
                        message.revisionId === document.revision.revisionId,
                )
        ) {
            await this.append([document], signal, onProgress);
        } else {
            this.activeRevisions.set(
                document.source.sourceId,
                document.revision.revisionId,
            );
            await this.saveEligibility();
        }
    }

    private async searchCore(
        query: string,
        limit: number,
        tags?: string[],
    ): Promise<CorpusIndexMatch[]> {
        const matches = new Map<number, number>();
        const memory = this.memory;
        if (memory !== undefined) {
            const options = kp.createLanguageSearchOptionsTypical();
            options.maxMessageMatches = limit;
            options.maxKnowledgeMatches = limit;
            options.messageRangesInScope = this.eligibleRanges();
            const result = await kp.timeSearchStage(
                "knowpro.index.languageSearch",
                () =>
                    memory.searchWithLanguage(
                        query,
                        options,
                        tags === undefined ? undefined : { tags },
                    ),
            );
            if (!result.success) {
                throw new Error(result.message);
            }
            for (const searchResult of result.data) {
                for (const match of searchResult.messageMatches) {
                    const previous = matches.get(match.messageOrdinal);
                    if (previous === undefined || match.score > previous) {
                        matches.set(match.messageOrdinal, match.score);
                    }
                }
            }
        }
        return this.toCorpusMatches(matches, limit);
    }

    private toCorpusMatches(
        matches: ReadonlyMap<number, number>,
        limit: number,
    ): CorpusIndexMatch[] {
        return [...matches]
            .sort((left, right) => right[1] - left[1])
            .slice(0, limit)
            .flatMap(([messageOrdinal, score]) => {
                const message = this.memory?.messages.get(messageOrdinal);
                const source = parseSourceUri(message?.metadata.sourceUrl);
                if (message === undefined || source === undefined) {
                    return [];
                }
                return [
                    {
                        ...source,
                        snippet: message.textChunks.join("\n"),
                        ...(message.metadata.temporalContext
                            ? {
                                  temporalContext:
                                      message.metadata.temporalContext,
                              }
                            : {}),
                        score,
                        locator: `message:${messageOrdinal}`,
                    },
                ];
            });
    }

    public async answer(
        query: string,
        limit: number,
        sourceIds?: ReadonlySet<string>,
        temporalContext?: kp.TemporalQueryContext,
        includeDiagnostics = false,
    ): Promise<CorpusIndexAnswer> {
        query = temporalQuestion(query, temporalContext);
        const memory = this.memory;
        if (memory === undefined) {
            return { matches: [], whyNoAnswer: "The corpus has no index." };
        }
        const options = kp.createLanguageSearchOptionsTypical();
        options.messageRangesInScope = this.eligibleRanges(sourceIds);
        options.maxMessageMatches = limit;
        options.maxKnowledgeMatches = limit;
        const queryPlan: kp.LanguageSearchDebugContext | undefined =
            includeDiagnostics ? {} : undefined;
        const searched = await memory.searchWithLanguage(
            query,
            options,
            undefined,
            queryPlan,
        );
        if (!searched.success) {
            throw new Error(searched.message);
        }
        const matches = new Map<number, number>();
        const readMessages = new Set<number>();
        const readKnowledge = new Set<number>();
        const readerContext: AnswerContextDiagnostics = {
            answerPath: "knowpro",
            retrievedMessageOrdinals: [],
            messageOrdinals: [],
            knowledgeMessageOrdinals: [],
            completedChunks: 0,
            serializedContextChars: 0,
            retrievedSourceIds: [],
            messageSourceIds: [],
            knowledgeSourceIds: [],
            ...(queryPlan === undefined
                ? {}
                : { queryPlan, chunks: [], combinations: [] }),
        };
        const scopedResults: kp.ConversationSearchResult[] = [];
        for (const searchResult of searched.data) {
            let scoped = searchResult;
            if (sourceIds !== undefined) {
                scoped = {
                    ...searchResult,
                    knowledgeMatches: new Map(),
                    messageMatches: searchResult.messageMatches.filter(
                        (match) => {
                            const source = parseSourceUri(
                                memory.messages.get(match.messageOrdinal)
                                    ?.metadata.sourceUrl,
                            );
                            return (
                                source !== undefined &&
                                sourceIds.has(source.sourceId)
                            );
                        },
                    ),
                };
            }
            for (const match of scoped.messageMatches) {
                const previous = matches.get(match.messageOrdinal);
                if (previous === undefined || match.score > previous) {
                    matches.set(match.messageOrdinal, match.score);
                }
            }
            if (
                scoped.messageMatches.length === 0 &&
                scoped.knowledgeMatches.size === 0
            ) {
                continue;
            }
            scopedResults.push(scoped);
        }
        let response: kp.AnswerResponse | undefined;
        if (scopedResults.length) {
            const generated = await memory.getAnswerFromSearchResults(
                scopedResults,
                query,
                (context, _index, result) => {
                    if (!result.success) return;
                    readerContext.completedChunks++;
                    readerContext.serializedContextChars +=
                        kp.answerContextToString(context).length;
                    readerContext.chunks?.push({
                        ordinal: readerContext.chunks.length,
                        messageOrdinals: [
                            ...new Set(
                                (context.messages ?? []).flatMap(
                                    (message) =>
                                        message.sourceMessageOrdinals ?? [],
                                ),
                            ),
                        ],
                        semanticRefOrdinals: [
                            ...new Set(
                                [
                                    ...(context.entities ?? []),
                                    ...(context.topics ?? []),
                                ].flatMap(
                                    (knowledge) =>
                                        knowledge.evidence?.map(
                                            (evidence) =>
                                                evidence.semanticRefOrdinal,
                                        ) ?? [],
                                ),
                            ),
                        ],
                        serializedChars:
                            kp.answerContextToString(context).length,
                        response: result.data,
                    });
                    for (const message of context.messages ?? []) {
                        for (const ordinal of message.sourceMessageOrdinals ??
                            [])
                            readMessages.add(ordinal);
                    }
                    for (const knowledge of [
                        ...(context.entities ?? []),
                        ...(context.topics ?? []),
                    ]) {
                        for (const ordinal of knowledge.sourceMessageOrdinals ??
                            [])
                            readKnowledge.add(ordinal);
                    }
                },
                includeDiagnostics
                    ? {
                          onCombination: (inputs, output) => {
                              readerContext.combinations!.push({
                                  ordinal: readerContext.combinations!.length,
                                  inputs,
                                  output,
                              });
                          },
                      }
                    : undefined,
            );
            if (!generated.success) {
                throw new Error(generated.message);
            }
            response = generated.data;
        }
        return {
            matches: this.toCorpusMatches(
                new Map(
                    [...new Set([...readMessages, ...readKnowledge])].map(
                        (ordinal) => [ordinal, matches.get(ordinal) ?? 0],
                    ),
                ),
                limit,
            ),
            answer: response?.type === "Answered" ? response.answer : undefined,
            whyNoAnswer: response?.whyNoAnswer,
            readerContext: {
                ...readerContext,
                retrievedMessageOrdinals: [...matches.keys()],
                messageOrdinals: [...readMessages],
                knowledgeMessageOrdinals: [...readKnowledge],
                retrievedSourceIds: this.toCorpusMatches(
                    matches,
                    matches.size,
                ).map((match) => match.sourceId),
                messageSourceIds: this.toCorpusMatches(
                    new Map(
                        [...readMessages].map((ordinal) => [
                            ordinal,
                            matches.get(ordinal) ?? 0,
                        ]),
                    ),
                    readMessages.size,
                ).map((match) => match.sourceId),
                knowledgeSourceIds: this.toCorpusMatches(
                    new Map(
                        [...readKnowledge].map((ordinal) => [
                            ordinal,
                            matches.get(ordinal) ?? 0,
                        ]),
                    ),
                    readKnowledge.size,
                ).map((match) => match.sourceId),
            },
        };
    }

    public async getTopicOccurrences(
        sourceIds: ReadonlySet<string>,
    ): Promise<TopicOccurrence[]> {
        if (!this.memory) return [];
        const blocks = [...this.indexedBlocks(this.memory)];
        const bySource = new Map(
            blocks.map((block) => [
                `${block.sourceId}\n${block.revisionId}\n${block.blockOrdinal}`,
                block,
            ]),
        );
        const messageBlocks = new Map<number, IndexedBlock>();
        const ordinals = new Map<string, number>();
        for (
            let ordinal = 0;
            ordinal < this.memory.messages.length;
            ordinal++
        ) {
            const source = parseSourceUri(
                this.memory.messages.get(ordinal).metadata.sourceUrl,
            );
            if (!source) continue;
            const key = `${source.sourceId}\n${source.revisionId}`;
            const blockOrdinal = ordinals.get(key) ?? 0;
            ordinals.set(key, blockOrdinal + 1);
            const block = bySource.get(`${key}\n${blockOrdinal}`);
            if (block) messageBlocks.set(ordinal, block);
        }
        const occurrences: TopicOccurrence[] = [];
        const occurrenceOrdinals = new Map<string, number>();
        for (const ref of this.memory.semanticRefs ?? []) {
            if (ref.knowledgeType !== "topic") continue;
            const label = (ref.knowledge as TopicKnowledge).text.trim();
            if (!label) continue;
            const start = ref.range.start.messageOrdinal;
            const end = ref.range.end
                ? ref.range.end.messageOrdinal -
                  (ref.range.end.chunkOrdinal ? 0 : 1)
                : start;
            for (
                let messageOrdinal = start;
                messageOrdinal <= end;
                messageOrdinal++
            ) {
                const block = messageBlocks.get(messageOrdinal);
                if (
                    !block ||
                    !sourceIds.has(block.sourceId) ||
                    !block.text.length
                )
                    continue;
                const key = JSON.stringify([
                    block.sourceId,
                    block.revisionId,
                    block.blockOrdinal,
                    label.toLowerCase(),
                ]);
                const ordinal = occurrenceOrdinals.get(key) ?? 0;
                occurrenceOrdinals.set(key, ordinal + 1);
                occurrences.push(indexedTopicOccurrence(block, label, ordinal));
            }
        }
        return occurrences;
    }

    public async readKnowledgeGraph(
        sourceIds: ReadonlySet<string>,
        kind: "entities" | "topics",
        excludedNamesBySource?: ReadonlyMap<string, ReadonlySet<string>>,
    ): Promise<MemoryKnowledgeGraph> {
        return this.collectKnowledgeGraph(
            sourceIds,
            kind,
            excludedNamesBySource,
        );
    }

    public async getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph> {
        return this.collectKnowledgeGraph(sourceIds);
    }

    private async collectKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
        boundedKind?: "entities" | "topics",
        excludedNamesBySource?: ReadonlyMap<string, ReadonlySet<string>>,
    ): Promise<MemoryKnowledgeGraph> {
        if (this.memory === undefined) {
            return { entities: [], topics: [], relationships: [] };
        }
        const entities = new Map<
            string,
            {
                name: string;
                types: Set<string>;
                mentionCount: number;
                sourceIds: Set<string>;
            }
        >();
        const topics = new Map<
            string,
            {
                name: string;
                mentionCount: number;
                sourceIds: Set<string>;
            }
        >();
        const relationships = new Map<
            string,
            {
                fromEntity: string;
                toEntity: string;
                relationshipType: string;
                count: number;
                sourceIds: Set<string>;
            }
        >();

        let examined = 0;
        const countedTopicUserOrdinals = new Map<string, Set<number>>();
        const countedEntityUserOrdinals = new Map<string, Set<number>>();
        for (const semanticRef of this.memory.semanticRefs ?? []) {
            if (
                !admitGraphReference(
                    boundedKind,
                    ++examined,
                    semanticRef.knowledgeType,
                    entities.size + topics.size,
                    relationships.size,
                )
            )
                continue;
            const messageOrdinal = semanticRef.range.start.messageOrdinal;
            const sourceId = this.graphReferenceSource(
                messageOrdinal,
                semanticRef.knowledgeType,
                semanticRef.knowledge,
                sourceIds,
                excludedNamesBySource,
            );
            if (sourceId === undefined) continue;
            if (semanticRef.knowledgeType === "entity") {
                const entity = semanticRef.knowledge as EntityKnowledge;
                const key = entity.name.trim().toLocaleLowerCase();
                if (key.length === 0) {
                    continue;
                }
                const aggregate = entities.get(key) ?? {
                    name: entity.name.trim(),
                    types: new Set<string>(),
                    mentionCount: 0,
                    sourceIds: new Set<string>(),
                };
                const counted =
                    countedEntityUserOrdinals.get(key) ?? new Set<number>();
                countedEntityUserOrdinals.set(key, counted);
                aggregate.mentionCount += countIndependentMention(
                    this.memory,
                    messageOrdinal,
                    entity.name,
                    counted,
                );
                entity.type.forEach((type) => aggregate.types.add(type));
                aggregate.sourceIds.add(sourceId);
                entities.set(key, aggregate);
            } else if (semanticRef.knowledgeType === "topic") {
                const name = (
                    semanticRef.knowledge as TopicKnowledge
                ).text.trim();
                const key = name.toLocaleLowerCase();
                if (key.length === 0) {
                    continue;
                }
                const aggregate = topics.get(key) ?? {
                    name,
                    mentionCount: 0,
                    sourceIds: new Set<string>(),
                };
                const counted =
                    countedTopicUserOrdinals.get(key) ?? new Set<number>();
                countedTopicUserOrdinals.set(key, counted);
                aggregate.mentionCount += countIndependentMention(
                    this.memory,
                    messageOrdinal,
                    name,
                    counted,
                );
                aggregate.sourceIds.add(sourceId);
                topics.set(key, aggregate);
            } else if (semanticRef.knowledgeType === "action") {
                const action = semanticRef.knowledge as ActionKnowledge;
                const fromEntity = action.subjectEntityName.trim();
                const toEntity = action.objectEntityName.trim();
                if (
                    fromEntity.toLocaleLowerCase() === "none" ||
                    toEntity.toLocaleLowerCase() === "none"
                ) {
                    continue;
                }
                const relationshipType = action.verbs.join(" ").trim();
                const key = `${fromEntity.toLocaleLowerCase()}\0${toEntity.toLocaleLowerCase()}\0${relationshipType.toLocaleLowerCase()}`;
                const aggregate = relationships.get(key) ?? {
                    fromEntity,
                    toEntity,
                    relationshipType,
                    count: 0,
                    sourceIds: new Set<string>(),
                };
                aggregate.count++;
                aggregate.sourceIds.add(sourceId);
                relationships.set(key, aggregate);
            }
        }
        admitGraphReference(
            boundedKind,
            examined,
            "",
            entities.size + topics.size,
            relationships.size,
        );
        return {
            entities: [...entities.values()].map((entity) => ({
                ...entity,
                types: [...entity.types],
                sourceIds: [...entity.sourceIds],
            })),
            topics: [...topics.values()].map((topic) => ({
                ...topic,
                sourceIds: [...topic.sourceIds],
            })),
            relationships: [...relationships.values()].map((relationship) => ({
                ...relationship,
                sourceIds: [...relationship.sourceIds],
            })),
        };
    }
    private graphReferenceSource(
        ordinal: number,
        knowledgeType: string,
        knowledge: unknown,
        sourceIds: ReadonlySet<string> | undefined,
        excludedNamesBySource:
            | ReadonlyMap<string, ReadonlySet<string>>
            | undefined,
    ): string | undefined {
        const source = parseSourceUri(
            this.memory?.messages.get(ordinal)?.metadata.sourceUrl,
        );
        if (
            !source ||
            this.activeRevisions.get(source.sourceId) !== source.revisionId ||
            (sourceIds && !sourceIds.has(source.sourceId)) ||
            excludedGraphKnowledge(
                knowledge,
                excludedNamesBySource?.get(source.sourceId),
            ) ||
            excludedGraphKnowledge(
                knowledge,
                excludedNamesBySource?.get(
                    `${source.sourceId}\0${knowledgeType === "topic" ? "topic" : "entity"}`,
                ),
            )
        )
            return undefined;
        return source.sourceId;
    }
}

export function createKnowProCorpusIndex(
    corpusId: string,
    indexDirectory: string,
    settingsFactory?: () => DocMemorySettings,
): CorpusIndex {
    return new KnowProCorpusIndex(corpusId, indexDirectory, settingsFactory);
}
