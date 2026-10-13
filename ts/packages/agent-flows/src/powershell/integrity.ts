// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { getRequiredModules, type ScriptRecipe } from "./scriptRecipe.js";

export class PowerShellIntegrityError extends Error {
    readonly code = "powershell.integrityFailure";
}

export function validatePowerShellIdentifier(name: string): void {
    if (
        typeof name !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(name) ||
        Object.prototype.hasOwnProperty.call(Object.prototype, name) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|constructor|prototype)$/i.test(
            name,
        )
    ) {
        throw new PowerShellIntegrityError(
            "Invalid PowerShell flow name: use 1-100 letters, digits or underscores, starting with a letter; reserved names are not allowed.",
        );
    }
}

export function validatePowerShellPendingFilename(filename: string): void {
    if (typeof filename !== "string" || !filename.endsWith(".recipe.json")) {
        throw new PowerShellIntegrityError("Invalid pending recipe filename.");
    }
    validatePowerShellIdentifier(filename.slice(0, -".recipe.json".length));
}

export function canonicalPowerShellJson(value: unknown): string {
    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "string"
    ) {
        return JSON.stringify(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalPowerShellJson).join(",")}]`;
    }
    if (
        typeof value === "object" &&
        (Object.getPrototypeOf(value) === null ||
            Object.getPrototypeOf(Object.getPrototypeOf(value)) === null)
    ) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .filter((key) => record[key] !== undefined)
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${canonicalPowerShellJson(record[key])}`,
            )
            .join(",")}}`;
    }
    throw new PowerShellIntegrityError(
        "Execution metadata must contain only finite JSON values.",
    );
}

export function powerShellFingerprint(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface PowerShellRevision {
    version: 1;
    scriptHash: string;
    revisionHash: string;
}

type RevisionDefinition = Pick<
    ScriptRecipe,
    "actionName" | "parameters" | "sandbox" | "requiredModules" | "source"
>;

export function createPowerShellRevision(
    script: string,
    definition: RevisionDefinition,
): PowerShellRevision {
    validatePowerShellIdentifier(definition.actionName);
    if (
        typeof script !== "string" ||
        Buffer.from(script, "utf8").toString("utf8") !== script
    ) {
        throw new PowerShellIntegrityError("Script is not valid Unicode text.");
    }
    if (!Array.isArray(definition.parameters) || !definition.sandbox) {
        throw new PowerShellIntegrityError("Invalid PowerShell definition.");
    }
    const names = new Set<string>();
    for (const parameter of definition.parameters) {
        validatePowerShellIdentifier(parameter.name);
        const name = parameter.name.toLowerCase();
        if (names.has(name))
            throw new PowerShellIntegrityError(
                "Duplicate PowerShell parameter name.",
            );
        names.add(name);
    }
    const scriptHash = powerShellFingerprint(script);
    return {
        version: 1,
        scriptHash,
        revisionHash: powerShellFingerprint(
            canonicalPowerShellJson({
                contract: "approved-local-v1",
                scriptHash,
                actionName: definition.actionName,
                parameters: definition.parameters,
                requiredModules: getRequiredModules(definition),
                timeout: definition.sandbox.maxExecutionTime,
                provenance: definition.source?.type ?? null,
                originalType: definition.source?.originalType ?? null,
            }),
        ),
    };
}

export function matchesPowerShellRevision(
    recorded: PowerShellRevision,
    actual: PowerShellRevision,
): boolean {
    return (
        recorded?.version === actual.version &&
        recorded.scriptHash === actual.scriptHash &&
        recorded.revisionHash === actual.revisionHash
    );
}
