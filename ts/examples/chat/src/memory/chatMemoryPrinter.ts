// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { InteractiveIo } from "interactive-app";
import { collections, dateTime } from "typeagent";
import { ChatPrinter } from "../chatPrinter.js";
import chalk, { ChalkInstance } from "chalk";

export class PlayPrinter extends ChatPrinter {
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

    public writeBatchProgress(batch: collections.Slice): void {
        this.writeInColor(
            chalk.gray,
            `${batch.startAt + 1} to ${batch.startAt + batch.value.length}`,
        );
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

    public writeActions(actions: conversation.Action[] | undefined): void {
        if (actions && actions.length > 0) {
            this.writeTitle("Actions");
            this.writeList(actions.map((a) => conversation.actionToString(a)));
        }
    }

    public writeExtractedActions(
        actions?:
            | (knowLib.conversation.ExtractedAction | undefined)[]
            | undefined,
    ) {
        if (actions && actions.length > 0) {
            this.writeTitle("Actions");
            this.writeList(
                actions.map((a) =>
                    a ? conversation.actionToString(a.value) : "",
                ),
            );
            this.writeLine();
        }
    }
}
