// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { SkillFileManifest, SkillIdentity } from "./types.js";

export function sha256(data: string | Uint8Array): string {
    return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(value: unknown): string {
    if (value === undefined) {
        return "null";
    }
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
}

export function qualifySkill(identity: SkillIdentity): string {
    if (!["builtin", "user", "project", "package"].includes(identity.scope)) {
        throw new Error(`Invalid skill scope: ${identity.scope}`);
    }
    validateIdentityPart(identity.origin, "origin");
    validateIdentityPart(identity.name, "name");
    return `${identity.scope}:${encodeURIComponent(identity.origin)}:${encodeURIComponent(identity.name)}`;
}

export function validateSkillPath(path: string): void {
    if (
        path.length === 0 ||
        path.length > 1024 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.includes("\0") ||
        path.includes(":") ||
        /^[A-Za-z]:/.test(path) ||
        /[\u0000-\u001f]/.test(path)
    ) {
        throw new Error(`Unsafe skill file path: ${path}`);
    }
    const parts = path.split("/");
    if (
        parts.some(
            (part) =>
                part === "" ||
                part === "." ||
                part === ".." ||
                part.endsWith(".") ||
                part.endsWith(" ") ||
                isWindowsDeviceName(part),
        )
    ) {
        throw new Error(`Unsafe skill file path: ${path}`);
    }
}

export function skillManifestDigest(
    manifest: readonly SkillFileManifest[],
): string {
    return sha256(
        canonicalJson(
            [...manifest]
                .map(({ path, sha256: digest, size }) => ({
                    path,
                    sha256: digest,
                    size,
                }))
                .sort((left, right) => left.path.localeCompare(right.path)),
        ),
    );
}

export function normalizedSkillPath(path: string): string {
    return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function isWindowsDeviceName(segment: string): boolean {
    const base = segment.split(".")[0].trimEnd().toUpperCase();
    return (
        ["CON", "PRN", "AUX", "NUL", "CLOCK$"].includes(base) ||
        /^(?:COM|LPT)[1-9]$/.test(base)
    );
}

function validateIdentityPart(value: string, field: string): void {
    if (
        value.trim() !== value ||
        value.length === 0 ||
        /[\u0000-\u001f]/.test(value)
    ) {
        throw new Error(`Invalid skill ${field}: ${value}`);
    }
}

export function skillStorageKey(identity: SkillIdentity): string {
    return sha256(qualifySkill(identity));
}

export function asBytes(content: string | Uint8Array): Uint8Array {
    return typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
}

export function cloneAndFreeze<T>(value: T): T {
    const clone = structuredClone(value);
    return deepFreeze(clone);
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        Object.freeze(value);
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
    }
    return value;
}
