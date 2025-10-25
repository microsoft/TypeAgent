// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "yaml";
import { YAMLMacro } from "./types.mjs";

export class YAMLMacroParser {
    parse(yamlContent: string): YAMLMacro {
        try {
            const parsed = yaml.parse(yamlContent);

            if (!parsed || !parsed.macro) {
                throw new Error(
                    "Invalid YAML macro format: missing 'macro' section",
                );
            }

            this.validateMacroStructure(parsed);

            return parsed as YAMLMacro;
        } catch (error) {
            throw new Error(
                `Failed to parse YAML macro: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    stringify(yamlMacro: YAMLMacro): string {
        try {
            return yaml.stringify(yamlMacro, {
                indent: 2,
                lineWidth: 0,
            });
        } catch (error) {
            throw new Error(
                `Failed to stringify YAML macro: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private validateMacroStructure(parsed: any): void {
        const required = ["name", "version", "description", "author"];

        for (const field of required) {
            if (!parsed.macro[field]) {
                throw new Error(
                    `Invalid YAML macro: missing required field 'macro.${field}'`,
                );
            }
        }

        if (!parsed.macro.scope || !parsed.macro.scope.domain) {
            throw new Error(
                "Invalid YAML macro: missing required field 'macro.scope.domain'",
            );
        }

        if (
            !parsed.macro.parameters ||
            typeof parsed.macro.parameters !== "object"
        ) {
            throw new Error(
                "Invalid YAML macro: 'macro.parameters' must be an object",
            );
        }

        if (!Array.isArray(parsed.macro.steps)) {
            throw new Error(
                "Invalid YAML macro: 'macro.steps' must be an array",
            );
        }

        if (!parsed.metadata) {
            throw new Error("Invalid YAML macro: missing 'metadata' section");
        }
    }
}
