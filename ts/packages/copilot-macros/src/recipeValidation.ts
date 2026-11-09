// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { MacroLearningMode } from "./contracts.js";
import {
    recipeArtifactVersion,
    recipeRuntimeAbi,
    type RecipeArtifact,
    type RecipeCapability,
    type RecipePublicationState,
    type RuntimeJsonSchema,
} from "./recipeContracts.js";

export interface RecipeValidationIssue {
    path: string;
    code:
        | "invalid_schema"
        | "schema_mismatch"
        | "incompatible"
        | "invalid_artifact";
    message: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === "object" &&
        Object.prototype.toString.call(value) === "[object Object]"
    );
}

const hasOwn = (value: object, key: string) =>
    Object.prototype.hasOwnProperty.call(value, key);

const schemaKeys: Record<string, string[]> = {
    null: [],
    boolean: ["enum"],
    number: ["minimum", "maximum"],
    integer: ["minimum", "maximum"],
    string: ["enum", "minLength", "maxLength"],
    array: ["items", "minItems", "maxItems"],
    object: ["properties", "required", "additionalProperties"],
};

function schemaBoundError(
    schema: Record<string, unknown>,
    keys: string[],
): string | undefined {
    for (const key of keys.filter((key) => /^(min|max)/.test(key))) {
        const bound = schema[key];
        if (
            bound !== undefined &&
            (typeof bound !== "number" ||
                !Number.isFinite(bound) ||
                (key !== "minimum" &&
                    key !== "maximum" &&
                    (!Number.isInteger(bound) || bound < 0)))
        )
            return `Invalid bound: ${key}.`;
    }
    const pairs = [
        ["minimum", "maximum"],
        ["minLength", "maxLength"],
        ["minItems", "maxItems"],
    ];
    return pairs.some(
        ([min, max]) =>
            typeof schema[min] === "number" &&
            typeof schema[max] === "number" &&
            (schema[min] as number) > (schema[max] as number),
    )
        ? "Minimum exceeds maximum."
        : undefined;
}

function schemaIssues(
    schema: unknown,
    path: string,
    depth: number,
): RecipeValidationIssue[] {
    const invalid = (message: string): RecipeValidationIssue[] => [
        { path, code: "invalid_schema", message },
    ];
    if (depth > 64) return invalid("Schema nesting exceeds 64.");
    if (!record(schema) || typeof schema.type !== "string")
        return invalid("Schema must declare one supported type.");
    const keys = hasOwn(schemaKeys, schema.type)
        ? schemaKeys[schema.type]
        : undefined;
    if (!keys) return invalid(`Unsupported schema type: ${schema.type}.`);
    if (
        Object.keys(schema).some((key) => key !== "type" && !keys.includes(key))
    )
        return invalid("Unsupported schema keyword.");
    const boundError = schemaBoundError(schema, keys);
    if (boundError) return invalid(boundError);
    if (schema.enum !== undefined) {
        if (
            !Array.isArray(schema.enum) ||
            schema.enum.length === 0 ||
            schema.enum.some((value) => typeof value !== schema.type) ||
            new Set(schema.enum).size !== schema.enum.length
        )
            return invalid(
                "Enum must contain unique values of the declared type.",
            );
    }
    if (schema.type === "array")
        return schemaIssues(schema.items, `${path}.items`, depth + 1);
    if (schema.type !== "object") return [];
    if (!record(schema.properties) || schema.additionalProperties !== false)
        return invalid(
            "Objects require properties and additionalProperties: false.",
        );
    if (
        schema.required !== undefined &&
        (!Array.isArray(schema.required) ||
            schema.required.some(
                (key) =>
                    typeof key !== "string" ||
                    !hasOwn(schema.properties as object, key),
            ) ||
            new Set(schema.required).size !== schema.required.length)
    )
        return invalid("Required fields must name unique declared properties.");
    return Object.entries(schema.properties).flatMap(([key, child]) =>
        schemaIssues(child, `${path}.properties.${key}`, depth + 1),
    );
}

export function validateRuntimeJsonSchema(
    schema: unknown,
): RecipeValidationIssue[] {
    return schemaIssues(schema, "$", 0);
}

function withinBounds(
    value: number,
    minimum?: number,
    maximum?: number,
): boolean {
    return (
        (minimum === undefined || value >= minimum) &&
        (maximum === undefined || value <= maximum)
    );
}

