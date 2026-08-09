// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const require = createRequire(import.meta.url);

export const TRANSLATION_BENCH_POLICY_REASONS = [
    "original_request_echo",
    "multi_step_onboarding_workflow",
    "conversational_meta_action",
    "not_user_disambiguable",
    "internal_utility",
    "behavioral_alias",
    "echo_of_user_utterance",
    "open_ended_code_or_script_body",
    "soft_name_match",
    "literal_command_must_match",
] as const;

export type TranslationBenchPolicyReason =
    (typeof TRANSLATION_BENCH_POLICY_REASONS)[number];

export const TRANSLATION_BENCH_VERIFY_MODES = [
    "exact",
    "exists",
    "nonempty",
    "ignore",
    "llmAsAJudge",
] as const;

export type TranslationBenchPolicyVerifyMode =
    (typeof TRANSLATION_BENCH_VERIFY_MODES)[number];

const reasonSchema = z.enum(TRANSLATION_BENCH_POLICY_REASONS);
const verifySchema = z.enum(TRANSLATION_BENCH_VERIFY_MODES);

const actionIdSchema = z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\s.]+(\.[^\s.]+)+$/, "expected schemaName.actionName");

const fieldPathSchema = z
    .string()
    .trim()
    .min(1)
    .regex(
        /^[^\s.]+(\.[^\s.]+)+\.[^\s.]+$/,
        "expected schemaName.actionName.fieldName",
    );

const removedActionExactSchema = z
    .object({
        type: z.literal("action"),
        id: actionIdSchema,
        reasons: z.array(reasonSchema).min(1),
        notes: z.string().optional(),
    })
    .strict();

const removedActionPrefixSchema = z
    .object({
        type: z.literal("prefix"),
        prefix: z.literal("onboarding.*"),
        reasons: z.array(reasonSchema).min(1),
        notes: z.string().optional(),
    })
    .strict();

export const removedActionSchema = z.discriminatedUnion("type", [
    removedActionExactSchema,
    removedActionPrefixSchema,
]);

export type RemovedActionEntry = z.infer<typeof removedActionSchema>;

const parameterOverrideFieldSchema = z
    .object({
        type: z.literal("field"),
        path: fieldPathSchema,
        verify: verifySchema,
        reason: reasonSchema.optional(),
        notes: z.string().optional(),
    })
    .strict();

export const parameterOverrideSchema = parameterOverrideFieldSchema;
export type ParameterOverrideEntry = z.infer<typeof parameterOverrideSchema>;

export const actionEligibilityPolicySchema = z
    .object({
        version: z.literal(1),
        removedActions: z.array(removedActionSchema),
        parameterOverrides: z.array(parameterOverrideSchema),
    })
    .strict();

export type ActionEligibilityPolicy = z.infer<
    typeof actionEligibilityPolicySchema
>;

export interface ParameterFieldOverride {
    verify: TranslationBenchPolicyVerifyMode;
    reason?: string;
    notes?: string;
}

export interface LoadedActionEligibilityPolicy {
    policy: ActionEligibilityPolicy;
    contentHash: string;
    sourcePath: string;
    parameterOverrides: ReadonlyMap<string, ParameterFieldOverride>;
}

const POLICY_FILE_NAME = "action-eligibility.json";

export const TRANSLATION_BENCH_POLICY_DIR = path.dirname(
    fileURLToPath(import.meta.url),
);

let cachedPackaged: LoadedActionEligibilityPolicy | undefined;

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(obj).sort()) {
            out[key] = sortKeysDeep(obj[key]);
        }
        return out;
    }
    return value;
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value));
}

