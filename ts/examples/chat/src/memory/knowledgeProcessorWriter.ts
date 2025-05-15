// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import { conversation, IndexingStats } from "knowledge-processor";
import {
    InteractiveIo,
    millisecondsToString,
    StopWatch,
} from "interactive-app";
import { collections, dateTime } from "typeagent";
import { MemoryConsoleWriter } from "../memoryWriter.js";
import chalk, { ChalkInstance } from "chalk";
import { pathToFileURL } from "url";
import { getSearchQuestion } from "./common.js";

export class KnowledgeProcessorWriter extends MemoryConsoleWriter {
    constructor(io: InteractiveIo) {
        super(io);
    }

    public writeLink(filePath: string) {
        this.writeInColor(chalk.cyan, pathToFileURL(filePath).toString());
        return this;
    }

    public writeBlocks(
        color: ChalkInstance,
        blocks: knowLib.TextBlock[] | undefined,
        ids?: string[],
    ): void {
        if (blocks && blocks.length > 0) {
            blocks.forEach((b, i) => {
                if (ids) {
                    this.writeInColor(color, `[${ids[i]}]`);
                }
                const value = b.value.trim();
                if (value.length > 0) {
                    this.writeInColor(color, b.value);
                }
            });
        }
    }

    public writeSourceBlock(block: knowLib.SourceTextBlock): void {
        this.writeTimestamp(block.timestamp);
        this.writeInColor(chalk.cyan, block.blockId);
        this.writeLine(block.value);
        if (block.sourceIds) {
            this.writeList(block.sourceIds, { type: "ul" });
        }
    }

    public writeTimestamp(timestamp?: Date): void {
        if (timestamp) {
            this.writeInColor(chalk.gray, timestamp.toString());
        }
    }

    public writeBatchProgress(
        batch: collections.Slice,
        label?: string | undefined,
        total?: number | undefined,
    ): void {
        label = label ? label + " " : "";
        let text =
            total !== undefined && total > 0
                ? `[${label}(${batch.startAt + 1} to ${batch.startAt + batch.value.length}) / ${total}]`
                : `[${label}${batch.startAt + 1} to ${batch.startAt + batch.value.length}]`;

        this.writeInColor(chalk.gray, text);
    }

    public writeTemporalBlock(
        color: ChalkInstance,
        block: dateTime.Timestamped<knowLib.TextBlock>,
    ): void {
        this.writeTimestamp(block.timestamp);
        this.writeInColor(color, block.value.value);
    }

    public writeTemporalBlocks(
        color: ChalkInstance,
        blocks: (dateTime.Timestamped<knowLib.TextBlock> | undefined)[],
    ): void {
        if (blocks && blocks.length > 0) {
            blocks.forEach((b) => {
                if (b) {
                    this.writeTemporalBlock(color, b);
                    this.writeLine();
                }
            });
        }
    }

    public writeKnowledge(knowledge: conversation.KnowledgeResponse) {
        this.writeTopics(knowledge.topics);
        this.writeEntities(knowledge.entities);
        this.writeActions(knowledge.actions);
    }

    public writeTopics(topics: string[] | undefined): void {
        if (topics && topics.length > 0) {
            this.writeTitle("Topics");
            this.writeList(topics, { type: "ul" });
            this.writeLine();
        }
    }

    public writeEntities(
        entities: conversation.ConcreteEntity[] | undefined,
    ): void {
        if (entities && entities.length > 0) {
            this.writeTitle("Entities");
            for (const entity of entities) {
                this.writeCompositeEntity(
                    conversation.toCompositeEntity(entity),
                );
                this.writeLine();
            }
        }
    }

    public writeCompositeEntity(
        entity: conversation.CompositeEntity | undefined,
    ): void {
        if (entity) {
            this.writeLine(entity.name.toUpperCase());
            this.writeList(entity.type, { type: "csv" });
            this.writeList(entity.facets, { type: "ul" });
        }
    }

    public writeExtractedEntities(
        entities?:
            | conversation.ExtractedEntity
            | (conversation.ExtractedEntity | undefined)[]
            | undefined,
    ): void {
        if (entities) {
            if (Array.isArray(entities)) {
                if (entities.length > 0) {
                    this.writeTitle("Entities");
                    for (const entity of entities) {
                        if (entity) {
                            this.writeCompositeEntity(
                                conversation.toCompositeEntity(entity.value),
                            );
                            this.writeLine();
                        }
                    }
                }
            } else {
                this.writeCompositeEntity(
                    conversation.toCompositeEntity(entities.value),
                );
            }
        }
    }

    public writeCompositeEntities(
        entities: (conversation.CompositeEntity | undefined)[],
    ): void {
        if (entities && entities.length > 0) {
            entities = knowLib.sets.removeUndefined(entities);
            entities.sort((x, y) => x!.name.localeCompare(y!.name));
            this.writeTitle("Entities");
            for (const entity of entities) {
                this.writeCompositeEntity(entity);
                this.writeLine();
            }
            this.writeLine();
        }
    }

    public writeCompositeAction(
        action: conversation.CompositeAction | undefined,
    ): void {
        if (action) {
            this.writeRecord(action);
        }
    }

