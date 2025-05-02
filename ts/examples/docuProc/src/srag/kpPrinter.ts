// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
//import * as knowLib from "knowledge-processor";
import { AppPrinter } from "../printer.js";
import chalk from "chalk";
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
}
