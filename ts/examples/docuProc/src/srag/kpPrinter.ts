// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import { AppPrinter } from "../printer.js";
import chalk from "chalk";
import { StopWatch } from "interactive-app";
//import { textLocationToString } from "./knowproCommon.js";
//import * as cm from "conversation-memory";

export interface IMessageMetadata<TMeta = any> {
    metadata: TMeta;
}

export function textLocationToString(location: kp.TextLocation): string {
    let text = `MessageOrdinal: ${location.messageOrdinal}`;
    if (location.chunkOrdinal) {
        text += `\nChunkOrdinal: ${location.chunkOrdinal}`;
    }
    if (location.charOrdinal) {
        text += `\nCharOrdinal: ${location.charOrdinal}`;
    }
    return text;
}

export class KPPrinter extends AppPrinter {
    public sortAsc: boolean = true;
    constructor(public conversation: kp.IConversation | undefined = undefined) {
        super();
    }

    public writeDateRange(dateTime: kp.DateRange): KPPrinter {
        this.writeLine(`Started: ${dateTime.start}`);
        if (dateTime.end) {
            this.writeLine(`Ended: ${dateTime.end}`);
        }
        return this;
    }

    public writeMetadata(message: kp.IMessage): KPPrinter {
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
            this.writeList(message.tags, { type: "csv", title: "Tags" });
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

    public writeMessages(messages: Iterable<kp.IMessage> | kp.IMessage[]) {
        for (const message of messages) {
            this.writeMessage(message);
        }
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

    public writeTiming(clock: StopWatch, label?: string) {
        const color = chalk.magentaBright;
        const timing = label
            ? `${label}: ${clock.elapsedString()}`
            : clock.elapsedString();
        this.writeInColor(color, timing);
    }

    public writeSelectExpr(selectExpr: kp.SearchSelectExpr) {
        this.writeInColor(chalk.gray, () => {
            this.writeHeading("Compiled query");
            this.writeJson(selectExpr);
            this.writeLine();
        });
    }

    public writeNaturalLanguageContext(context: kp.LanguageSearchDebugContext) {
        if (context.searchQuery) {
            this.writeHeading("Search Query");
            this.writeJson(context.searchQuery);
        }
        if (context.searchQueryExpr) {
            this.writeHeading("Search QueryExpr");
            this.writeJson(context.searchQueryExpr);
        }
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

    public writeSemanticRefSearchResult(
        conversation: kp.IConversation,
        result: kp.SemanticRefSearchResult | undefined,
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

    public writeEntity(
        entity: knowLib.conversation.ConcreteEntity | undefined,
    ): KPPrinter {
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
    ): KPPrinter {
        if (action !== undefined) {
            this.writeLine(knowLib.conversation.actionToString(action));
        }
        return this;
    }

    public writeTopic(topic: kp.Topic | undefined): KPPrinter {
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

    public writeConversationSearchResult(
        conversation: kp.IConversation,
        searchResult: kp.ConversationSearchResult | undefined,
        showKnowledge: boolean,
        showMessages: boolean,
        maxToDisplay: number,
        distinct: boolean,
    ) {
        if (searchResult && searchResult.messageMatches.length > 0) {
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

    private writeScoredRef(
        matchNumber: number,
        totalMatches: number,
        scoredRef: kp.ScoredSemanticRefOrdinal,
        semanticRefs: kp.ISemanticRefCollection,
    ) {
        const semanticRef = semanticRefs.get(scoredRef.semanticRefOrdinal);
        this.writeInColor(
            chalk.green,
            `#${matchNumber + 1} / ${totalMatches}: <${scoredRef.semanticRefOrdinal}> ${semanticRef.knowledgeType} [${scoredRef.score}]`,
        );
        this.writeSemanticRef(semanticRef);
        this.writeLine();
    }

    public writeAnswer(answerResponse: kp.AnswerResponse | undefined) {
        if (answerResponse) {
            if (answerResponse.type === "NoAnswer") {
                this.writeError("No answer");
            }
            if (answerResponse.answer) {
                this.writeInColor(chalk.green, answerResponse.answer);
            } else if (answerResponse.whyNoAnswer) {
                this.writeError(answerResponse.whyNoAnswer);
            }
        }
        return this;
    }
}
