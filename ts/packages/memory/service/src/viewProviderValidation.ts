// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ViewProviderJson =
    | null
    | boolean
    | number
    | string
    | ViewProviderJson[]
    | { [key: string]: ViewProviderJson };

export interface ViewProviderIdentity {
    id: string;
    version: string;
    implementationSha256: string;
    schemaSha256: string;
}

export function validateViewProviderIdentity(
    identity: Readonly<ViewProviderIdentity>,
): void {
    if (
        !identity ||
        typeof identity.id !== "string" ||
        !/^[a-z][a-z0-9.-]{0,127}$/.test(identity.id) ||
        typeof identity.version !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$/.test(identity.version) ||
        typeof identity.implementationSha256 !== "string" ||
        typeof identity.schemaSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(identity.implementationSha256) ||
        !/^[a-f0-9]{64}$/.test(identity.schemaSha256) ||
        Object.keys(identity).some(
            (key) =>
                ![
                    "id",
                    "version",
                    "implementationSha256",
                    "schemaSha256",
                ].includes(key),
        )
    )
        throw new Error("Invalid installed view provider identity");
}

export function assertViewProviderJson(
    value: unknown,
): asserts value is ViewProviderJson {
    const seen = new Set<object>();
    function valid(entry: unknown, depth: number): boolean {
        if (
            entry === null ||
            typeof entry === "string" ||
            typeof entry === "boolean"
        )
            return true;
        if (typeof entry === "number") return Number.isFinite(entry);
        if (
            !entry ||
            typeof entry !== "object" ||
            depth >= 64 ||
            seen.has(entry)
        )
            return false;
        const prototype: object | null = Object.getPrototypeOf(entry);
        if (
            !Array.isArray(entry) &&
            prototype !== null &&
            Object.getPrototypeOf(prototype) !== null
        )
            return false;
        if (Array.isArray(entry) && Object.keys(entry).length !== entry.length)
            return false;
        seen.add(entry);
        const accepted = Object.values(entry).every((child) =>
            valid(child, depth + 1),
        );
        seen.delete(entry);
        return accepted;
    }
    if (!valid(value, 0))
        throw new Error(
            "View provider data must be finite, acyclic JSON with at most 64 object levels",
        );
}
