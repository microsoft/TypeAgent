// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import { MemoryConsoleWriter } from "../memoryWriter.js";
import chalk from "chalk";
import { IMessageMetadata, textLocationToString } from "./knowproCommon.js";
import * as cm from "conversation-memory";
import * as im from "image-memory";

export class KnowProPrinter extends MemoryConsoleWriter {
    public sortAsc: boolean = true;
    constructor() {
        super();
    }

    public writeNumbered(
        array: any[],
        writer: (printer: KnowProPrinter, item: any) => void,
    ) {
        for (let i = 0; i < array.length; ++i) {
            this.write(`${i}. `);
            writer(this, array[i]);
        }
        return this;
    }

    public writeTerm(term: kp.Term): KnowProPrinter {
        if (term.weight) {
            this.writeLine(`${term.text} [${term.weight}]`);
        } else {
            this.writeLine(term.text);
        }
        return this;
    }

    public writeTerms(terms: kp.Term[]): KnowProPrinter {
        for (const term of terms) {
            this.writeTerm(term);
        }
        return this;
    }

    public writeDateRange(dateTime: kp.DateRange): KnowProPrinter {
        this.writeLine(`Started: ${dateTime.start}`);
        if (dateTime.end) {
            this.writeLine(`Ended: ${dateTime.end}`);
        }
        return this;
    }

    public writeMetadata(message: kp.IMessage): KnowProPrinter {
        const msgMetadata: IMessageMetadata =
            message as any as IMessageMetadata;
        if (msgMetadata) {
            this.write("Metadata: ").writeJson(msgMetadata.metadata);
        }
        return this;
    }

    public writeMessage(message: kp.IMessage) {
        const prevColor = this.setForeColor(chalk.cyan);
        try {
            this.writeNameValue("Timestamp", message.timestamp);
            if (message.tags && message.tags.length > 0) {
                this.writeList(message.tags, { type: "csv", title: "Tags" });
            }
            this.writeMetadata(message);
        } finally {
            this.setForeColor(prevColor);
        }
        for (const chunk of message.textChunks) {
            this.write(chunk);
        }
        this.writeLine();
        return this;
    }

    public writeMessages(
        messages: Iterable<kp.IMessage> | kp.IMessage[],
        ordinalStartAt = 0,
    ) {
        let i = ordinalStartAt;
        for (const message of messages) {
            this.writeLine(`[${i}]`);
            this.writeMessage(message);
            ++i;
            this.writeLine();
        }
    }

    public writeScoredMessages(
        messageIndexMatches: kp.ScoredMessageOrdinal[],
        messages: kp.IMessageCollection,
        maxToDisplay: number,
    ) {
        if (this.sortAsc) {
            this.writeLine(`Sorted in ascending order (lowest first)`);
        }
        const matchesToDisplay = messageIndexMatches.slice(0, maxToDisplay);
        this.writeLine(
            `Displaying ${matchesToDisplay.length} matches of total ${messageIndexMatches.length}`,
        );
        for (let i = 0; i < matchesToDisplay.length; ++i) {
            let pos = this.sortAsc ? matchesToDisplay.length - (i + 1) : i;
            this.writeScoredMessage(
                pos,
                matchesToDisplay.length,
                matchesToDisplay[pos],
                messages,
            );
        }

        return this;
    }

    private writeScoredMessage(
        matchNumber: number,
        totalMatches: number,
        scoredMessage: kp.ScoredMessageOrdinal,
        messages: kp.IMessageCollection,
    ) {
        const message = messages.get(scoredMessage.messageOrdinal);
        this.writeInColor(
            chalk.green,
            `#${matchNumber + 1} / ${totalMatches}: <${scoredMessage.messageOrdinal}> [${scoredMessage.score}]`,
        );
        if (message) {
            this.writeMessage(message);
        }
        this.writeLine();
    }

