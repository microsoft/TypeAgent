// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { InteractiveIo } from "interactive-app";
import { collections, dateTime } from "typeagent";
import { ChatPrinter } from "../chatPrinter.js";
import chalk, { ChalkInstance } from "chalk";

export class ChatMemoryPrinter extends ChatPrinter {
    constructor(io: InteractiveIo) {
        super(io);
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

    public writeProgress(
        curCount: number,
        total: number,
        label?: string | undefined,
    ): void {
        label = label ? label + " " : "";
        const text = `[${label}${curCount} / ${total}]`;
        this.writeInColor(chalk.green, text);
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
        entities?: (conversation.ExtractedEntity | undefined)[],
    ): void {
        if (entities && entities.length > 0) {
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
    }

    public writeCompositeEntities(
        entities: (conversation.CompositeEntity | undefined)[],
    ): void {
        if (entities && entities.length > 0) {
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
}
