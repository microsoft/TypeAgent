// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { toStringSchemaType } from "./toString.js";
import {
    SchemaTypeArray,
    SchemaTypeObject,
    SchemaType,
    ActionSchemaTypeDefinition,
} from "./type.js";

function errorName(name: string) {
    return name === "" ? "Input" : `Field '${name}'`;
}

function indentMessage(message: string) {
    return `${message.replace(/\n/g, "\n    ")}`;
}

export function validateSchema(
    name: string,
    expected: SchemaType,
    actual: unknown,
    coerce: boolean = false, // coerce string to the right primitive type
) {
    if (actual === null) {
        throw new Error(`${errorName(name)} should not be null`);
    }
    switch (expected.type) {
        case "type-union": {
            const errors: [SchemaType, Error][] = [];
            for (const type of expected.types) {
                try {
                    validateSchema(name, type, actual, coerce);
                    return;
                } catch (e: any) {
                    errors.push([type, e]);
                }
            }
            const messages = errors
                .map(
                    ([type, e], i) =>
                        `\n-- Type: ${toStringSchemaType(type)}\n-- Error: ${indentMessage(e.message)}`,
                )
                .join("\n");

            throw new Error(
                `${errorName(name)} does not match any union type\n${messages}`,
            );
        }
        case "type-reference":
            if (expected.definition !== undefined) {
                validateSchema(name, expected.definition.type, actual, coerce);
            }
            break;
        case "object":
            if (typeof actual !== "object" || Array.isArray(actual)) {
                throw new Error(
                    `${errorName(name)} is not an object, got ${Array.isArray(actual) ? "array" : typeof actual} instead`,
                );
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
                throw new Error(
                    `${errorName(name)} is not an array, got ${typeof actual} instead`,
                );
            }
            validateArray(name, expected, actual, coerce);
            break;
        case "string-union":
            if (typeof actual !== "string") {
                throw new Error(
                    `${errorName(name)} is not a string, got ${typeof actual} instead`,
                );
            }
            if (!expected.typeEnum.includes(actual)) {
                const expectedValues =
                    expected.typeEnum.length === 1
                        ? `${expected.typeEnum[0]}`
                        : `one of ${expected.typeEnum.map((s) => `'${s}'`).join(",")}`;
                throw new Error(
                    `${errorName(name)} is not ${expectedValues}, got ${actual} instead`,
                );
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
                    `${errorName(name)} is not a ${expected.type}, got ${typeof actual} instead`,
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
    ignoreExtraneous?: string[],
) {
    for (const field of Object.entries(expected.fields)) {
        const [fieldName, fieldInfo] = field;
        const actualValue = actual[fieldName];
        const fullName = name ? `${name}.${fieldName}` : fieldName;
        if (actualValue === undefined) {
            if (!fieldInfo.optional) {
                throw new Error(`Missing required property '${fullName}'`);
            }
            continue;
        }
        const v = validateSchema(fullName, fieldInfo.type, actualValue, coerce);
        if (coerce && v !== undefined) {
            actual[fieldName] = v;
        }
    }

    for (const actualField of Object.keys(actual)) {
        if (
            !expected.fields[actualField] &&
            ignoreExtraneous?.includes(actualField) !== true
        ) {
            const fullName = name ? `${name}.${actualField}` : actualField;
            throw new Error(`Extraneous property '${fullName}'`);
        }
    }
}

export function validateAction(
    actionSchema: ActionSchemaTypeDefinition,
    action: any,
    coerce: boolean = false,
) {
    validateObject("", actionSchema.type, action, coerce, ["schemaName"]);
}

export function validateType(type: SchemaType, value: any) {
    validateSchema("", type, value);
}
