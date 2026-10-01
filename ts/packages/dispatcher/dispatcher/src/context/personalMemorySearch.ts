// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEvidence,
    MemoryService,
    PersonalHowToService,
    ProcedureSearchMatch,
} from "@typeagent/memory-service";
import registerDebug from "debug";
import {
    ConversationMessage,
    ConversationMessageMeta,
    type ConversationMemory,
} from "@typeagent/conversation-memory";
import type { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    conversationCorpusName,
    searchDurableConversationMemory,
} from "./conversationDurableMemory.js";

const debug = registerDebug("typeagent:dispatcher:memory");
type SearchService = Pick<MemoryService, "listCorpora" | "search"> &
    Partial<Pick<PersonalHowToService, "searchProcedures">>;
function distinctEvidence(
    matches: { name: string; evidence: MemoryEvidence }[],
): { name: string; evidence: MemoryEvidence }[] {
    const seen = new Set<string>();
    return matches.filter(({ evidence }) => {
        const key =
            evidence.canonicalUri?.toLowerCase().replace(/\/$/, "") ??
            `${evidence.corpusId}:${evidence.sourceId}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export async function rememberConversation(
    context: Pick<
        CommandHandlerContext,
        "conversationDurableMemory" | "conversationMemory" | "currentRequestId"
    >,
    text: string,
    kind?: "decision" | "task-outcome" | "context",
): Promise<void> {
    const durable = context.conversationDurableMemory;
    if (durable !== undefined) {
        const turnId = context.currentRequestId?.requestId;
        if (turnId === undefined) {
            throw new Error(
                "Cannot remember without an active conversation turn.",
            );
        }
        if (kind === "decision") {
            durable.recordDecision(text, turnId);
        } else if (kind === "task-outcome") {
            durable.recordTaskOutcome(text, turnId);
        } else {
            durable.recordAssistantEvidence(text, turnId);
        }
        await durable.flush();
        return;
    }
    const memory = context.conversationMemory;
    if (memory === undefined) {
        throw new Error("Conversation memory is not available.");
    }
    const result = await memory.addMessage(
        new ConversationMessage(
            text,
            new ConversationMessageMeta("reasoning", ["user"]),
        ),
    );
    if (!result.success) {
        throw new Error(result.message);
    }
}

export async function searchReasoningConversationMemory(
    context: Pick<CommandHandlerContext, "conversationDurableMemory"> & {
        conversationMemory?:
            | Pick<ConversationMemory, "getAnswerFromLanguage">
            | undefined;
    },
    question: string,
): Promise<string | undefined> {
    if (context.conversationDurableMemory !== undefined) {
        return searchDurableConversationMemory(context, question);
    }
    const memory = context.conversationMemory;
    if (memory === undefined) {
        return undefined;
    }
    const result = await memory.getAnswerFromLanguage(question);
    if (!result.success) {
        throw new Error(result.message);
    }
    return result.data
        .map(([, answer]) =>
            answer.type === "Answered"
                ? answer.answer
                : `No answer: ${answer.whyNoAnswer}`,
        )
        .join("\n\n");
}

export async function searchPersonalMemory(
    question: string,
    searchConversation: () => Promise<string | undefined>,
    service?: SearchService,
): Promise<string> {
    const [conversation, documents] = await Promise.allSettled([
        searchConversation(),
        service === undefined
            ? Promise.resolve<string | undefined>(undefined)
            : searchDocuments(service, question),
    ]);
    const sections: string[] = [];
    if (conversation.status === "fulfilled" && conversation.value) {
        sections.push(`## Conversation memory\n${conversation.value}`);
    } else if (conversation.status === "rejected") {
        debug(
            `Conversation memory search failed: ${String(conversation.reason)}`,
        );
        sections.push(
            `Conversation memory search failed: ${String(conversation.reason)}`,
        );
    }
    if (documents.status === "fulfilled" && documents.value) {
        sections.push(
            `## Saved pages, documents and procedures\n${documents.value}`,
        );
    } else if (documents.status === "rejected") {
        debug(`Saved document search failed: ${String(documents.reason)}`);
        sections.push(
            `Saved document search failed: ${String(documents.reason)}`,
        );
    } else if (service === undefined) {
        sections.push("Saved document search is unavailable in this host.");
    }
    return (
        sections.join("\n\n") ||
        "No matching conversation or saved documents found."
    );
}

async function searchDocuments(
    service: SearchService,
    question: string,
): Promise<string | undefined> {
    const corpora = (await service.listCorpora()).filter(
        (corpus) => corpus.name !== conversationCorpusName,
    );
    const searchProcedures = service.searchProcedures?.bind(service);
    const requests = corpora.flatMap((corpus) => [
        service
            .search({
                corpusId: corpus.corpusId,
                query: question,
                limit: 5,
                maxResponseChars: 8_000,
            })
            .then((result) => ({
                kind: "document" as const,
                name: corpus.name,
                matches: result.matches,
            })),
        ...(searchProcedures === undefined
            ? []
            : [
                  searchProcedures({
                      corpusId: corpus.corpusId,
                      query: question,
                      states: ["saved"],
                      limit: 5,
                  }).then((matches) => ({
                      kind: "procedure" as const,
                      name: corpus.name,
                      matches,
                  })),
              ]),
    ]);
    const results = await Promise.allSettled(requests);
    const matches: { name: string; evidence: MemoryEvidence }[] = [];
    const procedures: { name: string; match: ProcedureSearchMatch }[] = [];
    const errors: string[] = [];
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            const perCorpus = searchProcedures === undefined ? 1 : 2;
            const message = `${index % perCorpus === 0 ? "Document" : "Procedure"} search failed in ${corpora[Math.floor(index / perCorpus)].name}: ${String(result.reason)}`;
            debug(message);
            errors.push(message);
        } else if (result.value.kind === "document") {
            matches.push(
                ...result.value.matches.map((evidence) => ({
                    name: result.value.name,
                    evidence,
                })),
            );
        } else {
            procedures.push(
                ...result.value.matches.map((match) => ({
                    name: result.value.name,
                    match,
                })),
            );
        }
    });
    const lines = distinctEvidence(matches)
        .slice(0, 8)
        .map(({ name, evidence }) =>
            [
                `- **${evidence.title}** (corpus: ${name}; source: ${evidence.sourceId}; revision: ${evidence.revisionId}${evidence.locator === undefined ? "" : `; location: ${evidence.locator}`})`,
                ...(evidence.canonicalUri === undefined
                    ? []
                    : [`  URL: ${evidence.canonicalUri}`]),
                `  Excerpt: ${evidence.snippet}`,
            ].join("\n"),
        );
    const procedureLines = procedures
        .slice(0, 5)
        .map(({ name, match }) =>
            [
                `- **Saved procedure: ${match.version.document.title}** (corpus: ${name}; procedure: ${match.procedure.procedureId}; version: ${match.procedure.latestVersion})`,
                ...(match.version.document.summary === undefined
                    ? []
                    : [`  Summary: ${match.version.document.summary}`]),
                ...match.version.document.steps
                    .slice(0, 5)
                    .map((step, index) => `  ${index + 1}. ${step}`),
                `  Sources: ${match.version.document.citations.map((citation) => `${citation.sourceId}@${citation.revisionId}`).join(", ") || "manually created"}`,
            ].join("\n"),
        );
    if (searchProcedures === undefined) {
        errors.push("Saved procedure search is unavailable in this host.");
    }
    return [...lines, ...procedureLines, ...errors].join("\n") || undefined;
}
