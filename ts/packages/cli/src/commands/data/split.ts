// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import {
    ExplanationTestData,
    getEmptyExplanationTestData,
    readExplanationTestData,
} from "agent-dispatcher/internal";
import fs from "node:fs";
import path from "node:path";
export default class ExplanationDataSplitCommmand extends Command {
    static strict = false;
    static args = {
        files: Args.string({
            description: "List of explanation data files.",
        }),
    };
    static flags = {
        limit: Flags.integer({
            char: "l",
            description: "Limit the number of requests to split",
            default: 300,
        }),
    };
    async run(): Promise<void> {
        const { flags, argv } = await this.parse(ExplanationDataSplitCommmand);

        if (argv.length === 0) {
            throw new Error("No files specified.");
        }

        const files = argv as string[];
        for (const file of files) {
            const data = await readExplanationTestData(file);
            const failedCount = data.failed?.length ?? 0;
            const total = data.entries.length + failedCount;
            if (total <= flags.limit) {
                this.log(
                    chalk.yellow(
                        `${file}: ${total} entries found. No need to split.`,
                    ),
                );
                continue;
            }

            const splitData: ExplanationTestData[] = [];
            let currEntry = 0;
            let currFailed = 0;
            while (
                currEntry < data.entries.length ||
                currFailed < failedCount
            ) {
                const newData = getEmptyExplanationTestData(
                    data.schemaName,
                    data.sourceHash,
                    data.explainerName,
                );
                if (currEntry < data.entries.length) {
                    const end =
                        currEntry +
                        Math.min(flags.limit, data.entries.length - currEntry);
                    newData.entries = data.entries.slice(currEntry, end);
                    currEntry = end;
                }
                if (currFailed < failedCount) {
                    const remaining = flags.limit - newData.entries.length;
                    if (remaining > 0) {
                        const end =
                            currFailed +
                            Math.min(remaining, failedCount - currFailed);
                        newData.failed = data.failed!.slice(currFailed, end);
                        currFailed = end;
                    }
                }
                splitData.push(newData);
            }

            const parsed = path.parse(file);
            for (let i = 0; i < splitData.length; i++) {
                const split = splitData[i];
                const fileName =
                    i == 0
                        ? file
                        : path.join(parsed.dir, `${parsed.name}_${i}.json`);
                await fs.promises.writeFile(
                    fileName,
                    JSON.stringify(split, undefined, 2),
                );
            }
            this.log(
                chalk.green(
                    `${file}: ${total} entries found. Split into ${splitData.length} files.`,
                ),
            );
        }
    }
}
