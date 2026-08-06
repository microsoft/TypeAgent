// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared structural parameter types for translation-bench catalog generation.
 *
 * `ParamSpec` is the type-tree representation emitted by genCatalog and consumed
 * by the action-parameters grader. It is intentionally separate from
 * action-schema's completion `ParamSpec` strings (wildcard/time/…).
 *
 * Discriminant field is `kind` (full name — not a one-letter tag).
 */

export type ParamSpec =
    | { kind: "string"; enum?: string[] }
    | { kind: "number" }
    | { kind: "boolean" }
    | { kind: "array"; item: ParamSpec }
    | {
          kind: "object";
          fields: Record<string, { optional: boolean; spec: ParamSpec }>;
      }
    | { kind: "union"; arms: ParamSpec[] }
    | { kind: "any" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isParamSpec(value: unknown): value is ParamSpec {
    if (!isPlainObject(value)) {
        return false;
    }
    const kind = value.kind;
    switch (kind) {
        case "string": {
            if (value.enum === undefined) return true;
            return (
                Array.isArray(value.enum) &&
                value.enum.length > 0 &&
                value.enum.every((v) => typeof v === "string")
            );
        }
        case "number":
        case "boolean":
        case "any":
            return true;
        case "array":
            return isParamSpec(value.item);
        case "object": {
            const fields = value.fields;
            if (!isPlainObject(fields)) {
                return false;
            }
            return Object.values(fields).every((field) => {
                if (!isPlainObject(field)) {
                    return false;
                }
                return (
                    typeof field.optional === "boolean" &&
                    isParamSpec(field.spec)
                );
            });
        }
        case "union": {
            const arms = value.arms;
            return (
                Array.isArray(arms) &&
                arms.length > 0 &&
                arms.every((arm) => isParamSpec(arm))
            );
        }
        default:
            return false;
    }
}

/** Short kind tag for prompts / reports (not a full type pretty-printer). */
export function paramSpecKind(spec: ParamSpec): string {
    switch (spec.kind) {
        case "string":
            return spec.enum !== undefined ? "string-enum" : "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "array":
            return `array<${paramSpecKind(spec.item)}>`;
        case "object":
            return "object";
        case "union":
            return `union<${spec.arms.map(paramSpecKind).join("|")}>`;
        case "any":
            return "any";
    }
}

/**
 * Canonical JSON for fingerprints: sorted object keys, sorted enum values,
 * stable union arm order by kind then JSON.
 */
export function canonicalizeParamSpec(spec: ParamSpec): unknown {
    switch (spec.kind) {
        case "string": {
            if (spec.enum === undefined) return { kind: "string" };
            return { kind: "string", enum: [...spec.enum].sort() };
        }
        case "number":
        case "boolean":
        case "any":
            return { kind: spec.kind };
        case "array":
            return { kind: "array", item: canonicalizeParamSpec(spec.item) };
        case "object": {
            const fields: Record<string, unknown> = {};
            for (const name of Object.keys(spec.fields).sort()) {
                const f = spec.fields[name]!;
                fields[name] = {
                    optional: f.optional,
                    spec: canonicalizeParamSpec(f.spec),
                };
            }
            return { kind: "object", fields };
        }
        case "union": {
            const arms = spec.arms
                .map((arm) => canonicalizeParamSpec(arm))
                .map((arm) => JSON.stringify(arm))
                .sort()
                .map((s) => JSON.parse(s) as unknown);
            return { kind: "union", arms };
        }
    }
}
