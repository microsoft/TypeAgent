// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { Args, Command } from "@oclif/core";
import { loadGrammar, matchGrammar } from "action-grammar";

export default class MatchCommand extends Command {
    static description = "Match input against a grammar";

    static args = {
        grammar: Args.string({ description: "Grammar file", required: true }),
        input: Args.string({
            description: "Input string to match",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args } = await this.parse(MatchCommand);

        const grammarContent = await fs.promises.readFile(
            args.grammar,
            "utf-8",
        );
        const grammar = loadGrammar(args.grammar, grammarContent);

        const result = matchGrammar(grammar, args.input);
        if (result) {
            console.log("Matched:");
            console.log(result);
        } else {
            console.log("No match");
        }
    }
}
