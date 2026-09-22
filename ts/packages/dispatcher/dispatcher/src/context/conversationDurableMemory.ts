// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEvent,
    MemoryEventAppendRequest,
    MemoryEventForgetResult,
    MemoryEventSearchMatch,
    MemoryService,
} from "@typeagent/memory-service";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:memory");

export const conversationCorpusName = "typeagent-profile-conversations";
export const conversationProducerId = "typeagent.dispatcher.conversation";

export type ConversationDurableEventType =
    | "user-turn"
    | "assistant-evidence"
    | "verified-action-result"
    | "explicit-decision"
    | "task-outcome";

export interface ConversationDurableMemoryOptions {
    service: MemoryService;
    conversationId: string;
    runId: string;
    now?: () => Date;
}

export interface ConversationMemoryEvidence {
    event: MemoryEvent;
    snippet: string;
    score: number;
    authoritative: boolean;
}

export async function searchDurableConversationMemory(
    context: {
        conversationDurableMemory?: ConversationDurableMemory | undefined;
    },
    question: string,
    scope?: "current" | "all",
): Promise<string | undefined> {
    const memory = context.conversationDurableMemory;
    if (memory === undefined) {
        return undefined;
    }
    try {
        if (scope !== "all") {
            const current = await memory.search(question, "current");
            if (current.length > 0 || scope === "current") {
                return current.length === 0
                    ? undefined
                    : formatConversationEvidence(current);
            }
        }
        const all = await memory.search(question, "all");
        return all.length === 0 ? undefined : formatConversationEvidence(all);
    } catch (error) {
        debug(`Durable conversation memory unavailable: ${String(error)}`);
        return undefined;
    }
}

/**
 * Profile-scoped conversation event producer.
 *
 * The supplied service is itself rooted in one profile. This adapter always
 * resolves one fixed corpus and never accepts a caller-provided corpus ID,
 * preventing conversation data from crossing profile/corpus boundaries.
 */
export class ConversationDurableMemory {
    private readonly now: () => Date;
    private readonly corpusIdPromise: Promise<string>;
    private writeTail: Promise<void> = Promise.resolve();
    private eventSequence = 0;
    private writeError: unknown;

    public constructor(
        private readonly options: ConversationDurableMemoryOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.corpusIdPromise = this.resolveCorpus();
    }

    public recordUserTurn(content: string, turnId: string): void {
        this.enqueue("user-turn", content, turnId, "user", undefined, {
            authority: "user-assertion",
        });
    }

    public recordAssistantEvidence(
        content: string,
        turnId: string,
        actionName?: string,
    ): void {
        this.enqueue(
            "assistant-evidence",
            content,
            turnId,
            "assistant",
            actionName,
            { authority: "evidence-only" },
        );
    }

    public recordActionResult(
        content: string,
        turnId: string,
        actionName: string,
        succeeded: boolean,
    ): void {
        this.enqueue(
            "verified-action-result",
            content,
            turnId,
            "tool",
            actionName,
            {
                authority: "verified-observation",
                outcome: succeeded ? "succeeded" : "failed",
            },
        );
    }

    public recordDecision(content: string, turnId: string): void {
        this.enqueue("explicit-decision", content, turnId, "agent", undefined, {
            authority: "explicit",
        });
    }

    public recordTaskOutcome(
        content: string,
        turnId: string,
        actionName?: string,
    ): void {
        this.enqueue("task-outcome", content, turnId, "agent", actionName, {
            authority: "verified-observation",
        });
    }

    public async flush(): Promise<void> {
        await this.writeTail;
        if (this.writeError !== undefined) {
            const error = this.writeError;
            this.writeError = undefined;
            throw error;
        }
    }

    public async inspectTurn(turnId: string): Promise<MemoryEvent[]> {
        await this.flush();
        const corpusId = await this.corpusIdPromise;
        const events = await this.listAllEvents(corpusId, [
            this.options.conversationId,
        ]);
        return events.filter((event) => event.turnId === turnId);
    }

    public async inspectConversation(
        conversationId = this.options.conversationId,
    ): Promise<MemoryEvent[]> {
        await this.flush();
        const corpusId = await this.corpusIdPromise;
        return this.listAllEvents(corpusId, [conversationId]);
    }

    public async forgetTurn(turnId: string): Promise<MemoryEventForgetResult> {
        const events = await this.inspectTurn(turnId);
        return this.forgetEventIds(events.map((event) => event.eventId));
    }

    public async forgetConversation(
        conversationId = this.options.conversationId,
    ): Promise<MemoryEventForgetResult> {
        await this.flush();
        const corpusId = await this.corpusIdPromise;
        return this.options.service.forgetEvents({
            corpusId,
            producerIds: [conversationProducerId],
            conversationIds: [conversationId],
        });
    }

