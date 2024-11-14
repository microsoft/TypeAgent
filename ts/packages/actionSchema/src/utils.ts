// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionParamType, ActionSchema } from "./type.js";

export function getParameterType(actionInfo: ActionSchema, name: string) {
    const propertyNames = name.split(".");
    if (propertyNames.shift() !== "parameters") {
        return undefined;
    }
    let curr: ActionParamType | undefined =
        actionInfo.definition.type.fields.parameters?.type;
    if (curr === undefined) {
        return undefined;
    }
    if (curr.type === "type-reference") {
        curr = curr.definition.type;
    }
    for (const propertyName of propertyNames) {
        const maybeIndex = parseInt(propertyName);
        if (maybeIndex.toString() == propertyName) {
            if (curr.type !== "array") {
                return undefined;
            }
            curr = curr.elementType;
        } else {
            if (curr.type !== "object") {
                return undefined;
            }
            curr = curr.fields[propertyName]?.type;
            if (curr === undefined) {
                return undefined;
            }
        }

        if (curr.type === "type-reference") {
            curr = curr.definition.type;
        }
    }
    return curr;
}

export function getParameterNames(
    actionInfo: ActionSchema,
    getCurrentValue: (name: string) => any,
) {
    const parameters = actionInfo.definition.type.fields.parameters?.type;
    if (parameters === undefined) {
        return [];
    }
    const pending: Array<[string, ActionParamType]> = [
        ["parameters", parameters],
    ];
    const result: string[] = [];
    while (true) {
        const next = pending.pop();
        if (next === undefined) {
            return result;
        }

        const [name, field] = next;
        switch (field.type) {
            case "type-union":
                // TODO: Implement this case
                break;
            case "type-reference":
                pending.push([name, field.definition.type]);
                break;
            case "object":
                for (const [key, value] of Object.entries(field.fields)) {
                    pending.push([`${name}.${key}`, value.type]);
                }
                break;
            case "array":
                const v = getCurrentValue(name);
                const newIndex = Array.isArray(v) ? v.length : 0;
                for (let i = 0; i <= newIndex; i++) {
                    pending.push([`${name}.${i}`, field.elementType]);
                }
                break;
            default:
                result.push(name);
        }
    }
}
