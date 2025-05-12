// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getInteractiveIO,
    InteractiveIo,
    millisecondsToString,
} from "interactive-app";
import { Result } from "typechat";
import chalk from "chalk";
import { ChalkWriter } from "examples-lib";
import { openai } from "aiclient";
import { IndexingStats } from "knowledge-processor";

export class ChatPrinter extends ChalkWriter {
    constructor(io?: InteractiveIo | undefined) {
        if (!io) {
            io = getInteractiveIO();
        }
        super(io);
    }

    public writeTranslation<T>(result: Result<T>) {
        this.writeLine();
        if (result.success) {
            this.writeJson(result.data);
        } else {
            this.writeError(result.message);
        }
        return this;
    }

    public writeTitle(title: string | undefined) {
        if (title) {
            this.writeUnderline(title);
        }
        return this;
    }

    public writeLog(value: string) {
        if (value) {
            this.writeLine(chalk.gray(value));
        }
        return this;
    }

    public writeCompletionStats(stats: openai.CompletionUsageStats) {
        this.writeInColor(chalk.gray, () => {
            this.writeLine(`Prompt tokens: ${stats.prompt_tokens}`);
            this.writeLine(`Completion tokens: ${stats.completion_tokens}`);
            this.writeLine(`Total tokens: ${stats.total_tokens}`);
        });
        return this;
    }

    public writeIndexingStats(stats: IndexingStats) {
        this.writeInColor(chalk.cyan, `Chars: ${stats.totalStats.charCount}`);
        this.writeInColor(
            chalk.green,
            `Time: ${millisecondsToString(stats.totalStats.timeMs, "m")}`,
        );
        this.writeCompletionStats(stats.totalStats.tokenStats);
        return this;
    }

    public writeProgress(
        curCount: number,
        total: number,
        label?: string | undefined,
    ) {
        label = label ? label + " " : "";
        const text = `[${label}${curCount} / ${total}]`;
        this.writeInColor(chalk.gray, text);
        return this;
    }
}
