// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { ScriptRecipe } from "./scriptRecipe.js";

export class PowerShellIntegrityError extends Error {
    readonly code = "powershell.integrityFailure";

    constructor(detail: string) {
        super(
            `${detail} Execution approval is not granted for this revision. Review and re-import the original script under a new name, or archive the PowerShell instance storage and explicitly reseed. Existing data has not been rebaselined.`,
        );
    }
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
            "Invalid PowerShell flow identifier. Use 1-100 ASCII letters, digits or underscores, starting with a letter; reserved names are not allowed.",
        );
    }
}

export function validatePowerShellPendingFilename(filename: string): void {
    if (typeof filename !== "string" || !filename.endsWith(".recipe.json")) {
        throw new PowerShellIntegrityError("Invalid pending recipe filename.");
    }
    validatePowerShellIdentifier(filename.slice(0, -".recipe.json".length));
}

// JSON values only; object keys sort by UTF-16 code unit, array order is retained.
// No whitespace, Unicode, newline or script-content normalization is performed.
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
        Object.getPrototypeOf(value) === Object.prototype
    ) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(value)
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

export type PowerShellRevisionMetadata = {
    actionName: string;
    parameters: ScriptRecipe["parameters"];
    sandbox: ScriptRecipe["sandbox"];
    expectedOutputFormat: ScriptRecipe["script"]["expectedOutputFormat"];
    source?: ScriptRecipe["source"] | undefined;
};

export function createPowerShellRevision(
    script: string,
    metadata: PowerShellRevisionMetadata,
): PowerShellRevision {
    validatePowerShellIdentifier(metadata.actionName);
    if (
        typeof script !== "string" ||
        !Array.isArray(metadata.parameters) ||
        !metadata.sandbox ||
        !Array.isArray(metadata.sandbox.allowedCmdlets) ||
        !Array.isArray(metadata.sandbox.allowedPaths) ||
        !Array.isArray(metadata.sandbox.allowedModules) ||
        typeof metadata.sandbox.networkAccess !== "boolean" ||
        !Number.isFinite(metadata.sandbox.maxExecutionTime)
    ) {
        throw new PowerShellIntegrityError(
            "Invalid PowerShell revision metadata.",
        );
    }
    const parameterNames = new Set<string>();
    for (const parameter of metadata.parameters) {
        if (!parameter || typeof parameter !== "object") {
            throw new PowerShellIntegrityError(
                "Invalid PowerShell parameter metadata.",
            );
        }
        validatePowerShellIdentifier(parameter.name);
        const lower = parameter.name.toLowerCase();
        if (parameterNames.has(lower)) {
            throw new PowerShellIntegrityError(
                "Duplicate PowerShell parameter name.",
            );
        }
        parameterNames.add(lower);
    }
    // Reject unpaired UTF-16 surrogates instead of hashing replacement bytes.
    if (Buffer.from(script, "utf8").toString("utf8") !== script) {
        throw new PowerShellIntegrityError("Script is not valid Unicode text.");
    }
    const scriptHash = powerShellFingerprint(script);
    return {
        version: 1,
        scriptHash,
        revisionHash: powerShellFingerprint(
            canonicalPowerShellJson({
                version: 1,
                scriptHash,
                actionName: metadata.actionName,
                parameters: metadata.parameters,
                sandbox: metadata.sandbox,
                expectedOutputFormat: metadata.expectedOutputFormat,
                provenance: metadata.source?.type ?? null,
                originalType: metadata.source?.originalType ?? null,
            }),
        ),
    };
}

export function verifyPowerShellRevision(
    recorded: PowerShellRevision,
    actual: PowerShellRevision,
): void {
    if (
        !recorded ||
        !actual ||
        recorded.version !== 1 ||
        actual.version !== 1 ||
        recorded.scriptHash !== actual.scriptHash ||
        recorded.revisionHash !== actual.revisionHash
    ) {
        throw new PowerShellIntegrityError(
            "PowerShell revision integrity check failed.",
        );
    }
}
