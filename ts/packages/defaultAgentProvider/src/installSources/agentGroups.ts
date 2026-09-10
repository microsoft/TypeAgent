// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { isLegalAgentName } from "./packageMeta.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

export interface AgentGroupDefinition {
    readonly displayName: string;
    readonly description: string;
    readonly agents: readonly string[];
}

export interface AgentGroupCatalog {
    readonly groups: Readonly<Record<string, AgentGroupDefinition>>;
}

function requireObject(
    value: unknown,
    message: string,
): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(message);
    }
    return value as Record<string, unknown>;
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    messagePrefix: string,
): void {
    const unknownFields = Object.keys(value).filter(
        (field) => !allowed.has(field),
    );
    if (unknownFields.length > 0) {
        throw new Error(
            `${messagePrefix} contains unknown field(s): ${unknownFields.join(", ")}.`,
        );
    }
}

function requireBoundedString(
    value: unknown,
    maxLength: number,
    message: string,
): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length === 0 || normalized.length > maxLength) {
        throw new Error(message);
    }
    return normalized;
}

function validateGroupMembers(
    value: unknown,
    source: string,
    groupName: string,
): readonly string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
            `${source}: group '${groupName}' field 'agents' must be a non-empty array.`,
        );
    }
    const validated: string[] = [];
    const seen = new Set<string>();
    for (const member of value) {
        if (typeof member !== "string" || !isLegalAgentName(member)) {
            throw new Error(
                `${source}: group '${groupName}' field 'agents' has invalid member '${String(member)}'.`,
            );
        }
        const normalized = member.toLowerCase();
        if (seen.has(normalized)) {
            throw new Error(
                `${source}: group '${groupName}' field 'agents' has duplicate member '${member}' case-insensitively.`,
            );
        }
        seen.add(normalized);
        validated.push(member);
    }
    return Object.freeze(validated);
}

function validateGroupDefinition(
    value: unknown,
    source: string,
    groupName: string,
): AgentGroupDefinition {
    const group = requireObject(
        value,
        `${source}: group '${groupName}' must be an object.`,
    );
    rejectUnknownFields(
        group,
        new Set(["displayName", "description", "agents"]),
        `${source}: group '${groupName}'`,
    );
    return Object.freeze({
        displayName: requireBoundedString(
            group.displayName,
            100,
            `${source}: group '${groupName}' field 'displayName' must be a non-empty string up to 100 characters.`,
        ),
        description: requireBoundedString(
            group.description,
            500,
            `${source}: group '${groupName}' field 'description' must be a non-empty string up to 500 characters.`,
        ),
        agents: validateGroupMembers(group.agents, source, groupName),
    });
}

/**
 * Validates a parsed agent group catalog structure.
 */
export function validateAgentGroupCatalog(
    data: unknown,
    source = "agent group catalog",
): AgentGroupCatalog {
    const root = requireObject(data, `${source}: expected a root object.`);
    rejectUnknownFields(root, new Set(["groups"]), `${source}: root`);
    const rawGroups = requireObject(
        root.groups,
        `${source}: field 'groups' must be an object.`,
    );
    const validatedGroups: Record<string, AgentGroupDefinition> = {};
    const seenGroupKeys = new Set<string>();

    for (const [key, value] of Object.entries(rawGroups)) {
        if (!isLegalAgentName(key)) {
            throw new Error(
                `${source}: group '${key}' has an invalid name; expected the legal agent-name format.`,
            );
        }

        const lowerKey = key.toLowerCase();
        if (seenGroupKeys.has(lowerKey)) {
            throw new Error(
                `${source}: group '${key}' duplicates another group name case-insensitively.`,
            );
        }
        seenGroupKeys.add(lowerKey);
        validatedGroups[key] = validateGroupDefinition(value, source, key);
    }

    return Object.freeze({
        groups: Object.freeze(validatedGroups),
    });
}

/**
 * Loads and validates the agent group catalog from disk.
 */
export function loadAgentGroupCatalog(catalogPath?: string): AgentGroupCatalog {
    const filePath =
        catalogPath ?? getPackageFilePath("./data/agentGroups.json");
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch (err: unknown) {
        throw new Error(
            `Could not read agent group catalog from '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (err: unknown) {
        throw new Error(
            `Invalid JSON in agent group catalog '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    return validateAgentGroupCatalog(parsed, filePath);
}

/**
 * Case-insensitively finds a group in the catalog.
 */
export function findAgentGroup(
    catalog: AgentGroupCatalog,
    name: string,
): { key: string; group: AgentGroupDefinition } | undefined {
    const target = name.toLowerCase();
    for (const [key, group] of Object.entries(catalog.groups)) {
        if (key.toLowerCase() === target) {
            return { key, group };
        }
    }
    return undefined;
}
