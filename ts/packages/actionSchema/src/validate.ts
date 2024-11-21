// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaTypeArray,
    SchemaTypeObject,
    SchemaType,
    ActionSchema,
} from "./type.js";

export function validateSchema(
    name: string,
    expected: SchemaType,
    actual: unknown,
    coerce: boolean = false, // coerce string to the right primitive type
) {
    if (actual === null) {
        throw new Error(`'${name}' is null`);
    }
    switch (expected.type) {
        case "type-union": {
            for (const type of expected.types) {
                try {
                    validateSchema(name, type, actual, coerce);
                    return;
                } catch (e) {
                    // ignore
                }
            }
            throw new Error(`'${name}' does not match any union type`);
        }
        case "type-reference":
            validateSchema(name, expected.definition.type, actual, coerce);
            break;
        case "object":
            if (typeof actual !== "object" || Array.isArray(actual)) {
                throw new Error(`'${name}' is not an object: ${actual}`);
            }
            validateObject(
                name,
                expected,
                actual as Record<string, unknown>,
                coerce,
            );
            break;
        case "array":
            if (!Array.isArray(actual)) {
                throw new Error(`'${name}' is not an array: ${actual}`);
            }
            validateArray(name, expected, actual, coerce);
            break;
        case "string-union":
            if (typeof actual !== "string") {
                throw new Error(`'${name}' is not a string: ${actual}`);
            }
            if (!expected.typeEnum.includes(actual)) {
                throw new Error(`'${name}' is not in the enum: ${actual}`);
            }
            break;
        default:
            if (typeof actual !== expected.type) {
                if (coerce && typeof actual === "string") {
                    switch (expected.type) {
                        case "number":
                            const num = parseInt(actual);
                            if (num.toString() === actual) {
                                return num;
                            }
                            break;
                        case "boolean":
                            if (actual === "true") {
                                return true;
                            }
                            if (actual === "false") {
                                return false;
                            }
                            break;
                    }
                }
                throw new Error(
                    `'${name}' is not a ${expected.type}: ${actual}`,
                );
            }
    }
}

function validateArray(
    name: string,
    expected: SchemaTypeArray,
    actual: unknown[],
    coerce: boolean = false,
) {
    for (let i = 0; i < actual.length; i++) {
        const element = actual[i];
        const v = validateSchema(
            `${name}.${i}`,
            expected.elementType,
            element,
            coerce,
        );
        if (coerce && v !== undefined) {
            actual[i] = v;
        }
    }
}

function validateObject(
    name: string,
    expected: SchemaTypeObject,
    actual: Record<string, unknown>,
    coerce: boolean,
) {
    for (const field of Object.entries(expected.fields)) {
        const [fieldName, fieldInfo] = field;
        const actualField = actual[fieldName];
        const fullName = `${name}.${fieldName}`;
        if (actualField === undefined) {
            if (!fieldInfo.optional) {
                throw new Error(`Missing required field ${fullName}`);
            }
            continue;
        }
        const v = validateSchema(
            `${name}.${fieldName}`,
            fieldInfo.type,
            actualField,
            coerce,
        );
        if (coerce && v !== undefined) {
            actual[fieldName] = v;
        }
    }
}

export function validateAction(
    actionSchema: ActionSchema,
    action: any,
    coerce: boolean = false,
) {
    if (actionSchema.actionName !== action.actionName) {
        throw new Error(
            `Action name '${actionSchema.actionName}' expected, got '${action.actionName}' instead`,
        );
    }

    const parameters = action.parameters;
    const parameterType = actionSchema.definition.type.fields.parameters?.type;
    if (parameterType === undefined) {
        if (parameters !== undefined) {
            const keys = Object.keys(parameters);
            if (keys.length > 0) {
                throw new Error(
                    `Action has extraneous parameters : ${keys.join(", ")}`,
                );
            }
        }
        return;
    }

    if (parameters === undefined) {
        throw new Error("Missing parameter property");
    }

    if (
        parameters === null ||
        typeof parameters !== "object" ||
        Array.isArray(parameters)
    ) {
        throw new Error("Parameter object not an object");
    }

    validateObject(
        "parameters",
        parameterType as SchemaTypeObject, // already checked.
        parameters as Record<string, unknown>,
        coerce,
    );
    return;
}
