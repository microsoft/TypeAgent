// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import {
    fromJSONParsedActionSchema,
    ParsedActionSchemaJSON,
    ActionSchemaTypeDefinition,
} from "@typeagent/action-schema";
import { Grammar } from "./grammarTypes.js";

/**
 * Enrich a Grammar with checked variable metadata from a .pas.json schema file
 *
 * Reads the schema file to find parameters with checked_wildcard paramSpec
 * and adds their variable names to grammar.checkedVariables
 *
 * @param grammar The grammar to enrich
 * @param schemaPath Path to the .pas.json file
 * @returns The enriched grammar (modifies in place and returns for chaining)
 */
export function enrichGrammarWithCheckedVariables(
    grammar: Grammar,
    schemaPath: string,
): Grammar {
    try {
        const jsonContent = fs.readFileSync(schemaPath, "utf8");
        const json: ParsedActionSchemaJSON = JSON.parse(jsonContent);
        const parsedSchema = fromJSONParsedActionSchema(json);

        const checkedVariables = new Set<string>();

        // Process each action to find parameters with checked_wildcard paramSpec
        for (const [
            _actionName,
            actionDef,
        ] of parsedSchema.actionSchemas.entries()) {
            const paramSpecs = (actionDef as ActionSchemaTypeDefinition)
                .paramSpecs;

            if (!paramSpecs || typeof paramSpecs !== "object") {
                continue;
            }

            // Find all parameters with checked_wildcard paramSpec
            for (const [paramName, paramSpec] of Object.entries(paramSpecs)) {
                if (paramSpec === "checked_wildcard") {
                    // Add the parameter name as a checked variable
                    // Also handle array element specs (e.g., "artists.*" -> "artist")
                    if (paramName.endsWith(".*")) {
                        const baseName = paramName.slice(0, -2);
                        // Convert plural to singular for grammar variable names
                        const singularName = getSingularVariableName(baseName);
                        checkedVariables.add(singularName);
                    } else {
                        checkedVariables.add(paramName);
                    }
                }
            }
        }

        // Add to grammar
        if (checkedVariables.size > 0) {
            grammar.checkedVariables = checkedVariables;
        }

        return grammar;
    } catch (error) {
        // If schema file doesn't exist or can't be read, return grammar unchanged
        console.warn(
            `Could not read schema file ${schemaPath} for checked variable metadata: ${error}`,
        );
        return grammar;
    }
}

/**
 * Convert plural parameter names to singular for grammar variable names
 * e.g., "artists" -> "artist", "devices" -> "device"
 */
function getSingularVariableName(plural: string): string {
    if (plural.endsWith("ies")) {
        return plural.slice(0, -3) + "y";
    } else if (plural.endsWith("ses") || plural.endsWith("shes")) {
        return plural.slice(0, -2);
    } else if (plural.endsWith("s")) {
        return plural.slice(0, -1);
    }
    return plural;
}
