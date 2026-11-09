// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    validateRecipeArtifact,
    validateRuntimeJsonSchema,
    type RecipeArtifact,
} from "./recipeCore.js";

type Shape =
    | "string"
    | "number"
    | "boolean"
    | "json"
    | "schema"
    | { array: Shape }
    | { enum: readonly (string | number | boolean)[] }
    | { object: Record<string, Shape>; optional?: string[] };

const strings: Shape = { array: "string" };
const identity: Record<string, Shape> = { id: "string", revision: "string" };
const specification: Shape = {
    object: {
        ...identity,
        intent: "string",
        outputRequirements: strings,
        rubric: "string",
        counterexamples: strings,
    },
};
const capability: Shape = {
    object: {
        id: "string",
        transport: { enum: ["native", "mcp"] },
        providerId: "string",
        operation: "string",
        contractVersion: "string",
        inputSchema: "schema",
        outputSchema: "schema",
        schemaDigest: "string",
        compatibility: { enum: ["exact"] },
        effect: { enum: ["read", "write", "unknown"] },
    },
    optional: ["outputSchema"],
};
const semantic: Shape = {
    object: {
        ...identity,
        inputSchema: "schema",
        outputSchema: "schema",
        specification: {
            object: { ...identity, task: "string", rubric: "string" },
        },
        modelPolicy: { object: identity },
        bounds: {
            object: {
                timeoutMs: "number",
                maxInputBytes: "number",
                maxOutputBytes: "number",
                maxCalls: "number",
                maxRepairAttempts: "number",
                maxConcurrency: "number",
            },
        },
        evidence: {
            object: {
                sourceIds: { enum: ["none", "known", "complete"] },
                quotations: "boolean",
            },
        },
    },
};
const generalization: Shape = {
    object: {
        kind: {
            enum: [
                "invariant",
                "parameter",
                "derived",
                "semantic",
                "host_owned",
                "guarded",
            ],
        },
        name: "string",
        value: "json",
        assumption: "string",
        evidenceIds: strings,
        producer: "string",
        guard: "string",
        resolverFunctionId: "string",
        scope: { enum: ["binding"] },
    },
    optional: [
        "value",
        "assumption",
        "producer",
        "guard",
        "resolverFunctionId",
        "scope",
    ],
};
const candidateShape: Shape = {
    object: {
        recipeId: "string",
        revision: "string",
        schemaVersion: { enum: [1] },
        kind: { enum: ["program"] },
        name: "string",
        description: "string",
        execution: { enum: ["symbolic", "hybrid"] },
        authorization: { enum: ["live_host"] },
        source: {
            object: {
                language: { enum: ["typescript"] },
                text: "string",
                digest: "string",
            },
        },
        executable: {
            object: {
                language: { enum: ["javascript"] },
                text: "string",
                digest: "string",
                sourceDigest: "string",
                compiler: {
                    object: {
                        name: "string",
                        version: "string",
                        optionsDigest: "string",
                    },
                },
                runtimeAbi: "string",
            },
        },
        inputSchema: "schema",
        outputSchema: "schema",
        output: {
            object: {
                kind: { enum: ["value", "content", "artifact"] },
                requirements: strings,
                identity: { enum: ["current_run"] },
            },
        },
        capabilities: { array: capability },
        semanticFunctions: { array: semantic },
        applicability: {
            object: { assumptions: strings, unsupported: strings },
        },
        generalization: { array: generalization },
        specification,
        matching: {
            object: {
                grammar: strings,
                examples: {
                    array: {
                        object: {
                            request: "string",
                            input: "json",
                            evidenceIds: strings,
                        },
                    },
                },
                negatives: strings,
                collisionEvidenceIds: strings,
            },
        },
        provenance: {
            object: {
                captureId: "string",
                taskId: "string",
                tokenId: "string",
                evidenceIds: strings,
                legacySource: {
                    object: { macroId: "string", version: "number" },
                },
            },
            optional: ["legacySource"],
        },
        fixtures: {
            array: {
                object: {
                    id: "string",
                    origin: { enum: ["observed", "synthetic", "independent"] },
                    result: { enum: ["passed", "failed"] },
                    specificationRevision: "string",
                    noLiveEffects: { enum: [true] },
                },
            },
        },
        createdAt: "string",
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const hasOwn = (value: object, key: string) =>
    Object.prototype.hasOwnProperty.call(value, key);

function json(value: unknown, depth: number): boolean {
    if (depth > 64) return false;
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    )
        return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every((item) => json(item, depth + 1));
    return (
        isRecord(value) &&
        Object.values(value).every((item) => json(item, depth + 1))
    );
}

function check(value: unknown, shape: Shape, path = "$", depth = 0): void {
    const invalid = () => {
        throw new Error(`Malformed candidate field ${path}.`);
    };
    if (depth > 64) return invalid();
    if (shape === "json") {
        if (!json(value, depth)) invalid();
        return;
    }
    if (shape === "schema") {
        if (validateRuntimeJsonSchema(value).length) invalid();
        return;
    }
    if (typeof shape === "string") {
        if (
            typeof value !== shape ||
            (shape === "number" && !Number.isFinite(value))
        )
            invalid();
        return;
    }
    if ("enum" in shape) {
        if (!shape.enum.some((item) => item === value)) invalid();
        return;
    }
    if ("array" in shape) {
        if (!Array.isArray(value)) return invalid();
        value.forEach((item, index) =>
            check(item, shape.array, `${path}[${index}]`, depth + 1),
        );
        return;
    }
    if (!isRecord(value)) return invalid();
    if (Object.keys(value).some((key) => !hasOwn(shape.object, key)))
        return invalid();
    for (const [key, child] of Object.entries(shape.object)) {
        if (!hasOwn(value, key) && shape.optional?.includes(key)) continue;
        check(value[key], child, `${path}.${key}`, depth + 1);
    }
}

// This validates child JSON structure before applying P1's integrity checks.
// It neither compiles source nor proves executable containment.
export function parseRecipeAuthorCandidate(text: string): RecipeArtifact {
    const value: unknown = JSON.parse(text);
    check(value, candidateShape);
    const candidate = value as RecipeArtifact;
    for (const item of candidate.generalization) {
        const required =
            item.kind === "invariant"
                ? ["value", "assumption"]
                : item.kind === "guarded"
                  ? ["producer", "guard", "resolverFunctionId", "scope"]
                  : ["producer"];
        const allowed = new Set(["kind", "name", "evidenceIds", ...required]);
        if (
            required.some((key) => !hasOwn(item, key)) ||
            Object.keys(item).some((key) => !allowed.has(key))
        )
            throw new Error("Generalization has invalid kind-specific fields.");
    }
    if (!Number.isFinite(Date.parse(candidate.createdAt)))
        throw new Error("Candidate creation timestamp is invalid.");
    const issues = validateRecipeArtifact(candidate);
    if (issues.length) throw new Error(issues[0].message);
    return candidate;
}