function valueMatches(schema: RuntimeJsonSchema, value: unknown): boolean {
    switch (schema.type) {
        case "null":
            return value === null;
        case "boolean":
            return (
                typeof value === "boolean" &&
                (!schema.enum || schema.enum.includes(value))
            );
        case "number":
        case "integer":
            return (
                typeof value === "number" &&
                Number.isFinite(value) &&
                (schema.type !== "integer" || Number.isInteger(value)) &&
                withinBounds(value, schema.minimum, schema.maximum)
            );
        case "string":
            return (
                typeof value === "string" &&
                (!schema.enum || schema.enum.includes(value)) &&
                withinBounds(
                    [...value].length,
                    schema.minLength,
                    schema.maxLength,
                )
            );
        case "array":
            return (
                Array.isArray(value) &&
                withinBounds(value.length, schema.minItems, schema.maxItems) &&
                Array.from(value).every((item) =>
                    valueMatches(schema.items, item),
                )
            );
        case "object":
            return (
                record(value) &&
                (schema.required ?? []).every((key) => hasOwn(value, key)) &&
                Object.entries(value).every(
                    ([key, item]) =>
                        hasOwn(schema.properties, key) &&
                        valueMatches(schema.properties[key], item),
                )
            );
    }
}

export function validateRecipeValue(
    schema: RuntimeJsonSchema,
    value: unknown,
): RecipeValidationIssue[] {
    const issues = validateRuntimeJsonSchema(schema);
    if (issues.length) return issues;
    return valueMatches(schema, value)
        ? []
        : [
              {
                  path: "$",
                  code: "schema_mismatch",
                  message:
                      "Value does not satisfy the declared runtime schema.",
              },
          ];
}

function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${Array.from(value, canonical).join(",")}]`;
    if (record(value))
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`;
    const result = JSON.stringify(value);
    if (
        result === undefined ||
        (typeof value === "number" && !Number.isFinite(value))
    )
        throw new Error("Recipe identity requires finite JSON values.");
    return result;
}

