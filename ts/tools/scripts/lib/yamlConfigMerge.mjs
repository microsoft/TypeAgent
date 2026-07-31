// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    if (isObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, clone(child)]),
        );
    }
    return value;
}

function merge(base, override) {
    if (!isObject(base) || !isObject(override)) {
        return clone(override);
    }
    const result = clone(base);
    for (const [key, value] of Object.entries(override)) {
        result[key] = key in result ? merge(result[key], value) : clone(value);
    }
    return result;
}

function getPath(tree, path) {
    let parent = tree;
    for (const segment of path) {
        if (!isObject(parent) || !(segment in parent)) {
            return { found: false };
        }
        parent = parent[segment];
    }
    return { found: true, value: parent };
}

function setPath(tree, path, value) {
    let parent = tree;
    for (const segment of path.slice(0, -1)) {
        if (!isObject(parent[segment])) {
            parent[segment] = {};
        }
        parent = parent[segment];
    }
    parent[path.at(-1)] = clone(value);
}

function deletePath(tree, path) {
    const parents = [];
    let parent = tree;
    for (const segment of path.slice(0, -1)) {
        if (!isObject(parent[segment])) return;
        parents.push([parent, segment]);
        parent = parent[segment];
    }
    delete parent[path.at(-1)];

    for (const [ancestor, segment] of parents.reverse()) {
        if (Object.keys(ancestor[segment]).length === 0) {
            delete ancestor[segment];
        } else {
            break;
        }
    }
}

function parsePaths(localOnlyPaths) {
    return localOnlyPaths.map((path) => path.split("."));
}

export function mergeYamlForPull(localTree, remoteTree, localOnlyPaths) {
    const merged = merge(localTree ?? {}, remoteTree ?? {});
    for (const path of parsePaths(localOnlyPaths)) {
        const local = getPath(localTree, path);
        if (local.found) {
            setPath(merged, path, local.value);
        } else {
            deletePath(merged, path);
        }
    }
    return merged;
}

export function mergeYamlForPush(localTree, remoteTree, localOnlyPaths) {
    const merged = merge(remoteTree ?? {}, localTree ?? {});
    for (const path of parsePaths(localOnlyPaths)) {
        deletePath(merged, path);
    }
    return merged;
}
