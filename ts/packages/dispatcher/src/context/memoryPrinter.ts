// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import chalk, { ChalkInstance } from "chalk";
import * as kp from "knowpro";

type ListOptions = {
    title?: string | undefined;
    type:
        | "ol" // Ordered list - numbered
        | "ul" // Unordered list - bullets
        | "plain"
        | "csv"; // List in csv format
};

function listItemToString(
    i: number,
    item: string,
    options?: ListOptions,
): string {
    switch (options?.type ?? "plain") {
        default:
            return item;
        case "ol":
            return `${i}. ${item}`;
        case "ul":
            return "• " + item;
    }
}

interface StyledOutput {
    write(text: string): void;
    writeLine(text?: string): void;
    writeInColor(
        color: ChalkInstance,
        writable: string | number | (() => void),
    ): void;
}

export function createStyledOutput(
    writeFn: (text: string) => void,
): StyledOutput {
    let foreColor: ChalkInstance | undefined;
    function setForeColor(
        color: ChalkInstance | undefined,
    ): ChalkInstance | undefined {
        const prevColor = foreColor;
        foreColor = color;
        return prevColor;
    }
    function write(text: string) {
        writeFn(foreColor ? foreColor(text) : text);
    }
    function writeLine(text?: string) {
        if (text) write(text);
        write("\n");
    }
    function writeInColor(
        color: ChalkInstance,
        writable: string | number | (() => void),
    ) {
        const prevColor = setForeColor(color);
        try {
            if (typeof writable === "string") {
                writeLine(writable);
            } else if (typeof writable === "number") {
                writeLine(writable.toString());
            } else {
                writable();
            }
        } finally {
            setForeColor(prevColor);
        }
    }
    return {
        write,
        writeLine,
        writeInColor,
    };
}

function writeList(
    out: StyledOutput,
    list: string | string[] | Set<string>,
    options?: ListOptions,
) {
    const isInline =
        options && (options.type === "plain" || options.type === "csv");
    if (options?.title) {
        if (isInline) {
            out.write(options.title + ": ");
        } else {
            out.writeLine(options.title);
        }
    }
    if (typeof list === "string") {
        out.writeLine(listItemToString(1, list, options));
        return;
    }
    if (!Array.isArray(list)) {
        list = [...list.values()];
    }
    if (isInline) {
        const sep = options.type === "plain" ? " " : ", ";
        for (let i = 0; i < list.length; ++i) {
            if (i > 0) {
                out.write(sep);
            }
            out.write(list[i]);
        }
        out.writeLine();
    } else {
        for (let i = 0; i < list.length; ++i) {
            const item = list[i];
            if (item) {
                out.writeLine(listItemToString(i + 1, item, options));
            }
        }
    }
}

type PrintOptions = {
    maxToDisplay?: number;
    distinct?: boolean;
    sortAsc?: boolean;
};

const defaultMaxToDisplay = 25;

function getMaxToDisplay(options?: PrintOptions): number {
    return options?.maxToDisplay ?? defaultMaxToDisplay;
}

function getSortAsc(options?: PrintOptions): boolean {
    return options?.sortAsc ?? true;
}

function getDistinct(options?: PrintOptions): boolean {
    return options?.distinct ?? false;
}

function writeTitle(out: StyledOutput, title: string) {
    out.writeLine(chalk.underline(title));
}

export function writeConversationSearchResult(
    out: StyledOutput,
    conversation: kp.IConversation,
    searchResult: kp.ConversationSearchResult | undefined,
    showKnowledge: boolean,
    showMessages: boolean,
    options?: PrintOptions,
) {
    if (!(searchResult && kp.hasConversationResult(searchResult))) {
        out.writeLine("No matches");
        return;
    }
    out.writeLine(
        `Total knowledge matches: ${searchResult.knowledgeMatches.size}`,
    );
    if (showKnowledge) {
        writeKnowledgeSearchResults(
            out,
            conversation,
            searchResult.knowledgeMatches,
            options,
        );
    }

    out.writeLine(
        `Total Message matches: ${searchResult.messageMatches.length}`,
    );
    if (showMessages) {
        writeScoredMessages(
            out,
            searchResult.messageMatches,
            conversation.messages,
            options,
        );
    }
}

