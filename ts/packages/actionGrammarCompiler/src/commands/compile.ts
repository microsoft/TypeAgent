// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from "@oclif/core";
import path from "node:path";
import fs from "node:fs";
import {
    grammarToJson,
    loadGrammarRulesNoThrow,
    recommendedOptimizations,
    SchemaLoader,
} from "action-grammar";
import { parseSchemaSource } from "@typeagent/action-schema";
import type { SchemaTypeDefinition } from "@typeagent/action-schema";

/**
 * Creates a SchemaLoader that reads .ts files from disk and parses them
 * with actionSchema to resolve type definitions.
 * Results are cached per source file.
 * The source path is already resolved to an absolute path by the compiler.
 */
function createFileSchemaLoader(): SchemaLoader {
    // Cache: source path → map of type name → definition
    const cache = new Map<string, Map<string, SchemaTypeDefinition>>();

    return (
        typeName: string,
        source: string,
    ): SchemaTypeDefinition | undefined => {
        let typeMap = cache.get(source);
        if (typeMap === undefined) {
            if (fs.existsSync(source)) {
                try {
                    const content = fs.readFileSync(source, "utf-8");
                    typeMap = parseSchemaSource(content, source);
                } catch {
                    // If parsing fails, the type won't be resolved
                    // Validation will be silently skipped for this type
                    typeMap = new Map<string, SchemaTypeDefinition>();
                }
            } else {
                typeMap = new Map<string, SchemaTypeDefinition>();
            }
            cache.set(source, typeMap);
        }

        return typeMap.get(typeName);
    };
}

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
        debug: Flags.boolean({
            description:
                "Disable grammar optimizations (produces an unoptimized AST that preserves the 1:1 correspondence between top-level rules and the original source — useful for diagnostics).",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Compile);

        const errors: string[] = [];
        const warnings: string[] = [];
        const schemaLoader = createFileSchemaLoader();
        const grammar = loadGrammarRulesNoThrow(
            flags.input,
            undefined,
            errors,
            warnings,
            flags.debug
                ? { startValueRequired: true, schemaLoader }
                : {
                      startValueRequired: true,
                      schemaLoader,
                      optimizations: recommendedOptimizations,
                  },
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
