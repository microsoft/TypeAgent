// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo } from "interactive-app";
import { Result } from "typechat";
import chalk from "chalk";
import { ChalkWriter } from "./chalkWriter.js";

export class ChatPrinter extends ChalkWriter {
    constructor(io: InteractiveIo) {
        super(io);
    }

    public writeTranslation<T>(result: Result<T>): void {
        this.writeLine();
        if (result.success) {
            this.writeJson(result.data);
        } else {
            this.writeError(result.message);
        }
    }

    public writeTitle(title: string | undefined): void {
        if (title) {
            this.writeUnderline(title);
        }
    }

    public writeLog(value: string): void {
        if (value) {
            this.writeLine(chalk.gray(value));
        }
    }
}
