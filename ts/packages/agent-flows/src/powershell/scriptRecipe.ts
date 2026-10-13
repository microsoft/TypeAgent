// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ScriptRecipe {
    version: 1;
    actionName: string;
    description: string;
    displayName: string;
    parameters: ScriptParameter[];
    script: {
        language: "powershell";
        body: string;
        expectedOutputFormat: "text" | "json" | "objects" | "table";
    };
    grammarPatterns: GrammarPattern[];
    sandbox: SandboxPolicy;
    requiredModules?: string[] | undefined;
    source?: ScriptSource | undefined;
}

export type StoredScriptSourceType =
    | "reasoning"
    | "manual"
    | "seed"
    | "imported"
    | "edited";

export interface ScriptSource {
    type: StoredScriptSourceType;
    requestId?: string;
    timestamp: string;
    originalRequest?: string;
    originalType?:
        | Exclude<StoredScriptSourceType, "edited">
        | "unknown"
        | undefined;
}

export type ScriptExecutionProvenance =
    | "reviewed-static"
    | "generated"
    | "manual"
    | "seed"
    | "imported"
    | "edited";

export function getScriptExecutionProvenance(
    source: ScriptSource | undefined,
): ScriptExecutionProvenance | undefined {
    switch (source?.type) {
        case "reasoning":
            return "generated";
        case "manual":
        case "seed":
        case "imported":
            return source.type;
        case "edited":
            return source.originalType === undefined ||
                source.originalType === "unknown"
                ? undefined
                : "edited";
        default:
            return undefined;
    }
}

export function createEditedScriptSource(
    source: ScriptSource | undefined,
): ScriptSource {
    const originalType =
        source?.type === "edited"
            ? (source.originalType ?? "unknown")
            : (source?.type ?? "unknown");
    return {
        ...(source ?? {}),
        type: "edited",
        timestamp: new Date().toISOString(),
        originalType,
    };
}

export interface ScriptParameter {
    name: string;
    type: "string" | "number" | "boolean" | "path" | "executable";
    required: boolean;
    description: string;
    default?: unknown;
    validation?: {
        pattern?: string;
        allowedValues?: string[];
        pathMustExist?: boolean;
    };
}

export interface GrammarPattern {
    pattern: string;
    isAlias: boolean;
    examples: string[];
}

export interface SandboxPolicy {
    maxExecutionTime: number;
    // Accepted when loading older recipes, not execution restrictions.
    allowedCmdlets?: string[] | undefined;
    allowedPaths?: string[] | undefined;
    allowedModules?: string[] | undefined;
    networkAccess?: boolean | undefined;
}

export type ScriptCategory =
    | "file-operations"
    | "content-search"
    | "process-management"
    | "system-info"
    | "network"
    | "text-processing"
    | "other";

export function getRequiredModules(
    recipe: Pick<ScriptRecipe, "sandbox" | "requiredModules">,
): string[] {
    const modules =
        recipe.requiredModules ?? recipe.sandbox.allowedModules ?? [];
    if (
        !Array.isArray(modules) ||
        modules.length > 64 ||
        modules.some(
            (name) =>
                typeof name !== "string" || !name.trim() || name.length > 4096,
        )
    ) {
        throw new Error(
            "Required PowerShell modules must be a list of nonempty names or paths.",
        );
    }
    return [...modules];
}
