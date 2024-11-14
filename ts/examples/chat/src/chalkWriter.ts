// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConsoleWriter,
    InteractiveIo,
    ListOptions,
    StopWatch,
} from "interactive-app";
import chalk, { ChalkInstance } from "chalk";

export type ChalkColor = {
    foreColor?: ChalkInstance | undefined;
    backColor?: ChalkInstance | undefined;
};

export class ChalkWriter extends ConsoleWriter {
    private _io: InteractiveIo;
    private _color: ChalkColor;

    constructor(io: InteractiveIo) {
        super(io.stdout);
        this._io = io;
        this._color = {};
    }

    public get io(): InteractiveIo {
        return this._io;
    }

    public getColor(): ChalkColor {
        return { ...this._color };
    }

    public setForeColor(color?: ChalkInstance): ChalkInstance | undefined {
        const prev = this._color.foreColor;
        this._color.foreColor = color;
        return prev;
    }

    public setBackColor(color?: ChalkInstance): ChalkInstance | undefined {
        const prev = this._color.backColor;
        this._color.backColor = color;
        return prev;
    }

    public setColor(color: ChalkColor): ChalkColor {
        const prevColor = this._color;
        this._color = { ...color };
        return prevColor;
    }

    public write(text?: string, isStyled: boolean = false): ChalkWriter {
        if (text) {
            if (!isStyled) {
                if (this._color.foreColor) {
                    text = this._color.foreColor(text);
                }
                if (this._color.backColor) {
                    text = this._color.backColor(text);
                }
            }
            super.write(text);
        }
        return this;
    }

    public writeLine(text?: string, isStyled: boolean = false): ChalkWriter {
        this.write(text, isStyled);
        this.write("\n");
        return this;
    }

    public log(text: string): ChalkWriter {
        super.write(text);
        super.write("\n");
        return this;
    }

    public writeLines(lines: string[]): ChalkWriter {
        lines.forEach((l) => this.writeLine(l));
        return this;
    }

    public writeBullet(line: string): ChalkWriter {
        return this.writeLine("• " + line);
    }

    public writeInColor(
        color: ChalkInstance,
        writable: string | number | (() => void),
    ) {
        const prevColor = this.setForeColor(color);
        try {
            if (typeof writable === "string") {
                this.writeLine(writable);
            } else if (typeof writable === "number") {
                this.writeLine(writable.toString());
            } else {
                writable();
            }
        } finally {
            this.setForeColor(prevColor);
        }
    }

    public writeHeading(text: string): ChalkWriter {
        this.writeLine(chalk.underline(chalk.bold(text)));
        return this;
    }

    public writeUnderline(text: string): ChalkWriter {
        this.writeLine(chalk.underline(text));
        return this;
    }

    public writeBold(text: string): ChalkWriter {
        this.writeLine(chalk.bold(text));
        return this;
    }

    public writeTiming(color: ChalkInstance, clock: StopWatch, label?: string) {
        const timing = label
            ? `${label}: ${clock.elapsedString()}`
            : clock.elapsedString();
        this.writeInColor(color, timing);
    }

    public writeError(message: string) {
        this.writeLine(chalk.redBright(message));
    }

    public writeListInColor(
        color: ChalkInstance,
        list?: string | string[] | (string | undefined)[],
        options?: ListOptions,
    ) {
        const prevColor = this.setForeColor(color);
        try {
            this.writeList(list, options);
        } finally {
            this.setForeColor(prevColor);
        }
    }
}
