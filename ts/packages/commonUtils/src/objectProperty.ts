// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getObjectPropertyNames(obj: object) {
    const names: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "object") {
            const children = getObjectPropertyNames(value);
            for (const child of children) {
                names.push(`${key}.${child}`);
            }
        } else if (typeof value === "function") {
            throw new Error("Function is a valid value");
        } else {
            names.push(key);
        }
    }
    return names;
}

function safeGetProperty(obj: any, name: string | number) {
    // Protect against prototype pollution
    if (
        name === "__proto__" ||
        name === "constructor" ||
        name === "prototype"
    ) {
        throw new Error(`Invalid property name: ${name}`);
    }
    return obj[name];
}

export function getObjectProperty(data: any, name: string) {
    if (name === "") {
        return data;
    }
    let curr = data;
    const properties = name.split(".");
    for (const name of properties) {
        if (typeof curr !== "object" || curr === null) {
            // Can't index into a non-object
            return undefined;
        }
        const maybeIndex = parseInt(name);
        const isArrayIndex = maybeIndex.toString() === name;
        if (isArrayIndex !== Array.isArray(curr)) {
            return undefined;
        }

        if (isArrayIndex) {
            curr = curr[maybeIndex];
        } else {
            curr = safeGetProperty(curr, name);
        }
    }
    return curr;
}

function safeSetProperty(obj: any, name: string | number, value: any) {
    // Protect against prototype pollution
    if (
        name === "__proto__" ||
        name === "constructor" ||
        name === "prototype"
    ) {
        throw new Error(`Invalid property name: ${name}`);
    }
    obj[name] = value;
}

function canSetProperty(obj: any) {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

export function setObjectProperty(
    data: any,
    objectName: string,
    name: string,
    value: any,
    override: boolean = false,
) {
    const properties = name.split(".");
    let lastName: string | number = objectName;
    let curr = data;
    for (const name of properties) {
        let next = safeGetProperty(curr, lastName);
        const maybeIndex = parseInt(name);
        if (maybeIndex.toString() === name) {
            // Array index
            if (next === undefined || (override && !Array.isArray(next))) {
                next = [];
                safeSetProperty(curr, lastName, next);
            } else if (!Array.isArray(next)) {
                throw new Error(
                    `Cannot set index '${maybeIndex}' on object property '${lastName}'`,
                );
            }
            lastName = maybeIndex;
        } else {
            if (next === undefined || (override && !canSetProperty(next))) {
                next = {};
                safeSetProperty(curr, lastName, next);
            } else if (!canSetProperty(next)) {
                throw new Error(
                    `Cannot set property '${name}' on ${Array.isArray(next) ? "array" : next === null ? "null" : "non-object"} property '${lastName}'`,
                );
            }
            lastName = name;
        }
        curr = next;
    }
    safeSetProperty(curr, lastName, value);
}
