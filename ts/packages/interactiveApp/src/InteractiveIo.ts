// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import readline from "readline/promises";
import { pathToFileURL } from "url";

/**
 * Standard IO streams
 */
export type InteractiveIo = {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    readline: readline.Interface;
    writer: ConsoleWriter;
};

let g_io: InteractiveIo | undefined;
export function getInteractiveIO(): InteractiveIo {
    if (!g_io) {
        g_io = createInteractiveIO();
    }
    return g_io;
}

export function createInteractiveIO(): InteractiveIo {
    const line = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return {
        stdin: process.stdin,
        stdout: process.stdout,
        readline: line,
        writer: new ConsoleWriter(process.stdout),
    };
}

export type ListOptions = {
    title?: string | undefined;
    type:
        | "ol" // Ordered list - numbered
        | "ul" // Unordered list - bullets
        | "plain"
        | "csv"; // List in csv format
};

/**
 * ConsoleWriter has easy wrappers like writeLine that are missing in standard io interfaces
 */
export class ConsoleWriter {
    constructor(
        public stdout: NodeJS.WriteStream,
        public indent: string = "",
    ) {}

    public write(text?: string): ConsoleWriter {
        if (text) {
            this.stdout.write(text);
        }
        return this;
    }

    public writeInline(text: string, prevText?: string): ConsoleWriter {
        if (prevText) {
            this.stdout.moveCursor(-prevText.length, 0);
        }
        this.write(text);
        return this;
    }

    public writeLine(value?: string | number): ConsoleWriter {
        let text: any;
        if (value !== undefined && typeof value !== "string") {
            text = value.toString();
        } else {
            text = value;
        }
        if (text) {
            this.write(text);
        }
        this.write("\n");
        return this;
    }

    public writeJson(obj: any, indented: boolean = true): ConsoleWriter {
        this.writeLine(indented ? this.jsonString(obj) : JSON.stringify(obj));
        return this;
    }

    public jsonString(obj: any): string {
        return JSON.stringify(obj, null, 2);
    }

    public writeList(
        list?: string | string[] | (string | undefined)[] | Set<string>,
        options?: ListOptions,
    ): ConsoleWriter {
        if (!list) {
            return this;
        }
        const isInline =
            options && (options.type === "plain" || options.type === "csv");
        if (options?.title) {
            if (isInline) {
                this.write(options.title + ": ");
            } else {
                this.writeLine(options.title);
            }
        }
        if (typeof list === "string") {
            this.writeLine(this.listItemToString(1, list, options));
            return this;
        }
        if (list instanceof Set) {
            list = [...list.values()];
        }
        if (isInline) {
            const sep = options.type === "plain" ? " " : ", ";
            for (let i = 0; i < list.length; ++i) {
                if (i > 0) {
                    this.write(sep);
                }
                this.write(list[i]);
            }
            this.writeLine();
        } else {
            for (let i = 0; i < list.length; ++i) {
                const item = list[i];
                if (item) {
                    this.writeLine(this.listItemToString(i + 1, item, options));
                }
            }
        }
        return this;
    }

    public writeTable(table: string[][]): ConsoleWriter {
        if (table.length === 0) {
            return this;
        }
        for (let i = 0; i < table.length; ++i) {
            this.writeList(table[i]);
        }
        return this;
    }

    public writeNameValue(
        name: string,
        value: any,
        paddedNameLength?: number,
        indent?: string,
    ): ConsoleWriter {
        if (indent) {
            this.write(indent);
        }
        if (Array.isArray(value)) {
            value = value.join("; ");
        }
        const line = `${paddedNameLength ? name.padEnd(paddedNameLength) : name}  ${value}`;
        this.writeLine(line);
        return this;
    }

    public writeRecord<T = string>(
        record: Record<string, T>,
        sort: boolean = false,
        stringifyValue?: (value: T) => string | string[],
        indent?: string,
    ): number {
        const keys = Object.keys(record);
        if (sort) {
            keys.sort();
        }
        let maxLength = this.getMaxLength(keys);
        for (const key of keys) {
            let value = record[key];
            let strValues = stringifyValue ? stringifyValue(value) : value;
            if (Array.isArray(strValues) && strValues.length > 0) {
                this.writeNameValue(key, strValues[0], maxLength, indent);
                for (let i = 1; i < strValues.length; ++i) {
                    this.writeNameValue("", strValues[i], maxLength, indent);
                }
            } else {
                this.writeNameValue(key, strValues, maxLength, indent);
            }
        }
        return maxLength;
    }

    public writeLink(url: string): ConsoleWriter {
        this.writeLine(pathToFileURL(url).toString());
        return this;
    }

    private listItemToString(
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

    private getMaxLength(values: string[]): number {
        let maxLength = 0;
        values.forEach((v) => {
            maxLength = v.length > maxLength ? v.length : maxLength;
        });
        return maxLength;
    }
}

export async function askYesNo(
    io: InteractiveIo,
    question: string,
): Promise<boolean> {
    let answer = await io.readline.question(`${question} (y/n):`);
    return answer.trim().toLowerCase() === "y";
}

export class ProgressBar {
    private _lastText: string = "";
    constructor(
        public writer: ConsoleWriter,
        public total: number,
        public count = 0,
    ) {}

    public advance(amount: number = 1) {
        if (this.count >= this.total) {
            return;
        }
        let next = this.count + amount;
        if (next >= this.total) {
            next = this.total;
        }
        this.count = next;
        let progressText = `[${this.count} / ${this.total}]`;
        this.writer.writeInline(progressText, this._lastText);
        this._lastText = progressText;
    }

    public complete() {
        if (this._lastText) {
            this.writer.writeInline("", this._lastText);
            this._lastText = "";
        }
    }

    public reset(total?: number) {
        this.complete();
        this.count = 0;
        if (total) {
            this.total = total;
        }
    }
}
