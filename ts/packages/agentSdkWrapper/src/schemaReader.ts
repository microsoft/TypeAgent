// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import {
    fromJSONParsedActionSchema,
    ParsedActionSchemaJSON,
    ActionSchemaTypeDefinition,
    ParamSpec,
} from "@typeagent/action-schema";

/**
 * Information about a parameter's validation requirements
 */
export interface ParameterValidationInfo {
    parameterName: string;
    paramSpec?: ParamSpec; // e.g., "checked_wildcard", "ordinal", "number", etc.
    entityTypeName?: string; // e.g., "MusicDevice" if the parameter references an entity type
    isEntityType: boolean;
}

/**
 * Information about an action's parameters and their validation
 */
export interface ActionInfo {
    actionName: string;
    parameters: Map<string, ParameterValidationInfo>;
}

/**
 * Information about a built-in converter or parser available for entity types
 */
export interface ConverterInfo {
    name: string;
    description: string;
    examples: string[];
}

/**
 * Schema information for grammar generation
 */
export interface SchemaInfo {
    schemaName: string;
    actions: Map<string, ActionInfo>;
    entityTypes: Set<string>;
    converters: Map<string, ConverterInfo>; // Maps entity type to converter info
}

/**
 * Read and parse a .pas.json file to extract parameter validation information
 */
export function loadSchemaInfo(pasJsonPath: string): SchemaInfo {
    const jsonContent = fs.readFileSync(pasJsonPath, "utf8");
    const json: ParsedActionSchemaJSON = JSON.parse(jsonContent);
    const parsedSchema = fromJSONParsedActionSchema(json);

    // Extract schema name from path - use path.basename to avoid regex issues
    const fileName = pasJsonPath.split(/[/\\]/).pop() || "";
    const schemaName = fileName.replace(/\.pas\.json$/, "") || "unknown";
    const actions = new Map<string, ActionInfo>();
    const entityTypes = new Set<string>();

    // Collect entity types
    if (parsedSchema.entitySchemas) {
        for (const entityName of parsedSchema.entitySchemas.keys()) {
            entityTypes.add(entityName);
        }
    }

    // Process each action
    for (const [
        actionName,
        actionDef,
    ] of parsedSchema.actionSchemas.entries()) {
        const actionInfo: ActionInfo = {
            actionName,
            parameters: new Map(),
        };

        // Get parameter specs for this action
        const paramSpecs = (actionDef as ActionSchemaTypeDefinition).paramSpecs;

        // Extract parameter information
        const parametersField = actionDef.type.fields.parameters;
        if (parametersField) {
            const paramType = parametersField.type;
            if (paramType.type === "object") {
                for (const [paramName, field] of Object.entries(
                    paramType.fields,
                )) {
                    const validationInfo: ParameterValidationInfo = {
                        parameterName: paramName,
                        isEntityType: false,
                    };

                    // Check if this parameter has a paramSpec
                    if (paramSpecs && typeof paramSpecs === "object") {
                        const spec = paramSpecs[paramName];
                        if (spec) {
                            validationInfo.paramSpec = spec;
                        }

                        // Also check for array element specs (e.g., "artists.*")
                        const arraySpec = paramSpecs[`${paramName}.*`];
                        if (arraySpec) {
                            validationInfo.paramSpec = arraySpec;
                        }
                    }

                    // Check if this parameter references an entity type
                    if (field.type.type === "type-reference") {
                        const typeName = field.type.name;
                        if (entityTypes.has(typeName)) {
                            validationInfo.entityTypeName = typeName;
                            validationInfo.isEntityType = true;
                        }
                    } else if (
                        field.type.type === "array" &&
                        field.type.elementType.type === "type-reference"
                    ) {
                        const elementTypeName = field.type.elementType.name;
                        if (entityTypes.has(elementTypeName)) {
                            validationInfo.entityTypeName = elementTypeName;
                            validationInfo.isEntityType = true;
                        }
                    } else if (field.type.type === "type-union") {
                        // Handle union types like CalendarTime | CalendarTimeRange
                        // Collect all entity types in the union
                        const unionEntityTypes: string[] = [];
                        for (const unionType of field.type.types) {
                            if (unionType.type === "type-reference") {
                                const typeName = unionType.name;
                                if (entityTypes.has(typeName)) {
                                    unionEntityTypes.push(typeName);
                                }
                            }
                        }

                        if (unionEntityTypes.length > 0) {
                            // Use all entity types joined with |
                            validationInfo.entityTypeName =
                                unionEntityTypes.join(" | ");
                            validationInfo.isEntityType = true;
                        }
                    }

                    actionInfo.parameters.set(paramName, validationInfo);
                }
            }
        }

        actions.set(actionName, actionInfo);
    }

    // Add built-in converters based on schema name and entity types
    const converters = getConvertersForSchema(schemaName, entityTypes);

    return {
        schemaName,
        actions,
        entityTypes,
        converters,
    };
}

