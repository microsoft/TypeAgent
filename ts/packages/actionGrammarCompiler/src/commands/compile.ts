// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import path from "node:path";
import fs from "node:fs";
import { grammarToJson, loadGrammarRulesNoThrow } from "action-grammar";

export default class Compile extends Command {
    static description = "Compile action grammar files";

    static flags = {
        input: Flags.file({
            description: "Input action grammar definition in typescript",
            required: true,
            exists: true,
            char: "i",
        }),
        output: Flags.string({
            description: "Output file for action grammar",
            required: true,
            char: "o",
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Compile);

        const errors: string[] = [];
        const warnings: string[] = [];
        const grammar = loadGrammarRulesNoThrow(
            flags.input,
            undefined,
            errors,
            warnings,
            { startValueRequired: true },
        );

        if (grammar === undefined) {
            console.error(
                `Failed to compile action grammar due to the following errors:\n${errors.join(
                    "\n",
                )}`,
            );
            process.exit(1);
        }

        if (warnings.length > 0) {
            console.warn(warnings.join("\n"));
        }
        const outputDir = path.dirname(flags.output);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(flags.output, JSON.stringify(grammarToJson(grammar)));
        console.log(`Action grammar written: ${flags.output}`);
    }
}
