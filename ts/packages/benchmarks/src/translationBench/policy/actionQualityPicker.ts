// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { z } from "zod";

import { parseLlmJsonWithZod } from "../synthesizer/llmJson.js";
import {
    catalogActionId,
    expandRemovedActions,
    getPackagedActionEligibilityPolicy,
    isOnboardingSchemaName,
    type CatalogActionRef,
} from "./loadPolicy.js";
import {
    listActionsWithLlmJudgeFields,
    type GraderByAction,
} from "./graderInspect.js";
import type {
    ActionParametersGraderCatalog,
    GeneratedActionCatalog,
} from "./policyGenerator.js";

const require = createRequire(import.meta.url);

export const ELIGIBLE_GOLD_ACTIONS_FILE = "eligible-gold-actions.generated.json";

const actionIdSchema = z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\s.]+(\.[^\s.]+)+$/, "expected schemaName.actionName");

const eligibleGoldArtifactSchema = z
    .object({
        version: z.literal(1),
        catalogVersion: z.string().trim().min(1),
        policyHash: z.string().trim().min(1),
        graderRulesFingerprint: z.string().trim().min(1),
        generatedAt: z.string().trim().min(1),
        model: z.string().trim().min(1),
        allowlist: z.array(actionIdSchema).min(1),
    })
    .strict();

export type EligibleGoldActionsArtifact = z.infer<
    typeof eligibleGoldArtifactSchema
>;

export type ActionQualityPickerLlm = {
    model: string;
    complete(prompt: string): Promise<string>;
};

const classifierBatchSchema = z
    .object({
        decisions: z
            .array(
                z
                    .object({
                        id: actionIdSchema,
                        include: z.boolean(),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

function loadClassifierTemplate(): string {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const local = path.join(dir, "action-quality.prompt.yaml");
    const filePath = existsSync(local)
        ? local
        : require.resolve("./action-quality.prompt.yaml");
    const doc = yaml.load(readFileSync(filePath, "utf8")) as {
        policy_classifier?: { template?: string };
    };
    const template = doc.policy_classifier?.template?.trim();
    if (!template) {
        throw new Error(`Invalid action-quality.prompt.yaml at ${filePath}`);
    }
    return template;
}

function renderTemplate(
    template: string,
    vars: Record<string, string>,
): string {
    return template.replace(
        /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
        (_, key: string) => {
            if (!(key in vars)) {
                throw new Error(`action-quality prompt missing '{{${key}}}'`);
            }
            return vars[key]!;
        },
    );
}

/** Cross-schema bare actionName collisions (single owner). */
export function ambiguousCrossSchemaActionIds(
    actions: ReadonlyArray<CatalogActionRef>,
    alreadyExcluded: ReadonlySet<string>,
): Set<string> {
    const byName = new Map<string, string[]>();
    for (const a of actions) {
        const id = catalogActionId(a);
        if (alreadyExcluded.has(id)) continue;
        const list = byName.get(a.actionName) ?? [];
        list.push(id);
        byName.set(a.actionName, list);
    }
    const out = new Set<string>();
    for (const ids of byName.values()) {
        if (ids.length > 1) {
            for (const id of ids) out.add(id);
        }
    }
    return out;
}

function catalogRefsFromGenerated(
    catalog: GeneratedActionCatalog,
): CatalogActionRef[] {
    return catalog.actions.map((a) => ({
        schemaName: a.schemaName,
        actionName: a.actionName,
    }));
}

export async function pickEligibleGoldActions(
    catalog: GeneratedActionCatalog,
    grader: ActionParametersGraderCatalog,
    options: {
        llm: ActionQualityPickerLlm;
        batchSize?: number;
    },
): Promise<EligibleGoldActionsArtifact> {
    const policy = getPackagedActionEligibilityPolicy();
    const refs = catalogRefsFromGenerated(catalog);
    const humanRemoved = expandRemovedActions(policy.policy, refs, {
        allowMissingExactIds: false,
    }).removedActionIds;

    const excluded = new Set<string>(humanRemoved);
    for (const id of ambiguousCrossSchemaActionIds(refs, excluded)) {
        excluded.add(id);
    }
    for (const id of listActionsWithLlmJudgeFields(grader)) {
        excluded.add(id);
    }

    const candidates: { id: string; description?: string }[] = [];
    for (const a of catalog.actions) {
        const id = catalogActionId(a);
        if (excluded.has(id)) continue;
        if (grader.byAction[id] === undefined) {
            throw new Error(`action quality picker: grader missing '${id}'`);
        }
        candidates.push({
            id,
            ...(a.description !== undefined
                ? { description: a.description }
                : {}),
        });
    }
    if (candidates.length === 0) {
        throw new Error("action quality picker: no candidates after hard filters");
    }

    const template = loadClassifierTemplate();
    const batchSize = options.batchSize ?? 40;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) {
        throw new Error("action quality picker batchSize must be 1..64");
    }
    const include: string[] = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const expected = new Set(batch.map((c) => c.id));
        const text = await options.llm.complete(
            renderTemplate(template, {
                candidates_json: JSON.stringify(
                    batch.map((c) => ({
                        id: c.id,
                        description: c.description ?? "",
                    })),
                    null,
                    2,
                ),
            }),
        );
        const parsed = parseLlmJsonWithZod(
            text,
            classifierBatchSchema,
            "action-quality classifier batch",
        );
        const seen = new Set<string>();
        for (const d of parsed.decisions) {
            if (!expected.has(d.id) || seen.has(d.id)) {
                throw new Error(
                    `action-quality classifier bad id '${d.id}' in batch ${i}`,
                );
            }
            seen.add(d.id);
            if (d.include) include.push(d.id);
        }
        for (const id of expected) {
            if (!seen.has(id)) {
                throw new Error(
                    `action-quality classifier missing '${id}' in batch ${i}`,
                );
            }
        }
    }
    const allowlist = include.sort();
    if (allowlist.length === 0) {
        throw new Error("action quality picker produced an empty allowlist");
    }

    const graderRulesFingerprint = grader.rulesFingerprint;
    if (
        graderRulesFingerprint === undefined ||
        graderRulesFingerprint.length === 0
    ) {
        throw new Error(
            "action quality picker requires grader.rulesFingerprint",
        );
    }

    return {
        version: 1,
        catalogVersion: catalog.catalogVersion,
        policyHash: policy.contentHash,
        graderRulesFingerprint,
        generatedAt: new Date().toISOString(),
        model: options.llm.model,
        allowlist,
    };
}

export function contentHashEligibleGoldActions(
    artifact: EligibleGoldActionsArtifact,
): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                allowlist: [...artifact.allowlist].sort(),
                policyHash: artifact.policyHash,
                catalogVersion: artifact.catalogVersion,
                graderRulesFingerprint: artifact.graderRulesFingerprint,
                model: artifact.model,
            }),
        )
        .digest("hex");
}

