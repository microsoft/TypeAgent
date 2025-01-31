// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import { ChatPrinter } from "../chatPrinter.js";
import chalk from "chalk";

export class KnowProPrinter extends ChatPrinter {
    constructor() {
        super();
    }

    public writeMessage(message: kp.IMessage) {
        const prevColor = this.setForeColor(chalk.cyan);
        try {
            this.writeNameValue("Timestamp", message.timestamp);
            this.writeJson(message.metadata);
        } finally {
            this.setForeColor(prevColor);
        }
        for (const chunk of message.textChunks) {
            this.write(chunk);
        }
        this.writeLine();
    }

    public writeEntity(
        entity: knowLib.conversation.ConcreteEntity | undefined,
    ) {
        if (entity !== undefined) {
            this.writeLine(entity.name.toUpperCase());
            this.writeList(entity.type, { type: "csv" });
            if (entity.facets) {
                const facetList = entity.facets.map((f) =>
                    knowLib.conversation.facetToString(f),
                );
                this.writeList(facetList, { type: "ul" });
            }
        }
        return this;
    }

    public writeAction(action: knowLib.conversation.Action | undefined) {
        if (action !== undefined) {
            this.writeLine(knowLib.conversation.actionToString(action));
        }
    }

    public writeTopic(topic: kp.ITopic | undefined) {
        if (topic !== undefined) {
            this.writeLine(topic.text);
        }
    }

    public writeSemanticRef(semanticRef: kp.SemanticRef) {
        switch (semanticRef.knowledgeType) {
            default:
                this.writeLine(semanticRef.knowledgeType);
                break;
            case "entity":
                this.writeEntity(
                    semanticRef.knowledge as knowLib.conversation.ConcreteEntity,
                );
                break;
            case "action":
                this.writeAction(
                    semanticRef.knowledge as knowLib.conversation.Action,
                );
                break;
            case "topic":
                this.writeTopic(semanticRef.knowledge as kp.ITopic);
                break;
        }
        return this;
    }

    public writeSemanticRefs(refs: kp.SemanticRef[] | undefined) {
        if (refs && refs.length > 0) {
            for (const ref of refs) {
                this.writeSemanticRef(ref);
                this.writeLine();
            }
        }
        return this;
    }

    public writeScoredSemanticRefs(
        semanticRefMatches: kp.ScoredSemanticRef[],
        semanticRefs: kp.SemanticRef[],
        maxToDisplay: number,
    ) {
        this.writeLine(
            `Displaying ${maxToDisplay} matches of total ${semanticRefMatches.length}`,
        );
        for (let i = 0; i < maxToDisplay; ++i) {
            const match = semanticRefMatches[i];
            const semanticRef = semanticRefs[match.semanticRefIndex];

            this.writeInColor(
                chalk.green,
                `#${i + 1}: ${semanticRef.knowledgeType} [${match.score}]`,
            );
            this.writeSemanticRef(semanticRef);
            this.writeLine();
        }
    }

    public writeSearchResult(
        conversation: kp.IConversation,
        result: kp.SearchResult | undefined,
        maxToDisplay: number,
    ) {
        if (result) {
            this.writeListInColor(chalk.cyanBright, result.termMatches, {
                title: "Matched terms",
                type: "ol",
            });
            maxToDisplay = Math.min(
                result.semanticRefMatches.length,
                maxToDisplay,
            );
            this.writeScoredSemanticRefs(
                result.semanticRefMatches,
                conversation.semanticRefs!,
                maxToDisplay,
            );
        }
    }

    public writeSearchResults(
        conversation: kp.IConversation,
        results: Map<kp.KnowledgeType, kp.SearchResult>,
        maxToDisplay: number,
    ) {
        // Do entities before actions...
        this.writeResult(conversation, "entity", results, maxToDisplay);
        this.writeResult(conversation, "action", results, maxToDisplay);
        this.writeResult(conversation, "topic", results, maxToDisplay);
        this.writeResult(conversation, "tag", results, maxToDisplay);
    }

    private writeResult(
        conversation: kp.IConversation,
        type: kp.KnowledgeType,
        results: Map<kp.KnowledgeType, kp.SearchResult>,
        maxToDisplay: number,
    ) {
        const result = results.get(type);
        if (result !== undefined) {
            this.writeTitle(type.toUpperCase());
            this.writeSearchResult(conversation, result, maxToDisplay);
        }
    }

    public writeConversationInfo(conversation: kp.IConversation) {
        this.writeTitle(conversation.nameTag);
        this.writeLine(`${conversation.messages.length} messages`);
        return this;
    }

    public writePodcastInfo(podcast: kp.Podcast) {
        this.writeConversationInfo(podcast);
        this.writeList(getPodcastParticipants(podcast), {
            type: "csv",
            title: "Participants",
        });
    }

    public writeIndexingResults(
        results: kp.ConversationIndexingResult,
        verbose = false,
    ) {
        if (results.failedMessages.length > 0) {
            this.writeError(
                `Errors for ${results.failedMessages.length} messages`,
            );
            if (verbose) {
                for (const failedMessage of results.failedMessages) {
                    this.writeInColor(
                        chalk.cyan,
                        failedMessage.message.textChunks[0],
                    );
                    this.writeError(failedMessage.error);
                }
            }
        }
    }
}

function getPodcastParticipants(podcast: kp.Podcast) {
    const participants = new Set<string>();
    for (let message of podcast.messages) {
        const meta = message.metadata;
        if (meta.speaker) {
            participants.add(meta.speaker);
        }
        meta.listeners.forEach((l) => participants.add(l));
    }
    return [...participants.values()];
}
