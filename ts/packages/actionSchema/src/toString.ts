// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaType } from "./type.js";

export function toStringSchemaType(
    type: SchemaType,
    paran: boolean = false,
): string {
    let result: string;
    switch (type.type) {
        case "any":
            return "any";
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "undefined":
            return "undefined";
        case "object":
            return `{ ${Object.entries(type.fields)
                .map(([name, field]) => {
                    return `${name}${field.optional ? "?" : ""}: ${toStringSchemaType(field.type)}`;
                })
                .join(", ")}}`;
        case "array":
            return `${toStringSchemaType(type.elementType, true)}[]`;
        case "type-reference":
            return type.definition ? type.definition.name : "unknown";
        case "string-union":
            result = type.typeEnum.join(" | ");
            paran = paran && type.typeEnum.length > 1;
            break;
        case "type-union":
            result = type.types.map((t) => toStringSchemaType(t)).join(" | ");
            paran = paran && type.types.length > 1;
            break;
        case "false":
            return "false";
        case "true":
            return "true";
    }
    return paran ? `(${result})` : result;
}