export function writeKnowledgeSearchResults(
    out: StyledOutput,
    conversation: kp.IConversation,
    results: Map<kp.KnowledgeType, kp.SemanticRefSearchResult>,
    options?: PrintOptions,
) {
    writeKnowledgeSearchResult(out, conversation, "tag", results, options);
    writeKnowledgeSearchResult(out, conversation, "topic", results, options);
    writeKnowledgeSearchResult(out, conversation, "action", results, options);
    writeKnowledgeSearchResult(out, conversation, "entity", results, options);
}

function getDistinctKnowledge(
    conversation: kp.IConversation,
    type: kp.KnowledgeType,
    result: kp.SemanticRefSearchResult,
    maxToDisplay: number,
) {
    switch (type) {
        case "topic":
            return kp.getDistinctTopicMatches(
                conversation.semanticRefs!,
                result.semanticRefMatches,
                maxToDisplay,
            );

        case "entity":
            return kp.getDistinctEntityMatches(
                conversation.semanticRefs!,
                result.semanticRefMatches,
                maxToDisplay,
            );

        default:
            return undefined;
    }
}

function writeDistinctKnowledge(
    out: StyledOutput,
    distinctKnowledge: kp.ScoredKnowledge[],
    options?: PrintOptions,
) {
    const sortAsc = getSortAsc(options);
    if (sortAsc) {
        out.writeLine(`Distinct and sorted in ascending order (lowest first)`);
    }
    for (let i = 0; i < distinctKnowledge.length; ++i) {
        let pos = sortAsc ? distinctKnowledge.length - (i + 1) : i;
        const knowledge = distinctKnowledge[pos];
        out.writeInColor(
            chalk.green,
            `#${pos + 1} / ${distinctKnowledge.length}: [${knowledge.score}]`,
        );
        writeKnowledge(out, knowledge);
        out.writeLine();
    }
}

function writeKnowledgeSearchResult(
    out: StyledOutput,
    conversation: kp.IConversation,
    type: kp.KnowledgeType,
    results: Map<kp.KnowledgeType, kp.SemanticRefSearchResult>,
    options?: PrintOptions,
) {
    const result = results.get(type);
    if (result === undefined) {
        return;
    }
    writeTitle(out, type.toUpperCase());

    out.writeInColor(chalk.cyanBright, () => {
        writeList(out, result.termMatches, {
            title: "Matched terms",
            type: "ol",
        });
    });
    out.writeLine();

    const distinct = getDistinct(options);
    if (distinct) {
        const maxToDisplay = getMaxToDisplay(options);
        const distinctKnowledge = getDistinctKnowledge(
            conversation,
            type,
            result,
            maxToDisplay,
        );
        if (distinctKnowledge) {
            writeDistinctKnowledge(out, distinctKnowledge, options);
            return;
        }
    }

    writeScoredSemanticRefs(
        out,
        result.semanticRefMatches,
        conversation.semanticRefs!,
        options,
    );
}

function writeScoredSemanticRefs(
    out: StyledOutput,
    semanticRefMatches: kp.ScoredSemanticRefOrdinal[],
    semanticRefs: kp.ISemanticRefCollection,
    options?: PrintOptions,
) {
    const sortAsc = getSortAsc(options);
    if (sortAsc) {
        out.writeLine(`Sorted in ascending order (lowest first)`);
    }
    const maxToDisplay = getMaxToDisplay(options);
    const matchesToDisplay =
        maxToDisplay < semanticRefMatches.length
            ? semanticRefMatches.slice(0, maxToDisplay)
            : semanticRefMatches;
    out.writeLine(
        `Displaying ${matchesToDisplay.length} matches of total ${semanticRefMatches.length}`,
    );
    for (let i = 0; i < matchesToDisplay.length; ++i) {
        let pos = sortAsc ? matchesToDisplay.length - (i + 1) : i;
        writeScoredRef(
            out,
            pos,
            matchesToDisplay.length,
            matchesToDisplay[pos],
            semanticRefs,
        );
    }
}

