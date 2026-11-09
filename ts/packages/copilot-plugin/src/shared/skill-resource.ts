// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ReadSkillFileRequest,
    SkillIdentity,
} from "@typeagent/agent-server-client";

export function skillResourceUri(
    identity: SkillIdentity,
    revision: string,
    filePath: string,
): string {
    validateSkillResourcePath(filePath);
    return `skill://typeagent/${encodeSegment(
        JSON.stringify(identity),
    )}/${encodeURIComponent(revision)}/${encodeURIComponent(
        identity.name,
    )}/${filePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;
}

export function parseSkillResourceUri(uri: URL): ReadSkillFileRequest {
    if (uri.protocol !== "skill:" || uri.hostname !== "typeagent") {
        throw new Error(`Unsupported skill resource URI: ${uri.href}`);
    }
    const parts = uri.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
        throw new Error(`Invalid skill resource URI: ${uri.href}`);
    }
    let identity: SkillIdentity;
    try {
        identity = JSON.parse(decodeSegment(parts[0])) as SkillIdentity;
    } catch {
        throw new Error(`Invalid skill identity in resource URI: ${uri.href}`);
    }
    if (decodeURIComponent(parts[2]) !== identity.name) {
        throw new Error(`Skill name does not match resource URI: ${uri.href}`);
    }
    const filePath = parts
        .slice(3)
        .map((part) => decodeURIComponent(part))
        .join("/");
    validateSkillResourcePath(filePath, uri.href);
    return {
        identity,
        revision: decodeURIComponent(parts[1]),
        path: filePath,
    };
}

export function validateSkillResourcePath(
    filePath: string,
    uri?: string,
): void {
    if (
        filePath.length === 0 ||
        filePath.startsWith("/") ||
        filePath.includes("\\") ||
        filePath.split("/").some((part) => part === "." || part === "..")
    ) {
        throw new Error(
            uri === undefined
                ? `Unsafe skill file path: ${filePath}`
                : `Unsafe skill file path in resource URI: ${uri}`,
        );
    }
}

function encodeSegment(value: string): string {
    return Buffer.from(value).toString("base64url");
}

function decodeSegment(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
}
