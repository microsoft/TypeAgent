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

/**
 * Validates a parsed agent group catalog structure.
 */
export function validateAgentGroupCatalog(
    data: unknown,
    source = "agent group catalog",
): AgentGroupCatalog {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error(`${source}: expected a root object.`);
    }

    const root = data as Record<string, unknown>;
    const rootFields = Object.keys(root);
    if (rootFields.some((field) => field !== "groups")) {
        throw new Error(
            `${source}: root contains unknown field(s): ${rootFields
                .filter((field) => field !== "groups")
                .join(", ")}.`,
        );
    }
    if (
        typeof root.groups !== "object" ||
        root.groups === null ||
        Array.isArray(root.groups)
    ) {
        throw new Error(`${source}: field 'groups' must be an object.`);
    }

    const rawGroups = root.groups as Record<string, unknown>;
    const validatedGroups: Record<string, AgentGroupDefinition> = {};
    const seenGroupKeys = new Set<string>();

    for (const [key, val] of Object.entries(rawGroups)) {
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

        if (typeof val !== "object" || val === null || Array.isArray(val)) {
            throw new Error(`${source}: group '${key}' must be an object.`);
        }

        const groupObj = val as Record<string, unknown>;
        const allowedFields = new Set(["displayName", "description", "agents"]);
        const unknownFields = Object.keys(groupObj).filter(
            (field) => !allowedFields.has(field),
        );
        if (unknownFields.length > 0) {
            throw new Error(
                `${source}: group '${key}' contains unknown field(s): ${unknownFields.join(", ")}.`,
            );
        }
        const displayName = groupObj.displayName;
        const normalizedDisplayName =
            typeof displayName === "string" ? displayName.trim() : "";
        if (
            typeof displayName !== "string" ||
            normalizedDisplayName.length === 0 ||
            normalizedDisplayName.length > 100
        ) {
            throw new Error(
                `${source}: group '${key}' field 'displayName' must be a non-empty string up to 100 characters.`,
            );
        }

        const description = groupObj.description;
        const normalizedDescription =
            typeof description === "string" ? description.trim() : "";
        if (
            typeof description !== "string" ||
            normalizedDescription.length === 0 ||
            normalizedDescription.length > 500
        ) {
            throw new Error(
                `${source}: group '${key}' field 'description' must be a non-empty string up to 500 characters.`,
            );
        }

        const agents = groupObj.agents;
        if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error(
                `${source}: group '${key}' field 'agents' must be a non-empty array.`,
            );
        }

        const validatedAgents: string[] = [];
        const seenMemberNames = new Set<string>();

        for (const agent of agents) {
            if (typeof agent !== "string" || !isLegalAgentName(agent)) {
                throw new Error(
                    `${source}: group '${key}' field 'agents' has invalid member '${String(agent)}'.`,
                );
            }

            const lowerAgent = agent.toLowerCase();
            if (seenMemberNames.has(lowerAgent)) {
                throw new Error(
                    `${source}: group '${key}' field 'agents' has duplicate member '${agent}' case-insensitively.`,
                );
            }
            seenMemberNames.add(lowerAgent);
            validatedAgents.push(agent);
        }

        validatedGroups[key] = {
            displayName: normalizedDisplayName,
            description: normalizedDescription,
            agents: Object.freeze(validatedAgents),
        };
        Object.freeze(validatedGroups[key]);
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
