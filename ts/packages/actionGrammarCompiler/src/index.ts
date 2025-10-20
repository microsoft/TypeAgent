// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import path from "node:path";
import fs from "node:fs";
import { grammarToJson, loadGrammarRules } from "action-grammar";

export default class Compile extends Command {
    static description = "Compile action schema files";

    static flags = {
        input: Flags.file({
            description: "Input action schema definition in typescript",
            required: true,
            exists: true,
            char: "i",
        }),
        output: Flags.string({
            description: "Output file for parsed action schema group",
            required: true,
            char: "o",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Compile);

        const name = path.basename(flags.input);

        const grammar = loadGrammarRules(
            name,
            fs.readFileSync(flags.input, "utf-8"),
        );

        const outputDir = path.dirname(flags.output);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(flags.output, JSON.stringify(grammarToJson(grammar)));
        console.log(`Action grammar written: ${flags.output}`);
    }
}
