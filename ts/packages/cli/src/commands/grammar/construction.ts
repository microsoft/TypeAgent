// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import { convertConstructionFileToGrammar } from "agent-cache/grammar";
import fs from "node:fs";
export default class ConstructionsCommand extends Command {
    static description = "Generate grammar from construction file";

    static flags = {
        output: Flags.string({
            char: "o",
            description: "Output file (default is console)",
            required: false,
        }),
    };
    static args = {
        input: Args.file({ description: "Construction file", required: true }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConstructionsCommand);

        const grammar = await convertConstructionFileToGrammar(args.input);

        if (flags.output) {
            await fs.promises.writeFile(flags.output, grammar);
            console.log(`Grammar written to ${flags.output}`);
        } else {
            console.log(grammar);
        }
    }
}
