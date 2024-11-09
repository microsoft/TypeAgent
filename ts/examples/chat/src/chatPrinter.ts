// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo, millisecondsToString } from "interactive-app";
import { Result } from "typechat";
import chalk from "chalk";
import { ChalkWriter } from "./chalkWriter.js";
import { openai } from "aiclient";
import { IndexingStats } from "./memory/common.js";

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

    public writeCompletionStats(stats: openai.CompletionUsageStats) {
        this.writeInColor(chalk.gray, () => {
            this.writeLine(`Prompt tokens: ${stats.prompt_tokens}`);
            this.writeLine(`Completion tokens: ${stats.completion_tokens}`);
            this.writeLine(`Total tokens: ${stats.total_tokens}`);
        });
    }

    public writeIndexingStats(stats: IndexingStats) {
        this.writeInColor(chalk.cyan, `Chars: ${stats.totalChars}`);
        this.writeInColor(
            chalk.green,
            `Time: ${millisecondsToString(stats.totalMs, "m")}`,
        );
        this.writeCompletionStats(stats.tokenStats);
    }
}
