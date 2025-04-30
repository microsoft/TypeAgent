// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConsoleWriter,
    getInteractiveIO,
    InteractiveIo,
} from "interactive-app";
import chalk, { ChalkInstance } from "chalk";

export class AppPrinter extends ConsoleWriter {
    private _io: InteractiveIo;
    constructor(io?: InteractiveIo | undefined) {
        if (!io) {
            io = getInteractiveIO();
        }
        super(io.stdout);
        this._io = io;
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
