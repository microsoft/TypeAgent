// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type StripResult = { kept: true; value: unknown } | { kept: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEmptyGoldPlaceholder(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string" && value.trim() === "") {
        return true;
    }
    if (Array.isArray(value) && value.length === 0) {
        return true;
    }
    if (isPlainObject(value) && Object.keys(value).length === 0) {
        return true;
    }
    return false;
}

function childPath(path: string, key: string | number): string {
    if (typeof key === "number") {
        return `${path}[${key}]`;
    }
    return path === "" ? key : `${path}.${key}`;
}

function stripArray(
    value: unknown[],
    path: string,
    removed: string[],
): StripResult {
    const next: unknown[] = [];
    let changed = false;
    for (let i = 0; i < value.length; i += 1) {
        const child = stripEmptyGoldValue(
            value[i],
            childPath(path, i),
            removed,
        );
        if (!child.kept) {
            changed = true;
            continue;
        }
        if (child.value !== value[i]) {
            changed = true;
        }
        next.push(child.value);
    }
    if (next.length === 0) {
        removed.push(path);
        return { kept: false };
    }
    return { kept: true, value: changed ? next : value };
}

function stripObject(
    value: Record<string, unknown>,
    path: string,
    removed: string[],
): StripResult {
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [key, childValue] of Object.entries(value)) {
        const child = stripEmptyGoldValue(
            childValue,
            childPath(path, key),
            removed,
        );
        if (!child.kept) {
            changed = true;
            continue;
        }
        if (child.value !== childValue) {
            changed = true;
        }
        next[key] = child.value;
    }
    if (Object.keys(next).length === 0) {
        if (path !== "") {
            removed.push(path);
        }
        return { kept: false };
    }
    return { kept: true, value: changed ? next : value };
}

function stripEmptyGoldValue(
    value: unknown,
    path: string,
    removed: string[],
): StripResult {
    if (isEmptyGoldPlaceholder(value)) {
        removed.push(path);
        return { kept: false };
    }
    if (Array.isArray(value)) {
        return stripArray(value, path, removed);
    }
    if (isPlainObject(value)) {
        return stripObject(value, path, removed);
    }
    return { kept: true, value };
}

export function stripEmptyGoldPlaceholders(
    parameters: Record<string, unknown> | undefined,
): {
    parameters: Record<string, unknown> | undefined;
    removed: string[];
} {
    if (parameters === undefined) {
        return { parameters: undefined, removed: [] };
    }
    const removed: string[] = [];
    const stripped = stripEmptyGoldValue(parameters, "", removed);
    if (!stripped.kept) {
        return { parameters: undefined, removed };
    }
    if (stripped.value === parameters) {
        return { parameters, removed: [] };
    }
    return {
        parameters: stripped.value as Record<string, unknown>,
        removed,
    };
}
