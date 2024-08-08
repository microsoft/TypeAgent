// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import { InteractiveIo } from "interactive-app";
import { dateTime } from "typeagent";
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
}