    public async search(
        question: string,
        scope: "current" | "all" = "all",
        limit = 10,
    ): Promise<ConversationMemoryEvidence[]> {
        await this.flush();
        const corpusId = await this.corpusIdPromise;
        const conversationIds =
            scope === "current" ? [this.options.conversationId] : undefined;
        const searches = searchTerms(question).map((query) =>
            this.options.service.searchEvents({
                corpusId,
                query,
                limit,
                producerIds: [conversationProducerId],
                ...(conversationIds === undefined ? {} : { conversationIds }),
            }),
        );
        const results = await Promise.all(searches);
        const matches = new Map<string, MemoryEventSearchMatch>();
        for (const result of results) {
            for (const match of result.matches) {
                const previous = matches.get(match.event.eventId);
                if (previous === undefined || match.score > previous.score) {
                    matches.set(match.event.eventId, match);
                }
            }
        }
        return [...matches.values()]
            .sort(
                (left, right) =>
                    right.score - left.score ||
                    Date.parse(right.event.eventTime) -
                        Date.parse(left.event.eventTime),
            )
            .slice(0, limit)
            .map((match) => ({
                ...match,
                authoritative: match.event.eventType !== "assistant-evidence",
            }));
    }

    private async resolveCorpus(): Promise<string> {
        const existing = (await this.options.service.listCorpora()).find(
            (corpus) => corpus.name === conversationCorpusName,
        );
        if (existing !== undefined) {
            return existing.corpusId;
        }
        const created = await this.options.service.createCorpus(
            conversationCorpusName,
            "Profile-scoped conversation turns and verified outcomes",
        );
        return created.corpusId;
    }

    private enqueue(
        eventType: ConversationDurableEventType,
        content: string,
        turnId: string,
        sender: "user" | "assistant" | "tool" | "agent",
        actionName: string | undefined,
        metadata: Record<string, unknown>,
    ): void {
        const timestamp = this.now().toISOString();
        const sequence = this.eventSequence++;
        const request: MemoryEventAppendRequest = {
            corpusId: "",
            idempotencyKey: [
                this.options.conversationId,
                this.options.runId,
                turnId,
                eventType,
                actionName ?? "",
                sequence,
            ].join(":"),
            producer: {
                producerId: conversationProducerId,
                producerType: "conversation-producer",
            },
            eventType,
            sourceKind: "conversation",
            observedAt: timestamp,
            eventTime: timestamp,
            content,
            conversationId: this.options.conversationId,
            runId: this.options.runId,
            turnId,
            sender,
            metadata,
            ...(actionName === undefined ? {} : { actionName }),
        };
        this.writeTail = this.writeTail
            .then(async () => {
                request.corpusId = await this.corpusIdPromise;
                await this.options.service.appendEvent(request);
            })
            .catch((error: unknown) => {
                this.writeError = error;
            });
    }

    private async listAllEvents(
        corpusId: string,
        conversationIds: string[],
    ): Promise<MemoryEvent[]> {
        const events: MemoryEvent[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.options.service.listEvents({
                corpusId,
                conversationIds,
                pageSize: 100,
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
            events.push(...page.items);
            continuationToken = page.nextContinuationToken;
        } while (continuationToken !== undefined);
        return events;
    }

    private async forgetEventIds(
        eventIds: string[],
    ): Promise<MemoryEventForgetResult> {
        const corpusId = await this.corpusIdPromise;
        if (eventIds.length === 0) {
            return {
                corpusId,
                deletedEventCount: 0,
                deletedSourceCount: 0,
                retainedLinkedSourceIds: [],
                indexVersion: "unchanged",
            };
        }
        return this.options.service.forgetEvents({ corpusId, eventIds });
    }
}

export function getMemoryServiceFromAgentOptions(
    options: Record<string, unknown> | undefined,
): MemoryService | undefined {
    const memoryOptions = options?.memory;
    if (
        typeof memoryOptions !== "object" ||
        memoryOptions === null ||
        !("memoryServiceClient" in memoryOptions)
    ) {
        return undefined;
    }
    const service = memoryOptions.memoryServiceClient;
    return isMemoryService(service) ? service : undefined;
}

export function formatConversationEvidence(
    evidence: ConversationMemoryEvidence[],
): string {
    return evidence
        .map(({ event, snippet, authoritative }) => {
            const authority = authoritative
                ? "verified/explicit evidence"
                : "assistant prose (evidence only; not authoritative fact)";
            const source = [
                `event=${event.eventId}`,
                `conversation=${event.conversationId ?? "unknown"}`,
                `run=${event.runId ?? "unknown"}`,
                `turn=${event.turnId ?? "unknown"}`,
                `sender=${event.sender ?? "unknown"}`,
                `time=${event.eventTime}`,
            ].join(", ");
            return `- ${snippet.trim()}\n  Source: ${source}; ${authority}`;
        })
        .join("\n");
}

function searchTerms(question: string): string[] {
    const normalized = question.trim();
    const words = normalized
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}._'-]*/gu)
        ?.filter((word) => word.length > 2 && !stopWords.has(word));
    return [...new Set([normalized, ...(words ?? [])])].slice(0, 8);
}

function isMemoryService(value: unknown): value is MemoryService {
    return (
        typeof value === "object" &&
        value !== null &&
        "appendEvent" in value &&
        typeof value.appendEvent === "function" &&
        "searchEvents" in value &&
        typeof value.searchEvents === "function" &&
        "listEvents" in value &&
        typeof value.listEvents === "function" &&
        "forgetEvents" in value &&
        typeof value.forgetEvents === "function" &&
        "listCorpora" in value &&
        typeof value.listCorpora === "function" &&
        "createCorpus" in value &&
        typeof value.createCorpus === "function"
    );
}

const stopWords = new Set([
    "and",
    "are",
    "did",
    "for",
    "from",
    "how",
    "the",
    "this",
    "was",
    "what",
    "when",
    "where",
    "who",
    "with",
]);
