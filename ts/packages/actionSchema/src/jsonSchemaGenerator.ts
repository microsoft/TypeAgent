// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sc from "./creator.js";
import { JsonSchema } from "./jsonSchemaTypes.js";
import {
    ActionSchemaEntryTypeDefinition,
    ActionSchemaGroup,
    SchemaObjectField,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";
export function wrapTypeWithJsonSchema(
    type: ActionSchemaEntryTypeDefinition,
): SchemaTypeDefinition {
    // The root of a Json schema is always an object
    // place the root type definition with an object with a response field of the type.
    return sc.type(type.name, sc.obj({ response: type.type }), undefined, true);
}

export type ActionObjectJsonSchema = {
    name: string;
    description?: string;
    strict: true;
    schema: JsonSchemaRoot;
};

type JsonSchemaRoot = JsonSchema & { $defs?: Record<string, JsonSchema> }; // REVIEW should be JsonSchemaObject;

function fieldComments(field: SchemaObjectField): string | undefined {
    const combined = [
        ...(field.comments ?? []),
        ...(field.trailingComments ?? []),
    ];
    return combined.length > 0 ? combined.join("\n").trim() : undefined;
}

function generateJsonSchemaType(
    type: SchemaType,
    pending: SchemaTypeDefinition[],
    strict: boolean,
): JsonSchema {
    switch (type.type) {
        case "object":
            return {
                type: "object",
                properties: Object.fromEntries(
                    Object.entries(type.fields).map(([key, field]) => {
                        const fieldType = generateJsonSchemaType(
                            field.type,
                            pending,
                            strict,
                        );
                        const comments = fieldComments(field);
                        // BUG: missing comment on fields with type references.
                        // See Issue https://github.com/OAI/OpenAPI-Specification/issues/1514
                        if (field.type.type !== "type-reference") {
                            if (comments) {
                                fieldType.description = comments;
                            }
                        }
                        return [key, fieldType];
                    }),
                ),
                required: Object.keys(type.fields), // OpenAI JSON schema requires all fields to be required
                additionalProperties: false,
            };
        case "array":
            return {
                type: "array",
                items: generateJsonSchemaType(
                    type.elementType,
                    pending,
                    strict,
                ),
            };
        case "string-union":
            return {
                type: "string",
                enum: type.typeEnum,
            };
        case "type-union":
            return {
                anyOf: type.types.map((t) =>
                    generateJsonSchemaType(t, pending, strict),
                ),
            };
        case "type-reference":
            if (type.definition) {
                pending.push(type.definition);
            } else if (strict) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            return {
                $ref: `#/$defs/${type.name}`,
            };
        case "undefined": {
            // Note: undefined is presented by null in JSON schema
            return { type: "null" };
        }
        case "any":
            return {};
        default:
            return { type: type.type };
    }
}

function generateJsonSchemaTypeWithDefs(
    type: SchemaType,
    strict: boolean = true,
) {
    const pending: SchemaTypeDefinition[] = [];
    const schema: JsonSchemaRoot = generateJsonSchemaType(
        type,
        pending,
        strict,
    );
    if (pending.length !== 0) {
        const $defs: Record<string, JsonSchema> = {};
        do {
            const definition = pending.shift()!;
            if ($defs[definition.name]) {
                continue;
            }
            $defs[definition.name] = generateJsonSchemaType(
                definition.type,
                pending,
                strict,
            );
            if (definition.comments) {
                $defs[definition.name].description =
                    definition.comments.join("\n");
            }
        } while (pending.length > 0);
        schema.$defs = $defs;
    }
    return schema;
}
function generateJsonSchemaTypeDefinition(
    def: SchemaTypeDefinition,
    strict: boolean = true,
): ActionObjectJsonSchema {
    const root: ActionObjectJsonSchema = {
        name: def.name,
        strict: true,
        schema: generateJsonSchemaTypeWithDefs(def.type, strict),
    };
    if (def.comments) {
        root.schema.description = def.comments.join("\n");
    }

    return root;
}

export function generateActionJsonSchema(actionSchemaGroup: ActionSchemaGroup) {
    const type = wrapTypeWithJsonSchema(actionSchemaGroup.entry);

    return generateJsonSchemaTypeDefinition(type);
}

export type ActionFunctionJsonSchema = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: JsonSchemaRoot;
        strict: true;
    };
};

export function generateActionActionFunctionJsonSchemas(
    actionSchemaGroup: ActionSchemaGroup,
    strict: boolean = true,
) {
    const entry = actionSchemaGroup.entry;
    const definitions: ActionSchemaEntryTypeDefinition[] = [entry];
    const tools: ActionFunctionJsonSchema[] = [];
    while (definitions.length !== 0) {
        const def = definitions.shift()!;
        switch (def.type.type) {
            case "object":
                const tool: ActionFunctionJsonSchema = {
                    type: "function",
                    function: {
                        name: def.type.fields.actionName.type.typeEnum[0],
                        strict: true,
                    },
                };

                const parameters = def.type.fields.parameters;
                if (parameters !== undefined) {
                    tool.function.parameters = generateJsonSchemaTypeWithDefs(
                        parameters.type,
                        strict,
                    );

                    const comments = fieldComments(parameters);
                    if (comments) {
                        tool.function.description = comments;
                    }
                } else {
                    tool.function.parameters = {
                        type: "object",
                        properties: {},
                        required: [],
                        additionalProperties: false,
                    };
                }
                tools.push(tool);
                break;
            case "type-union":
                for (const type of def.type.types) {
                    if (type.definition === undefined) {
                        if (strict && type.definition === undefined) {
                            throw new Error(
                                `Unresolved type reference: ${type.name}`,
                            );
                        }
                        continue;
                    }
                    definitions.push(type.definition);
                }
                break;
            case "type-reference":
                if (def.type.definition) {
                    definitions.push(def.type.definition);
                } else if (strict) {
                    throw new Error(
                        `Unresolved type reference: ${def.type.name}`,
                    );
                }
                break;
        }
    }

    return tools;
}
