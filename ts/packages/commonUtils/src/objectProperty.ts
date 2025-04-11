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

export function getObjectProperty(data: any, objectName: string, name: string) {
    if (name === "") {
        return data[objectName];
    }
    const properties = name.split(".");
    let lastName: string | number = objectName;
    let curr: any = data;
    for (const name of properties) {
        // Protect against prototype pollution
        if (
            name === "__proto__" ||
            name === "constructor" ||
            name === "prototype"
        ) {
            throw new Error(`Invalid property name: ${name}`);
        }
        const next = curr[lastName];
        if (next === undefined) {
            return undefined;
        }
        const maybeIndex = parseInt(name);
        if (maybeIndex.toString() === name) {
            // Array index
            if (!Array.isArray(next)) {
                return undefined;
            }
            lastName = maybeIndex;
        } else {
            if (typeof next !== "object") {
                return undefined;
            }
            lastName = name;
        }
        curr = next;
    }
    return curr[lastName];
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
        // Protect against prototype pollution
        if (
            name === "__proto__" ||
            name === "constructor" ||
            name === "prototype"
        ) {
            throw new Error(`Invalid property name: ${name}`);
        }

        let next = curr[lastName];
        const maybeIndex = parseInt(name);
        if (maybeIndex.toString() === name) {
            // Array index
            if (next === undefined || (override && !Array.isArray(next))) {
                next = [];
                curr[lastName] = next;
            }
            curr = next;
            if (!Array.isArray(curr)) {
                throw new Error(`Internal error: ${lastName} is not an array`);
            }
            lastName = maybeIndex;
        } else {
            if (next === undefined || (override && typeof next !== "object")) {
                next = {};
                curr[lastName] = next;
            }
            curr = next;
            if (typeof curr !== "object") {
                throw new Error(`Internal error: ${lastName} is not an object`);
            }
            lastName = name;
        }
    }
    curr[lastName] = value;
}
