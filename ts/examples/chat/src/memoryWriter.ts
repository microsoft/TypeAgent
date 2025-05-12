// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getInteractiveIO, InteractiveIo } from "interactive-app";
import chalk from "chalk";
import { ChalkWriter } from "examples-lib";
import { openai } from "aiclient";

export class MemoryConsoleWriter extends ChalkWriter {
    constructor(io?: InteractiveIo | undefined) {
        if (!io) {
            io = getInteractiveIO();
        }
        super(io);
    }

    public writeCompletionStats(stats: openai.CompletionUsageStats) {
        this.writeInColor(chalk.gray, () => {
            this.writeLine(`Prompt tokens: ${stats.prompt_tokens}`);
            this.writeLine(`Completion tokens: ${stats.completion_tokens}`);
            this.writeLine(`Total tokens: ${stats.total_tokens}`);
        });
        return this;
    }
}
