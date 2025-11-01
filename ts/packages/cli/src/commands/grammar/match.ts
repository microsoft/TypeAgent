// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { Args, Command, Flags } from "@oclif/core";
import {
    grammarFromJson,
    loadGrammarRules,
    matchGrammar,
    matchGrammarCompletion,
} from "action-grammar";

async function load(fileName: string) {
    const content = await fs.promises.readFile(fileName, "utf-8");

    return content === "{"
        ? grammarFromJson(JSON.parse(content))
        : loadGrammarRules(fileName, content);
}
export default class MatchCommand extends Command {
    static description = "Match input against a grammar";
    static flags = {
        completion: Flags.boolean({
            char: "c",
            description: "Show completion results",
        }),
    };
    static args = {
        grammar: Args.string({ description: "Grammar file", required: true }),
        input: Args.string({
            description: "Input string to match",
            required: true,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(MatchCommand);

        const grammar = await load(args.grammar);
        const completion = flags.completion;
        if (completion) {
            console.log(
                JSON.stringify(
                    matchGrammarCompletion(grammar, args.input),
                    null,
                    2,
                ),
            );
            return;
        }
        const result = matchGrammar(grammar, args.input);
        if (result.length > 0) {
            console.log("Matched:");
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log("No match");
        }
    }
}
