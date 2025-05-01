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


}