    public writeActionGroups(actions: conversation.ActionGroup[]) {
        if (actions.length > 0) {
            this.writeTitle("Actions");
            for (const action of actions) {
                const group: Record<string, string> = {};
                if (action.subject) {
                    group.subject = action.subject;
                }
                if (action.verbs) {
                    group.verbs = action.verbs;
                }
                if (action.object) {
                    group.object = action.object;
                }
                this.writeRecord(group);
                if (action.values) {
                    for (let i = 0; i < action.values.length; ++i) {
                        this.writeRecord(
                            action.values[i],
                            false,
                            undefined,
                            "  ",
                        );
                        this.writeLine();
                    }
                } else {
                    this.writeLine();
                }
            }
        }
    }

    public writeAction(
        action: conversation.Action | undefined,
        writeParams: boolean = true,
    ): void {
        if (action) {
            this.writeLine(conversation.actionToString(action));
            if (writeParams && action.params) {
                for (const param of action.params) {
                    this.writeBullet(conversation.actionParamToString(param));
                }
            }
        }
    }

    public writeActions(actions: conversation.Action[] | undefined): void {
        if (actions && actions.length > 0) {
            this.writeTitle("Actions");
            this.writeList(actions.map((a) => conversation.actionToString(a)));
            this.writeLine();
        }
    }

    public writeExtractedActions(
        actions?:
            | (knowLib.conversation.ExtractedAction | undefined)[]
            | undefined,
    ) {
        if (actions && actions.length > 0) {
            this.writeTitle("Actions");
            for (const a of actions) {
                if (a) {
                    this.writeCompositeAction(
                        conversation.toCompositeAction(a.value),
                    );
                }
                this.writeLine();
            }
            this.writeLine();
        }
    }

    public writeSearchResponse(response: conversation.SearchResponse) {
        this.writeTopics(response.getTopics());
        this.writeCompositeEntities(response.getEntities());
        this.writeActionGroups(response.getActions());
        if (response.messages) {
            this.writeTemporalBlocks(chalk.cyan, response.messages);
        }
    }

    public writeResultStats(
        response: conversation.SearchResponse | undefined,
    ): void {
        if (response !== undefined) {
            const allTopics = response.getTopics();
            if (allTopics && allTopics.length > 0) {
                this.writeLine(`Topic Hit Count: ${allTopics.length}`);
            } else {
                const topicIds = new Set(response.allTopicIds());
                this.writeLine(`Topic Hit Count: ${topicIds.size}`);
            }
            const allEntities = response.getEntities();
            if (allEntities && allEntities.length > 0) {
                this.writeLine(`Entity Hit Count: ${allEntities.length}`);
            } else {
                const entityIds = new Set(response.allEntityIds());
                this.writeLine(
                    `Entity to Message Hit Count: ${entityIds.size}`,
                );
            }
            const allActions = response.getActions();
            //const allActions = [...response.allActionIds()];
            if (allActions && allActions.length > 0) {
                this.writeLine(`Action Hit Count: ${allActions.length}`);
            } else {
                const actionIds = new Set(response.allActionIds());
                this.writeLine(
                    `Action to Message Hit Count: ${actionIds.size}`,
                );
            }
            const messageHitCount = response.messages
                ? response.messages.length
                : 0;
            this.writeLine(`Message Hit Count: ${messageHitCount}`);
        }
    }

    public writeSearchQuestion(
        result:
            | conversation.SearchTermsActionResponse
            | conversation.SearchTermsActionResponseV2
            | undefined,
        debug: boolean = false,
    ) {
        if (result) {
            const question = getSearchQuestion(result);
            if (question) {
                this.writeInColor(chalk.cyanBright, `Question: ${question}`);
                this.writeLine();
            }
        }
    }

    public writeSearchTermsResult(
        result:
            | conversation.SearchTermsActionResponse
            | conversation.SearchTermsActionResponseV2,
        debug: boolean = false,
    ) {
        this.writeSearchQuestion(result);
        if (result.response && result.response.answer) {
            this.writeResultStats(result.response);
            this.writeAnswer(
                result.response.answer,
                result.response.fallbackUsed,
            );
            this.writeLine();
            if (debug) {
                this.writeSearchResponse(result.response);
            }
        }
    }

    public writeAnswer(
        response: conversation.AnswerResponse,
        fallback: boolean = false,
    ) {
        if (response.answer) {
            let answer = response.answer;
            this.writeInColor(chalk.green, answer);
        } else if (response.whyNoAnswer) {
            const answer = fallback
                ? "The conversation history does not contain information to answer this question."
                : response.whyNoAnswer;
            this.writeInColor(chalk.red, answer);
        }
    }

    public writeIndexingMetrics(
        stats: knowLib.IndexingStats,
        totalItems: number,
        timing: StopWatch,
    ): void {
        const status = `[${timing.elapsedString()}, ${millisecondsToString(stats!.totalStats.timeMs, "m")} for ${totalItems} items]`;
        this.writeInColor(chalk.green, status);
    }

    public writeIndexingStats(stats: IndexingStats) {
        this.writeInColor(chalk.cyan, `Chars: ${stats.totalStats.charCount}`);
        this.writeInColor(
            chalk.green,
            `Time: ${millisecondsToString(stats.totalStats.timeMs, "m")}`,
        );
        this.writeCompletionStats(stats.totalStats.tokenStats);
        return this;
    }
}