function writeScoredRef(
    out: StyledOutput,
    matchNumber: number,
    totalMatches: number,
    scoredRef: kp.ScoredSemanticRefOrdinal,
    semanticRefs: kp.ISemanticRefCollection,
) {
    const semanticRef = semanticRefs.get(scoredRef.semanticRefOrdinal);
    out.writeInColor(
        chalk.green,
        `#${matchNumber + 1} / ${totalMatches}: <${scoredRef.semanticRefOrdinal}::${semanticRef.range.start.messageOrdinal}> ${semanticRef.knowledgeType} [${scoredRef.score}]`,
    );
    writeKnowledge(out, semanticRef);
    out.writeLine();
}

function writeKnowledge(
    out: StyledOutput,
    knowledgeData: kp.ScoredKnowledge | kp.SemanticRef,
) {
    switch (knowledgeData.knowledgeType) {
        default:
            out.writeLine(knowledgeData.knowledgeType);
            break;
        case "entity":
            writeEntity(
                out,
                knowledgeData.knowledge as conversation.ConcreteEntity,
            );
            break;
        case "action":
            writeAction(out, knowledgeData.knowledge as conversation.Action);
            break;
        case "topic":
            writeTopic(out, knowledgeData.knowledge as kp.Topic);
            break;
    }
}

function writeEntity(out: StyledOutput, entity: conversation.ConcreteEntity) {
    out.writeLine(entity.name.toUpperCase());
    writeList(out, entity.type, { type: "csv" });
    if (entity.facets) {
        const facetList = entity.facets.map((f) =>
            conversation.facetToString(f),
        );
        writeList(out, facetList, { type: "ul" });
    }
}

function writeAction(out: StyledOutput, action: conversation.Action) {
    out.writeLine(conversation.actionToString(action));
}

function writeTopic(out: StyledOutput, topic: kp.Topic) {
    out.writeLine(topic.text);
}

function writeScoredMessages(
    out: StyledOutput,
    messageIndexMatches: kp.ScoredMessageOrdinal[],
    messages: kp.IMessageCollection,
    options?: PrintOptions,
) {
    const sortAsc = options?.sortAsc ?? true;
    if (sortAsc) {
        out.writeLine(`Sorted in ascending order (lowest first)`);
    }
    const maxToDisplay = getMaxToDisplay(options);
    const matchesToDisplay = messageIndexMatches.slice(0, maxToDisplay);
    out.writeLine(
        `Displaying ${matchesToDisplay.length} matches of total ${messageIndexMatches.length}`,
    );
    for (let i = 0; i < matchesToDisplay.length; ++i) {
        let pos = sortAsc ? matchesToDisplay.length - (i + 1) : i;
        writeScoredMessage(
            out,
            pos,
            matchesToDisplay.length,
            matchesToDisplay[pos],
            messages,
        );
    }
}

function writeScoredMessage(
    out: StyledOutput,
    matchNumber: number,
    totalMatches: number,
    scoredMessage: kp.ScoredMessageOrdinal,
    messages: kp.IMessageCollection,
) {
    const message = messages.get(scoredMessage.messageOrdinal);
    out.writeInColor(
        chalk.green,
        `#${matchNumber + 1} / ${totalMatches}: <${scoredMessage.messageOrdinal}> [${scoredMessage.score}]`,
    );
    if (message) {
        writeMessage(out, message);
    }
    out.writeLine();
}

function writeMessage(out: StyledOutput, message: kp.IMessage) {
    out.writeInColor(chalk.cyan, () => {
        out.writeLine(`Timestamp ${message.timestamp}`);
        if (message.tags && message.tags.length > 0) {
            writeList(out, message.tags, { type: "csv", title: "Tags" });
        }
        if (message.metadata) {
            out.writeLine(
                `Metadata: ${JSON.stringify(message.metadata, null, 2)}`,
            );
        }
    });
    for (const chunk of message.textChunks) {
        out.write(chunk);
    }
    out.writeLine();
}
