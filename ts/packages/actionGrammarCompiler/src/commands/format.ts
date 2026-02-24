// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import path from "node:path";
import fs from "node:fs";
import { parseGrammarRules, writeGrammarFile } from "action-grammar";

export default class Format extends Command {
    static description = "Format action grammar (.agr) files";

    static flags = {
        input: Flags.file({
            description: "Input .agr grammar file to format",
            required: true,
            exists: true,
            char: "i",
        }),
        write: Flags.boolean({
            description: "Overwrite the input file with formatted output",
            char: "w",
            default: false,
        }),
        output: Flags.string({
            description: "Write formatted output to a different file",
            char: "o",
        }),
        check: Flags.boolean({
            description:
                "Exit with non-zero status if the file is not already formatted (no output written)",
            char: "c",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Format);

        const content = fs.readFileSync(flags.input, "utf-8");

        let parseResult;
        try {
            parseResult = parseGrammarRules(flags.input, content);
        } catch (e) {
            console.error(`Failed to parse action grammar: ${e}`);
            process.exit(1);
        }

        const formatted = writeGrammarFile(parseResult);

        if (flags.check) {
            if (content !== formatted) {
                console.error(
                    `${flags.input} is not formatted. Run 'agc format --write' to fix.`,
                );
                process.exit(1);
            }
            return;
        }

        if (flags.write) {
            fs.writeFileSync(flags.input, formatted);
            console.log(`Formatted: ${flags.input}`);
        } else if (flags.output) {
            const outputDir = path.dirname(flags.output);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(flags.output, formatted);
            console.log(`Formatted grammar written: ${flags.output}`);
        } else {
            process.stdout.write(formatted);
        }
    }
}
