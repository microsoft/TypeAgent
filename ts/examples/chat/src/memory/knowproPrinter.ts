// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import { ChatPrinter } from "../chatPrinter.js";
import chalk from "chalk";

export class KnowProPrinter extends ChatPrinter {
    public sortAsc: boolean = true;
    constructor(public conversation: kp.IConversation | undefined = undefined) {
        super();
    }

    public writeDateRange(dateTime: kp.DateRange) {
        this.writeLine(`Started: ${dateTime.start}`);
        if (dateTime.end) {
            this.writeLine(`Ended: ${dateTime.end}`);
        }
    }

    public writeMetadata(metadata: any) {
        this.write("Metadata: ").writeJson(metadata);
    }

    public writeMessage(message: kp.IMessage) {
        const prevColor = this.setForeColor(chalk.cyan);
        try {
            this.writeNameValue("Timestamp", message.timestamp);
            this.writeList(message.tags, { type: "csv", title: "Tags" });
            this.writeMetadata(message.metadata);
        } finally {
            this.setForeColor(prevColor);
        }
        for (const chunk of message.textChunks) {
            this.write(chunk);
        }
        this.writeLine();
        return this;
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
        return this;
    }

    public writeTopic(topic: kp.Topic | undefined) {
        if (topic !== undefined) {
            this.writeLine(topic.text);
        }
        return this;
    }

    public writeTag(tag: kp.Tag | undefined) {
        if (tag !== undefined) {
            this.writeLine(tag.text);
        }
        return this;
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
                this.writeTopic(semanticRef.knowledge as kp.Topic);
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
        if (this.sortAsc) {
            this.writeLine(`Sorted in ascending order (lowest first)`);
        }
        const matchesToDisplay = semanticRefMatches.slice(0, maxToDisplay);
        for (let i = 0; i < matchesToDisplay.length; ++i) {
            let pos = this.sortAsc ? matchesToDisplay.length - (i + 1) : i;
            this.writeScoredRef(
                pos,
                matchesToDisplay.length,
                matchesToDisplay[pos],
                semanticRefs,
            );
        }

        return this;
    }

    private writeScoredRef(
        matchNumber: number,
        totalMatches: number,
        scoredRef: kp.ScoredSemanticRef,
        semanticRefs: kp.SemanticRef[],
    ) {
        const semanticRef = semanticRefs[scoredRef.semanticRefIndex];
        this.writeInColor(
            chalk.green,
            `#${matchNumber + 1} / ${totalMatches}: <${scoredRef.semanticRefIndex}> ${semanticRef.knowledgeType} [${scoredRef.score}]`,
        );
        this.writeSemanticRef(semanticRef);
        this.writeLine();
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
        return this;
    }

    public writeSearchResults(
        conversation: kp.IConversation,
        results: Map<kp.KnowledgeType, kp.SearchResult>,
        maxToDisplay: number,
        distinct: boolean = false,
    ) {
        if (distinct) {
            this.writeResultDistinct(
                conversation,
                "entity",
                results,
                maxToDisplay,
            );
            this.writeResultDistinct(
                conversation,
                "topic",
                results,
                maxToDisplay,
            );
        } else {
            // Do entities before actions...
            this.writeResult(conversation, "entity", results, maxToDisplay);
            this.writeResult(conversation, "action", results, maxToDisplay);
            this.writeResult(conversation, "topic", results, maxToDisplay);
            this.writeResult(conversation, "tag", results, maxToDisplay);
        }
        return this;
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
        return this;
    }

    private writeResultDistinct(
        conversation: kp.IConversation,
        type: kp.KnowledgeType,
        results: Map<kp.KnowledgeType, kp.SearchResult>,
        maxToDisplay: number,
    ) {
        if (this.sortAsc) {
            this.writeLine(`Sorted in ascending order (lowest first)`);
        }
        switch (type) {
            default:
                return;

            case "topic":
                const topics = results.get("topic");
                if (topics) {
                    let distinctTopics = kp.getDistinctTopicMatches(
                        conversation.semanticRefs!,
                        topics.semanticRefMatches,
                        maxToDisplay,
                    );
                    for (let i = 0; i < distinctTopics.length; ++i) {
                        let pos = this.sortAsc
                            ? distinctTopics.length - (i + 1)
                            : i;
                        const entity = distinctTopics[pos];
                        this.writeInColor(
                            chalk.green,
                            `#${pos + 1} / ${distinctTopics.length}: [${entity.score}]`,
                        );
                        this.writeLine(entity.item.text);
                        this.writeLine();
                    }
                }
                break;

            case "entity":
                const entities = results.get("entity");
                if (entities) {
                    let distinctEntities = kp.getDistinctEntityMatches(
                        conversation.semanticRefs!,
                        entities.semanticRefMatches,
                        maxToDisplay,
                    );
                    for (let i = 0; i < distinctEntities.length; ++i) {
                        let pos = this.sortAsc
                            ? distinctEntities.length - (i + 1)
                            : i;
                        const entity = distinctEntities[pos];
                        this.writeInColor(
                            chalk.green,
                            `#${pos + 1} / ${distinctEntities.length}: [${entity.score}]`,
                        );
                        this.writeCompositeEntity(entity.item);
                        this.writeLine();
                    }
                }
                break;
        }

        return this;
    }

    public writeCompositeEntity(
        entity: knowLib.conversation.CompositeEntity | undefined,
    ): void {
        if (entity) {
            this.writeLine(entity.name.toUpperCase());
            this.writeList(entity.type, { type: "csv" });
            this.writeList(entity.facets, { type: "ul" });
        }
    }

    public writeConversationInfo(conversation: kp.IConversation) {
        this.writeTitle(conversation.nameTag);
        const timeRange = kp.getTimeRangeForConversation(conversation);
        if (timeRange) {
            this.write("Time range: ");
            this.writeDateRange(timeRange);
        }
        this.writeLine(`${conversation.messages.length} messages`);
        return this;
    }

    public writePodcastInfo(podcast: kp.Podcast) {
        this.writeConversationInfo(podcast);
        this.writeList(getPodcastParticipants(podcast), {
            type: "csv",
            title: "Participants",
        });
        return this;
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
        return this;
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