/**
 * Get converter information for entity types in a schema
 * This documents what built-in parsers/converters are available
 *
 * Note: This is currently hard-coded based on known converters. In the future,
 * converter information should be stored in the schema itself.
 */
function getConvertersForSchema(
    _schemaName: string,
    entityTypes: Set<string>,
): Map<string, ConverterInfo> {
    const converters = new Map<string, ConverterInfo>();

    // Built-in converters available to all schemas
    converters.set("Ordinal", {
        name: "Ordinal",
        description:
            "Converts ordinal words to numbers (first→1, second→2, etc.)",
        examples: [
            "first → 1",
            "second → 2",
            "third → 3",
            "fifth → 5",
            "tenth → 10",
        ],
    });

    converters.set("Number", {
        name: "Number",
        description: "Converts number words and digits to numeric values",
        examples: ["five → 5", "fifty → 50", "20 → 20", "one hundred → 100"],
    });

    converters.set("Boolean", {
        name: "Boolean",
        description: "Converts on/off, yes/no, true/false to boolean values",
        examples: ["on → true", "off → false", "yes → true", "no → false"],
    });

    converters.set("Percentage", {
        name: "Percentage",
        description: "Converts percentage expressions to numeric values",
        examples: ["50 percent → 50", "twenty percent → 20", "75% → 75"],
    });

    // Calendar-specific converters (inferred from entity types)
    if (entityTypes.has("CalendarDate")) {
        converters.set("CalendarDate", {
            name: "Calendar.Date",
            description:
                "Parses natural language date expressions (single dates, not ranges)",
            examples: [
                "tomorrow → CalendarDate",
                "next Monday → CalendarDate",
                "Friday → CalendarDate",
                "July 15 → CalendarDate",
                "today → CalendarDate",
                "2024-03-15 → CalendarDate",
            ],
        });
    }

    if (entityTypes.has("CalendarTime")) {
        converters.set("CalendarTime", {
            name: "Calendar.Time",
            description: "Parses single time expressions (not ranges)",
            examples: [
                "2pm → CalendarTime",
                "14:00 → CalendarTime",
                "noon → CalendarTime",
                "3:30pm → CalendarTime",
                "midnight → CalendarTime",
            ],
        });
    }

    if (entityTypes.has("CalendarTimeRange")) {
        converters.set("CalendarTimeRange", {
            name: "Calendar.TimeRange",
            description: "Parses time range expressions",
            examples: [
                "2pm to 3pm → CalendarTimeRange",
                "9am-10am → CalendarTimeRange",
                "from 2pm until 4pm → CalendarTimeRange",
                "1-2pm → CalendarTimeRange",
                "9:00am to 5:00pm → CalendarTimeRange",
            ],
        });
    }

    // Note: EventDescription, ParticipantName, and LocationName are NOT included
    // because they cannot be deterministically recognized. They can be arbitrary strings
    // like "under the water tower" for location or any event description.
    // For now, these must use plain string wildcards in grammars.
    // Future strategy: Generate two rules - one with entity type (when recognizable)
    // and one without (if it doesn't violate adjacent wildcard rules).

    // Music player converters
    if (entityTypes.has("MusicDevice")) {
        converters.set("MusicDevice", {
            name: "Player.MusicDevice",
            description: "Validates and resolves music playback device names",
            examples: [
                "bedroom speaker → MusicDevice",
                "kitchen → MusicDevice",
                "living room → MusicDevice",
            ],
        });
    }

    return converters;
}

/**
 * Get the wildcard type string for a parameter based on its validation info
 * This is used to generate the correct wildcard syntax in grammar rules
 */
export function getWildcardType(info: ParameterValidationInfo): string {
    // If it's an entity type, use the entity type name (new system)
    if (info.isEntityType && info.entityTypeName) {
        return info.entityTypeName;
    }

    // If it has a paramSpec that's not checked_wildcard, use it (old system)
    // checked_wildcard just means "validate this string", so it maps to "string"
    // but ordinal, number, percentage are specific types
    if (info.paramSpec && info.paramSpec !== "checked_wildcard") {
        return info.paramSpec;
    }

    // Otherwise, default to string
    return "string";
}

/**
 * Determine if a parameter should use a typed wildcard in the grammar
 */
export function shouldUseTypedWildcard(info: ParameterValidationInfo): boolean {
    // Use typed wildcards for:
    // 1. Entity types (e.g., MusicDevice)
    // 2. Checked wildcards that might have validation
    return info.isEntityType || info.paramSpec === "checked_wildcard";
}