export function recipeDigest(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export function recipeSchemaDigest(
    inputSchema: RuntimeJsonSchema,
    outputSchema?: RuntimeJsonSchema,
): string {
    return recipeDigest(
        canonical({ inputSchema, ...(outputSchema ? { outputSchema } : {}) }),
    );
}

function revisionDigest(artifact: Omit<RecipeArtifact, "revision">): string {
    return recipeDigest(canonical(artifact));
}

export function checkRecipeCapability(
    required: RecipeCapability,
    available: RecipeCapability,
): RecipeValidationIssue[] {
    const keys = [
        "id",
        "transport",
        "providerId",
        "operation",
        "contractVersion",
        "schemaDigest",
        "compatibility",
        "effect",
    ] as const;
    return required.compatibility === "exact" &&
        keys.every((key) => required[key] === available[key]) &&
        required.schemaDigest ===
            recipeSchemaDigest(required.inputSchema, required.outputSchema) &&
        required.schemaDigest ===
            recipeSchemaDigest(available.inputSchema, available.outputSchema)
        ? []
        : [
              {
                  path: required.id,
                  code: "incompatible",
                  message:
                      "Capability identity or exact schema contract changed.",
              },
          ];
}

type InvalidArtifact = (path: string, message: string) => void;

function validateArtifactIdentity(
    artifact: RecipeArtifact,
    invalid: InvalidArtifact,
): void {
    if (artifact.executable.runtimeAbi !== recipeRuntimeAbi)
        invalid("executable.runtimeAbi", "Unsupported runtime ABI.");
    if (
        artifact.source.language !== "typescript" ||
        artifact.executable.language !== "javascript" ||
        !artifact.executable.compiler.name ||
        !artifact.executable.compiler.version ||
        !artifact.executable.compiler.optionsDigest
    )
        invalid(
            "executable.compiler",
            "Source, executable, and compiler identities are required.",
        );
    if (
        recipeDigest(artifact.source.text) !== artifact.source.digest ||
        artifact.executable.sourceDigest !== artifact.source.digest ||
        recipeDigest(artifact.executable.text) !== artifact.executable.digest
    )
        invalid("executable", "Source/executable digest mismatch.");
    const { revision, ...content } = artifact;
    if (revision !== revisionDigest(content))
        invalid(
            "revision",
            "Recipe revision does not identify this immutable content.",
        );
    if (
        !artifact.recipeId ||
        artifact.authorization !== "live_host" ||
        artifact.output.identity !== "current_run"
    )
        invalid(
            "$",
            "Recipe identity, live authorization, and current output identity are required.",
        );
    if (
        !["symbolic", "hybrid"].includes(artifact.execution) ||
        (artifact.execution === "symbolic") !==
            (artifact.semanticFunctions.length === 0)
    )
        invalid(
            "execution",
            "Symbolic recipes have no semantic functions; hybrid recipes declare them.",
        );
}

function validateArtifactContracts(
    artifact: RecipeArtifact,
    invalid: InvalidArtifact,
): RuntimeJsonSchema[] {
    const schemas = [artifact.inputSchema, artifact.outputSchema];
    for (const capability of artifact.capabilities) {
        schemas.push(capability.inputSchema);
        if (capability.outputSchema) schemas.push(capability.outputSchema);
        if (
            capability.compatibility !== "exact" ||
            capability.schemaDigest !==
                recipeSchemaDigest(
                    capability.inputSchema,
                    capability.outputSchema,
                )
        )
            invalid(
                "capabilities",
                "Unsupported compatibility policy or invalid schema digest.",
            );
    }
    for (const fn of artifact.semanticFunctions) {
        schemas.push(fn.inputSchema, fn.outputSchema);
        if (
            !fn.id ||
            !fn.revision ||
            !fn.specification.id ||
            !fn.specification.revision ||
            !fn.specification.task ||
            !fn.specification.rubric ||
            !fn.modelPolicy.id ||
            !fn.modelPolicy.revision
        )
            invalid(
                "semanticFunctions",
                "Semantic specification and model policy identities are required.",
            );
        if (
            Object.entries(fn.bounds).some(
                ([key, value]) =>
                    !Number.isInteger(value) ||
                    value < (key === "maxRepairAttempts" ? 0 : 1),
            )
        )
            invalid(
                "semanticFunctions",
                "Semantic execution bounds must be positive integers (repairs may be zero).",
            );
    }
    for (const entries of [artifact.capabilities, artifact.semanticFunctions]) {
        if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
            invalid("$", "Duplicate capability or semantic function identity.");
    }
    return schemas;
}

function validateArtifactGrounding(
    artifact: RecipeArtifact,
    invalid: InvalidArtifact,
): void {
    if (
        !artifact.specification.id ||
        !artifact.specification.revision ||
        !artifact.specification.intent ||
        artifact.output.requirements.length === 0 ||
        !artifact.provenance.captureId ||
        !artifact.provenance.taskId ||
        !artifact.provenance.tokenId
    )
        invalid(
            "specification",
            "Specification, exact output requirements, and capture provenance are required.",
        );
    const knownEvidence = new Set(artifact.provenance.evidenceIds);
    for (const item of [
        ...artifact.generalization,
        ...artifact.matching.examples,
    ]) {
        if (
            item.evidenceIds.length === 0 ||
            item.evidenceIds.some((id) => !knownEvidence.has(id))
        )
            invalid(
                "generalization",
                "Generalization and matching examples require known grounding evidence.",
            );
    }
    for (const item of artifact.generalization) {
        if (
            item.kind === "guarded" &&
            (!item.guard ||
                !artifact.semanticFunctions.some(
                    (fn) => fn.id === item.resolverFunctionId,
                ))
        )
            invalid(
                "generalization",
                "Guarded bindings require a guard and a declared semantic resolver.",
            );
    }
}

export function validateRecipeArtifact(
    artifact: RecipeArtifact,
): RecipeValidationIssue[] {
    const issues: RecipeValidationIssue[] = [];
    const invalid: InvalidArtifact = (path, message) =>
        issues.push({ path, code: "invalid_artifact", message });
    if (
        !artifact ||
        artifact.schemaVersion !== recipeArtifactVersion ||
        artifact.kind !== "program"
    ) {
        invalid("$", "Unsupported recipe artifact version or kind.");
        return issues;
    }
    try {
        validateArtifactIdentity(artifact, invalid);
        const schemas = validateArtifactContracts(artifact, invalid);
        for (const schema of schemas)
            issues.push(...validateRuntimeJsonSchema(schema));
        validateArtifactGrounding(artifact, invalid);
    } catch {
        invalid("$", "Malformed recipe artifact or non-JSON content.");
    }
    return issues;
}

function freeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

// Compilation is not performed here. The publisher must supply checked output.
export function sealRecipeArtifact(
    artifact: Omit<RecipeArtifact, "revision">,
): RecipeArtifact {
    const copy = structuredClone(artifact);
    const result = { ...copy, revision: revisionDigest(copy) };
    const issues = validateRecipeArtifact(result);
    if (issues.length)
        throw new Error(issues.map((issue) => issue.message).join(" "));
    return freeze(result);
}

export function recipePublicationState(
    artifact: RecipeArtifact,
    mode: MacroLearningMode,
): RecipePublicationState {
    if (
        validateRecipeArtifact(artifact).length ||
        artifact.fixtures.length === 0 ||
        artifact.fixtures.some(
            (fixture) =>
                fixture.result !== "passed" ||
                fixture.specificationRevision !==
                    artifact.specification.revision,
        )
    )
        throw new Error(
            "Publication requires a valid artifact and passing specification-bound fixtures.",
        );
    if (mode === "off") return "candidate";
    if (mode === "prepare") return "prepared";
    if (
        mode === "read-only" &&
        artifact.capabilities.some((capability) => capability.effect !== "read")
    )
        return "prepared";
    return "ready";
}

export function isRecipeRunnable(state: RecipePublicationState): boolean {
    return state === "ready";
}