    public writeEntity(
        entity: knowLib.conversation.ConcreteEntity | undefined,
    ): KnowProPrinter {
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

    public writeAction(
        action: knowLib.conversation.Action | undefined,
    ): KnowProPrinter {
        if (action !== undefined) {
            this.writeLine(knowLib.conversation.actionToString(action));
        }
        return this;
    }

    public writeTopic(topic: kp.Topic | undefined): KnowProPrinter {
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
        semanticRefMatches: kp.ScoredSemanticRefOrdinal[],
        semanticRefs: kp.ISemanticRefCollection,
        maxToDisplay: number,
    ) {
        if (this.sortAsc) {
            this.writeLine(`Sorted in ascending order (lowest first)`);
        }
        const matchesToDisplay = semanticRefMatches.slice(0, maxToDisplay);
        this.writeLine(
            `Displaying ${matchesToDisplay.length} matches of total ${semanticRefMatches.length}`,
        );
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

    public writeScoredKnowledge(scoredKnowledge: kp.ScoredKnowledge) {
        switch (scoredKnowledge.knowledgeType) {
            default:
                this.writeLine(scoredKnowledge.knowledgeType);
                break;
            case "entity":
                this.writeEntity(
                    scoredKnowledge.knowledge as knowLib.conversation.ConcreteEntity,
                );
                break;
            case "action":
                this.writeAction(
                    scoredKnowledge.knowledge as knowLib.conversation.Action,
                );
                break;
            case "topic":
                this.writeTopic(scoredKnowledge.knowledge as kp.Topic);
                break;
        }
        return this;
    }

    private writeScoredRef(
        matchNumber: number,
        totalMatches: number,
        scoredRef: kp.ScoredSemanticRefOrdinal,
        semanticRefs: kp.ISemanticRefCollection,
    ) {
        const semanticRef = semanticRefs.get(scoredRef.semanticRefOrdinal);
        this.writeInColor(
            chalk.green,
            `#${matchNumber + 1} / ${totalMatches}: <${scoredRef.semanticRefOrdinal}::${semanticRef.range.start.messageOrdinal}> ${semanticRef.knowledgeType} [${scoredRef.score}]`,
        );
        this.writeSemanticRef(semanticRef);
        this.writeLine();
    }

    public writeSemanticRefSearchResult(
        conversation: kp.IConversation,
        result: kp.SemanticRefSearchResult,
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

    public writeKnowledgeSearchResults(
        conversation: kp.IConversation,
        results: Map<kp.KnowledgeType, kp.SemanticRefSearchResult>,
        maxToDisplay: number,
        distinct: boolean = false,
    ) {
        this.writeKnowledgeSearchResult(
            conversation,
            "tag",
            results,
            maxToDisplay,
        );
        if (distinct) {
            this.writeResultDistinct(
                conversation,
                "topic",
                results,
                maxToDisplay,
            );
        } else {
            this.writeKnowledgeSearchResult(
                conversation,
                "topic",
                results,
                maxToDisplay,
            );
        }
        this.writeKnowledgeSearchResult(
            conversation,
            "action",
            results,
            maxToDisplay,
        );
        if (distinct) {
            this.writeResultDistinct(
                conversation,
                "entity",
                results,
                maxToDisplay,
            );
        } else {
            this.writeKnowledgeSearchResult(
                conversation,
                "entity",
                results,
                maxToDisplay,
            );
        }
        return this;
    }

    private writeKnowledgeSearchResult(
        conversation: kp.IConversation,
        type: kp.KnowledgeType,
        results: Map<kp.KnowledgeType, kp.SemanticRefSearchResult>,
        maxToDisplay: number,
    ) {
        const result = results.get(type);
        if (result !== undefined) {
            this.writeTitle(type.toUpperCase());
            this.writeSemanticRefSearchResult(
                conversation,
                result,
                maxToDisplay,
            );
        }
        return this;
    }

    public writeConversationSearchResult(
        conversation: kp.IConversation,
        searchResult: kp.ConversationSearchResult | undefined,
        showKnowledge: boolean,
        showMessages: boolean,
        maxToDisplay: number,
        distinct: boolean,
    ) {
        if (searchResult && kp.hasConversationResult(searchResult)) {
            if (showKnowledge) {
                this.writeKnowledgeSearchResults(
                    conversation,
                    searchResult.knowledgeMatches,
                    maxToDisplay,
                    distinct,
                );
            }
            if (showMessages) {
                this.writeScoredMessages(
                    searchResult.messageMatches,
                    conversation.messages,
                    maxToDisplay,
                );
            }
        } else {
            this.writeLine("No matches");
        }
    }

    public writeSelectExpr(
        selectExpr: kp.SearchSelectExpr,
        verbose: boolean = true,
    ) {
        if (verbose) {
            this.writeInColor(chalk.gray, () => {
                this.writeHeading("Compiled query");
                this.writeJson(selectExpr);
                this.writeLine();
            });
        } else {
            const json = JSON.stringify(
                selectExpr,
                (key, value) =>
                    key === "relatedTerms" || key === "weight"
                        ? undefined
                        : value,
                2,
            );
            this.writeInColor(chalk.gray, () => {
                this.writeHeading("Compiled query");
                this.writeLine(json);
                this.writeLine();
            });
        }
    }

    private writeResultDistinct(
        conversation: kp.IConversation,
        type: kp.KnowledgeType,
        results: Map<kp.KnowledgeType, kp.SemanticRefSearchResult>,
        maxToDisplay: number,
    ) {
        if (type !== "topic" && type !== "entity") {
            return;
        }

        let distinctKnowledge: kp.ScoredKnowledge[] | undefined;
        switch (type) {
            default:
                return;

            case "topic":
                const topics = results.get("topic");
                if (topics) {
                    this.writeTitle(type.toUpperCase());
                    distinctKnowledge = kp.getDistinctTopicMatches(
                        conversation.semanticRefs!,
                        topics.semanticRefMatches,
                        maxToDisplay,
                    );
                }
                break;

            case "entity":
                const entities = results.get("entity");
                if (entities) {
                    this.writeTitle(type.toUpperCase());
                    distinctKnowledge = kp.getDistinctEntityMatches(
                        conversation.semanticRefs!,
                        entities.semanticRefMatches,
                        maxToDisplay,
                    );
                }
                break;
        }
        if (distinctKnowledge) {
            for (let i = 0; i < distinctKnowledge.length; ++i) {
                let pos = this.sortAsc ? distinctKnowledge.length - (i + 1) : i;
                const knowledge = distinctKnowledge[pos];
                this.writeInColor(
                    chalk.green,
                    `#${pos + 1} / ${distinctKnowledge.length}: [${knowledge.score}]`,
                );
                this.writeScoredKnowledge(knowledge);
                this.writeLine();
            }
        }

        return this;
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

    public writePodcastInfo(podcast: cm.Podcast) {
        this.writeConversationInfo(podcast);
        this.writeList(getPodcastParticipants(podcast), {
            type: "csv",
            title: "Participants",
        });
        return this;
    }

    public writeImageCollectionInfo(imageCollection: im.ImageCollection) {
        this.writeLine(
            `${imageCollection.nameTag}: ${imageCollection.messages.length} images.`,
        );
        return this;
    }

    public writeIndexingResults(results: kp.IndexingResults) {
        if (results.semanticRefs) {
            this.writeTextIndexingResult(results.semanticRefs, "Semantic Refs");
        }
        if (results.secondaryIndexResults) {
            if (results.secondaryIndexResults.properties) {
                this.writeListIndexingResult(
                    results.secondaryIndexResults.properties,
                    "Properties",
                );
                this;
            }
            if (results.secondaryIndexResults.timestamps) {
                this.writeListIndexingResult(
                    results.secondaryIndexResults.timestamps,
                    "Timestamps",
                );
                this;
            }
            if (results.secondaryIndexResults.relatedTerms) {
                this.writeListIndexingResult(
                    results.secondaryIndexResults.relatedTerms,
                    "Related Terms",
                );
                this;
            }
        }
        return this;
    }

    public writeTextIndexingResult(
        result: kp.TextIndexingResult,
        label?: string,
    ) {
        if (label) {
            this.write(label + ": ");
        }
        if (result.completedUpto) {
            this.writeLine(
                `Completed upto ${textLocationToString(result.completedUpto)}`,
            );
        }
        if (result.error) {
            this.writeError(result.error);
        }
        return this;
    }

    public writeListIndexingResult(
        result: kp.ListIndexingResult,
        label?: string,
    ) {
        if (label) {
            this.write(label + ": ");
        }
        this.writeLine(`Indexed ${result.numberCompleted} items`);
        if (result.error) {
            this.writeError(result.error);
        }
        return this;
    }

    public writeSearchFilter(
        action: knowLib.conversation.GetAnswerWithTermsActionV2,
    ) {
        this.writeInColor(
            chalk.cyanBright,
            `Question: ${action.parameters.question}`,
        );
        this.writeLine();
        this.writeJson(action.parameters.filters);
        return this;
    }

    public writeSearchQuery(searchQuery: kp.querySchema.SearchQuery) {
        this.writeHeading("Search Query");
        this.writeJson(searchQuery);
    }

    public writeDebugContext(context: kp.LanguageSearchDebugContext) {
        if (context.searchQuery) {
            this.writeHeading("Search Query");
            this.writeJson(context.searchQuery);
        }
        if (context.searchQueryExpr) {
            this.writeHeading("Search QueryExpr");
            this.writeJson(context.searchQueryExpr);
        }
    }

    public writeAnswerContext(answerContext: kp.AnswerContext) {
        this.writeLine(kp.answerContextToString(answerContext, 2));
        return this;
    }

    public writeAnswer(
        answerResponse: kp.AnswerResponse | undefined,
        isFallback: boolean = false,
    ) {
        if (answerResponse) {
            if (answerResponse.type === "NoAnswer") {
                this.writeError("No answer");
            }
            if (answerResponse.answer) {
                this.writeInColor(
                    isFallback ? chalk.green : chalk.greenBright,
                    answerResponse.answer,
                );
            } else if (answerResponse.whyNoAnswer) {
                this.writeError(answerResponse.whyNoAnswer);
            }
        }
        return this;
    }

    public writeKnowledge(
        knowledge?: knowLib.conversation.KnowledgeResponse | undefined,
    ): void {
        if (knowledge) {
            if (knowledge.topics.length > 0) {
                this.writeLineInColor(chalk.cyan, "Topics");
                knowledge.topics.forEach((t) => this.writeLine(t));
            }
            if (knowledge.actions.length > 0) {
                this.writeLineInColor(chalk.cyan, "Actions");
                knowledge.actions.forEach((a) => this.writeAction(a));
            }
            if (knowledge.entities.length > 0) {
                this.writeLineInColor(chalk.cyan, "Entities");
                knowledge.entities.forEach((e) => this.writeEntity(e));
            }
        }
    }

    public writeDocPart(docPart: cm.DocPart) {
        for (const text of docPart.textChunks) {
            this.writeLine(text);
        }
        this.writeKnowledge(docPart.knowledge);
        return this;
    }
}

function getPodcastParticipants(podcast: cm.Podcast) {
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
