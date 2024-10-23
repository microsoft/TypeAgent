// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function isInvalidPropertyName(name: string) {
    return (
        name === "__proto__" || name === "constructor" || name === "prototype"
    );
}
export function getObjectProperty(data: any, objectName: string, name: string) {
    if (name === "") {
        return data[objectName];
    }
    const properties = name.split(".");
    let lastName: string | number = objectName;
    let curr: any = data;
    for (let i = 0; i < properties.length; i++) {
        const name = properties[i];
        // Protect against prototype pollution
        if (isInvalidPropertyName(name)) {
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
    for (let i = 0; i < properties.length; i++) {
        const name = properties[i];
        // Protect against prototype pollution
        if (isInvalidPropertyName(name)) {
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
