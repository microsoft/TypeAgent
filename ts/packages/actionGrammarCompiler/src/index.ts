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

        const errors: string[] = [];
        const warnings: string[] = [];
        const grammar = loadGrammarRules(
            flags.input,
            {
                resolvePath: (name: string, ref?: string) => {
                    return ref
                        ? path.resolve(path.dirname(ref), name)
                        : path.resolve(name);
                },
                readContent: (fullPath: string) => {
                    if (!fs.existsSync(fullPath)) {
                        throw new Error(`File not found: ${fullPath}`);
                    }
                    return fs.readFileSync(fullPath, "utf-8");
                },
                displayPath: (name: string) => {
                    return path.relative(process.cwd(), name);
                },
            },
            errors,
            warnings,
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