export function contentHashForPolicy(policy: ActionEligibilityPolicy): string {
    return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

export function parseActionEligibilityPolicy(
    raw: unknown,
    sourcePath = "<memory>",
): LoadedActionEligibilityPolicy {
    const parsed = actionEligibilityPolicySchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        throw new Error(
            `Invalid translation-bench action eligibility policy at ${sourcePath}: ${detail}`,
        );
    }
    const policy = parsed.data;

    const seenRemoved = new Set<string>();
    for (const entry of policy.removedActions) {
        const key =
            entry.type === "action" ? `action:${entry.id}` : `prefix:${entry.prefix}`;
        if (seenRemoved.has(key)) {
            throw new Error(
                `Duplicate removedActions entry '${key}' in ${sourcePath}`,
            );
        }
        seenRemoved.add(key);
    }

    const parameterOverrides = new Map<string, ParameterFieldOverride>();
    for (const entry of policy.parameterOverrides) {
        if (parameterOverrides.has(entry.path)) {
            throw new Error(
                `Duplicate parameterOverrides path '${entry.path}' in ${sourcePath}`,
            );
        }
        parameterOverrides.set(entry.path, {
            verify: entry.verify,
            ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
            ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
        });
    }

    return {
        policy,
        contentHash: contentHashForPolicy(policy),
        sourcePath,
        parameterOverrides,
    };
}

export function loadActionEligibilityPolicyFile(
    filePath: string,
): LoadedActionEligibilityPolicy {
    if (!existsSync(filePath)) {
        throw new Error(
            `Missing translation-bench action eligibility policy at ${filePath}`,
        );
    }
    const text = readFileSync(filePath, "utf8");
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch (err) {
        throw new Error(
            `Failed to parse translation-bench action eligibility policy JSON at ${filePath}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
    return parseActionEligibilityPolicy(raw, filePath);
}

export function getPackagedActionEligibilityPolicy(): LoadedActionEligibilityPolicy {
    if (cachedPackaged === undefined) {
        const candidate = path.join(TRANSLATION_BENCH_POLICY_DIR, POLICY_FILE_NAME);
        if (existsSync(candidate)) {
            cachedPackaged = loadActionEligibilityPolicyFile(candidate);
        } else {
            try {
                const resolved = require.resolve(`./${POLICY_FILE_NAME}`);
                cachedPackaged = loadActionEligibilityPolicyFile(resolved);
            } catch {
                throw new Error(
                    `Missing packaged action eligibility policy (${POLICY_FILE_NAME}) next to policy module`,
                );
            }
        }
    }
    return cachedPackaged;
}

export function clearPackagedActionEligibilityPolicyCacheForTests(): void {
    cachedPackaged = undefined;
}

export interface CatalogActionRef {
    schemaName: string;
    actionName: string;
}

export function catalogActionId(action: CatalogActionRef): string {
    return `${action.schemaName}.${action.actionName}`;
}

export function isOnboardingSchemaName(schemaName: string): boolean {
    return schemaName === "onboarding" || schemaName.startsWith("onboarding.");
}

export function expandRemovedActions(
    policy: ActionEligibilityPolicy,
    catalogActions: ReadonlyArray<CatalogActionRef>,
    options?: {
        allowMissingExactIds?: boolean;
    },
): {
    removedActionIds: ReadonlySet<string>;
} {
    const allowMissing = options?.allowMissingExactIds === true;
    const catalogIds = new Set(catalogActions.map((a) => catalogActionId(a)));
    const removed = new Set<string>();

    for (const entry of policy.removedActions) {
        if (entry.type === "action") {
            if (!catalogIds.has(entry.id)) {
                if (!allowMissing) {
                    throw new Error(
                        `removedActions id '${entry.id}' is not present in the catalog`,
                    );
                }
                continue;
            }
            removed.add(entry.id);
            continue;
        }
        const matched: string[] = [];
        for (const a of catalogActions) {
            if (isOnboardingSchemaName(a.schemaName)) {
                const id = catalogActionId(a);
                matched.push(id);
                removed.add(id);
            }
        }
        if (matched.length === 0 && !allowMissing) {
            throw new Error(
                `removedActions prefix '${entry.prefix}' matched zero catalog actions`,
            );
        }
    }

    return { removedActionIds: removed };
}

export function assertRemovedActionsMatchCatalog(
    policy: ActionEligibilityPolicy,
    catalogActions: ReadonlyArray<CatalogActionRef>,
): void {
    expandRemovedActions(policy, catalogActions, {
        allowMissingExactIds: false,
    });
}


