// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConsoleWriter,
    getInteractiveIO,
    InteractiveIo,
} from "interactive-app";
import chalk, { ChalkInstance } from "chalk";

export type ChalkColor = {
    foreColor?: ChalkInstance | undefined;
    backColor?: ChalkInstance | undefined;
};

export class AppPrinter extends ConsoleWriter {
    private _io: InteractiveIo;
    private _color: ChalkColor;

    constructor(io?: InteractiveIo | undefined) {
        if (!io) {
            io = getInteractiveIO();
        }
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

    public writeLog(value: string) {
        if (value) {
            this.writeLine(chalk.gray(value));
        }
        return this;
    }

    public writeColor(color: ChalkInstance, message: string): void {
        message = color(message);
        this._io.writer.writeLine(message);
    }

    public writeNote(message: string): void {
        this.writeColor(chalk.gray, message);
    }

    public writeMain(message: string): void {
        this.writeColor(chalk.white, message);
    }

    public writeWarning(message: string): void {
        this.writeColor(chalk.yellow, message);
    }

    public writeError(message: string): void {
        this.writeColor(chalk.redBright, message);
    }

    public writeHeading(message: string): void {
        this.writeColor(chalk.green, message);
    }
}