let cachedAllowlist:
    | {
          allowlist: ReadonlySet<string>;
          contentHash: string;
          sourcePath: string;
          artifact: EligibleGoldActionsArtifact;
      }
    | undefined;

export function clearPackagedEligibleGoldActionsCacheForTests(): void {
    cachedAllowlist = undefined;
}


function resolvePackagedJsonPath(fileName: string): string {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(dir, "..", fileName),
        path.join(dir, fileName),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (found !== undefined) return found;
    try {
        return require.resolve(`../${fileName}`);
    } catch {
        throw new Error(`Missing packaged ${fileName}`);
    }
}

/** Packaged grader for integrity/schedule (no policyGenerator import — avoids cycle). */
export function loadPackagedGraderForEligibility(): GraderByAction {
    const filePath = resolvePackagedJsonPath(
        "action-parameters-grader.generated.json",
    );
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as GraderByAction;
    if (
        raw === null ||
        typeof raw !== "object" ||
        raw.byAction === undefined ||
        typeof raw.byAction !== "object"
    ) {
        throw new Error(`Invalid packaged grader at ${filePath}`);
    }
    const fp = raw.rulesFingerprint?.trim();
    if (!fp) {
        throw new Error(
            `Packaged grader missing rulesFingerprint at ${filePath}`,
        );
    }
    return raw;
}

