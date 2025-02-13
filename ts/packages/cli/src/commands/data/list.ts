// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command } from "@oclif/core";
import { readExplanationTestData } from "agent-dispatcher/internal";

export default class ExplanationDataListCommand extends Command {
    static args = {
        file: Args.file({
            description: "Data file",
            exists: true,
        }),
    };
    static description = "List all requests in the explanation data file";

    async run(): Promise<void> {
        const { args } = await this.parse(ExplanationDataListCommand);
        const data = await readExplanationTestData(args.file!);
        for (const entry of data.entries) {
            console.log(entry.request);
        }
    }
}
