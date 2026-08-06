import { z } from "zod";

import { parseWithZod } from "./zodJson.js";

export const translationBenchActionShapeModeSchema = z.enum(["simple", "multi"]);

export const translationBenchActionShapePolicySchema = z
    .object({
        mode: translationBenchActionShapeModeSchema.default("simple"),
        maxActionsPerProbe: z.number().int().positive().default(1),
    })
    .strict()
    .superRefine((policy, ctx) => {
        if (policy.mode === "simple" && policy.maxActionsPerProbe !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["maxActionsPerProbe"],
                message: "simple shape requires maxActionsPerProbe === 1",
            });
        }
        if (policy.mode === "multi") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["mode"],
                message: "multi-action shape is not implemented yet; use simple",
            });
        }
    });

export type TranslationBenchActionShapeMode = z.infer<
    typeof translationBenchActionShapeModeSchema
>;
export type TranslationBenchActionShapePolicy = z.infer<
    typeof translationBenchActionShapePolicySchema
>;

export const TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE: Readonly<TranslationBenchActionShapePolicy> =
    Object.freeze({ mode: "simple" as const, maxActionsPerProbe: 1 });

export function normalizeTranslationBenchActionShapePolicy(
    policy?: Partial<TranslationBenchActionShapePolicy> | undefined,
): TranslationBenchActionShapePolicy {
    return parseWithZod(
        translationBenchActionShapePolicySchema,
        {
            mode: policy?.mode ?? "simple",
            // Multi is reserved (rejected by schema). Simple is always arity 1.
            maxActionsPerProbe: policy?.maxActionsPerProbe ?? 1,
        },
        "actionShape",
    );
}

export function assertTranslationBenchExpectedActionArity(
    expectedActions: readonly unknown[],
    role: "seed" | "positive" | "negative",
    policy: TranslationBenchActionShapePolicy = TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE,
    path = "probe",
): void {
    // Fail-closed: multi mode and illegal simple knobs rejected here.
    normalizeTranslationBenchActionShapePolicy(policy);
    const actions = parseWithZod(
        z.array(z.unknown()),
        expectedActions,
        `${path}.expectedActions`,
    );
    if (role === "negative") {
        if (actions.length !== 0) {
            throw new Error(`${path} negative case must have no expected actions`);
        }
        return;
    }
    if (actions.length !== 1) {
        throw new Error(
            `${path} simple-action ${role} must contain exactly one expected action`,
        );
    }
}
