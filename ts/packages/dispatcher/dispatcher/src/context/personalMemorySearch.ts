// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEvidence,
    MemoryService,
} from "@typeagent/memory-service";
import registerDebug from "debug";
import { conversationCorpusName } from "./conversationDurableMemory.js";

const debug = registerDebug("typeagent:dispatcher:memory");

export async function searchPersonalMemory(
    question: string,
    searchConversation: () => Promise<string | undefined>,
    service?: Pick<MemoryService, "listCorpora" | "search">,
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
        debug(`Conversation memory search failed: ${String(conversation.reason)}`);
        sections.push(`Conversation memory search failed: ${String(conversation.reason)}`);
    }
    if (documents.status === "fulfilled" && documents.value) {
        sections.push(`## Saved pages and documents\n${documents.value}`);
    } else if (documents.status === "rejected") {
        debug(`Saved document search failed: ${String(documents.reason)}`);
        sections.push(`Saved document search failed: ${String(documents.reason)}`);
    }
    return sections.join("\n\n") || "No matching conversation or saved documents found.";
}

async function searchDocuments(
    service: Pick<MemoryService, "listCorpora" | "search">,
    question: string,
): Promise<string | undefined> {
    const corpora = (await service.listCorpora()).filter(
        (corpus) => corpus.name !== conversationCorpusName,
    );
    const results = await Promise.allSettled(
        corpora.map(async (corpus) => ({
            name: corpus.name,
            matches: (
                await service.search({
                    corpusId: corpus.corpusId,
                    query: question,
                    limit: 5,
                    maxResponseChars: 8_000,
                })
            ).matches,
        })),
    );
    const matches: { name: string; evidence: MemoryEvidence }[] = [];
    const errors: string[] = [];
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            const message = `Search failed in ${corpora[index].name}: ${String(result.reason)}`;
            debug(message);
            errors.push(message);
        } else {
            for (const evidence of result.value.matches) {
                matches.push({ name: result.value.name, evidence });
            }
        }
    });
    matches.sort((a, b) => b.evidence.score - a.evidence.score);
    const lines = matches.slice(0, 8).map(({ name, evidence }) =>
        [
            `- **${evidence.title}** (corpus: ${name}; source: ${evidence.sourceId}; revision: ${evidence.revisionId}${evidence.locator === undefined ? "" : `; location: ${evidence.locator}`})`,
            ...(evidence.canonicalUri === undefined
                ? []
                : [`  URL: ${evidence.canonicalUri}`]),
            `  Excerpt: ${evidence.snippet}`,
        ].join("\n"),
    );
    return [...lines, ...errors].join("\n") || undefined;
}
