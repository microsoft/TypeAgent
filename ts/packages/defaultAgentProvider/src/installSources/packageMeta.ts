// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

// A legal dispatcher agent identifier (matches existing agent names such as
// "github-cli", "osNotifications"). This is the single source of truth reused by
// the command handler and every source that must decide whether a declared
// `typeagent.defaultAgentName` can become an installed dispatcher name.
export const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function isLegalAgentName(name: string): boolean {
    return AGENT_NAME_RE.test(name);
}

/**
 * The metadata a source (or the registry) reads from a resolved package root's
 * `package.json` to support one-argument install: the npm package name and the
 * declared `typeagent.defaultAgentName`.
 */
export interface PackageMeta {
    // The npm package name (`package.json` `name`), when present.
    packageName?: string;
    // A legal declared `typeagent.defaultAgentName`, when present and legal.
    defaultAgentName?: string;
    // A declared `typeagent.defaultAgentName` that is present but not a legal
    // agent name. Surfaced so the caller can report it; it never becomes an
    // installed name and never matches a `findName` lookup.
    illegalDefaultAgentName?: string;
}

interface PackageJsonShape {
    name?: unknown;
    typeagent?: { defaultAgentName?: unknown } | undefined;
}

/**
 * Read `package.json` metadata from a resolved package root directory. Never
 * throws: a missing, unreadable, or unparseable `package.json` yields an empty
 * result so the two-argument (explicit-name) install path still resolves. A
 * declared but illegal `typeagent.defaultAgentName` is returned as
 * `illegalDefaultAgentName` (not `defaultAgentName`) so it is reported and never
 * installed.
 */
export function readPackageMeta(packageRoot: string): PackageMeta {
    let text: string;
    try {
        text = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    } catch {
        return {};
    }
    let parsed: PackageJsonShape;
    try {
        parsed = JSON.parse(text) as PackageJsonShape;
    } catch {
        return {};
    }
    const meta: PackageMeta = {};
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
        meta.packageName = parsed.name;
    }
    const declared = parsed.typeagent?.defaultAgentName;
    if (typeof declared === "string" && declared.length > 0) {
        if (isLegalAgentName(declared)) {
            meta.defaultAgentName = declared;
        } else {
            meta.illegalDefaultAgentName = declared;
        }
    }
    return meta;
}