function assertAllowlistIntegrity(
    artifact: EligibleGoldActionsArtifact,
    sourcePath: string,
): void {
    const unique = new Set(artifact.allowlist);
    if (unique.size !== artifact.allowlist.length) {
        throw new Error(
            `Duplicate allowlist ids in eligible gold actions at ${sourcePath}`,
        );
    }

    const policy = getPackagedActionEligibilityPolicy();
    if (artifact.policyHash !== policy.contentHash) {
        throw new Error(
            `eligible gold actions policyHash mismatch at ${sourcePath}`,
        );
    }

    for (const entry of policy.policy.removedActions) {
        if (entry.type === "action" && unique.has(entry.id)) {
            throw new Error(
                `eligible gold allowlist contains human-removed '${entry.id}' at ${sourcePath}`,
            );
        }
    }
    for (const id of unique) {
        const schemaName = id.split(".")[0] ?? "";
        if (isOnboardingSchemaName(schemaName)) {
            throw new Error(
                `eligible gold allowlist contains onboarding id '${id}' at ${sourcePath}`,
            );
        }
    }

    const grader = loadPackagedGraderForEligibility();
    if (artifact.graderRulesFingerprint !== grader.rulesFingerprint) {
        throw new Error(
            `eligible gold actions graderRulesFingerprint mismatch at ${sourcePath} ` +
                `(artifact=${artifact.graderRulesFingerprint}, live=${grader.rulesFingerprint}). ` +
                `Run pnpm pick-eligible-actions --model <model>`,
        );
    }
    for (const id of listActionsWithLlmJudgeFields(grader)) {
        if (unique.has(id)) {
            throw new Error(
                `eligible gold allowlist contains llmAsAJudge action '${id}' at ${sourcePath}`,
            );
        }
    }

    const catalogPath = resolvePackagedJsonPath("catalog.generated.json");
    const catalog = JSON.parse(
        readFileSync(catalogPath, "utf8"),
    ) as GeneratedActionCatalog;
    if (artifact.catalogVersion !== catalog.catalogVersion) {
        throw new Error(
            `eligible gold actions catalogVersion mismatch at ${sourcePath} ` +
                `(artifact=${artifact.catalogVersion}, live=${catalog.catalogVersion})`,
        );
    }
    const catalogIds = new Set(catalog.actions.map((a) => catalogActionId(a)));
    for (const id of unique) {
        if (!catalogIds.has(id)) {
            throw new Error(
                `eligible gold allowlist id '${id}' not in catalog at ${sourcePath}`,
            );
        }
    }
    const refs = catalogRefsFromGenerated(catalog);
    const human = expandRemovedActions(policy.policy, refs, {
        allowMissingExactIds: false,
    }).removedActionIds;
    const ambiguous = ambiguousCrossSchemaActionIds(refs, human);
    for (const id of unique) {
        if (human.has(id) || ambiguous.has(id)) {
            throw new Error(
                `eligible gold allowlist contains hard-excluded '${id}' at ${sourcePath}`,
            );
        }
    }
}

export function getPackagedEligibleGoldActionIds(): {
    allowlist: ReadonlySet<string>;
    contentHash: string;
    sourcePath: string;
    artifact: EligibleGoldActionsArtifact;
} {
    if (cachedAllowlist !== undefined) {
        return cachedAllowlist;
    }
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(dir, "..", ELIGIBLE_GOLD_ACTIONS_FILE),
        path.join(dir, ELIGIBLE_GOLD_ACTIONS_FILE),
    ];
    let filePath = candidates.find((p) => existsSync(p));
    if (filePath === undefined) {
        try {
            filePath = require.resolve(`../${ELIGIBLE_GOLD_ACTIONS_FILE}`);
        } catch {
            throw new Error(
                `Missing packaged ${ELIGIBLE_GOLD_ACTIONS_FILE}; run pnpm pick-eligible-actions --model <model>`,
            );
        }
    }
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    } catch (err) {
        throw new Error(
            `Failed to parse eligible gold actions at ${filePath}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
    const parsed = eligibleGoldArtifactSchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        throw new Error(
            `Invalid eligible gold actions artifact at ${filePath}: ${detail}`,
        );
    }
    assertAllowlistIntegrity(parsed.data, filePath);
    cachedAllowlist = {
        allowlist: new Set(parsed.data.allowlist),
        contentHash: contentHashEligibleGoldActions(parsed.data),
        sourcePath: filePath,
        artifact: parsed.data,
    };
    return cachedAllowlist;
}

