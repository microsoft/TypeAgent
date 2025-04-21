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
        const maybeIndex = parseInt(name);
        if (maybeIndex.toString() === name) {
            // Array index
            if (!Array.isArray(curr)) {
                return undefined;
            }
            curr = curr[maybeIndex];
        } else {
            if (typeof curr !== "object" || curr === null) {
                return undefined;
            }

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
            }
            curr = next;
            if (!Array.isArray(curr)) {
                throw new Error(`Internal error: ${lastName} is not an array`);
            }
            lastName = maybeIndex;
        } else {
            if (next === undefined || (override && typeof next !== "object")) {
                next = {};
                safeSetProperty(curr, lastName, next);
            }
            curr = next;
            if (typeof curr !== "object") {
                throw new Error(`Internal error: ${lastName} is not an object`);
            }
            lastName = name;
        }
    }
    safeSetProperty(curr, lastName, value);
}
