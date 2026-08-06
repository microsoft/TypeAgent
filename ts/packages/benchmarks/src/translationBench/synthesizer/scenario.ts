import { z } from "zod";

import { parseWithZod } from "./zodJson.js";

export const translationBenchScenarioSchema = z
    .object({
        id: z.string().trim().min(1),
        history: z
            .object({
                mode: z.enum(["case", "none"]),
                limit: z.number().int().nonnegative(),
            })
            .strict(),
        recentActions: z
            .object({
                enabled: z.boolean(),
                limit: z.number().int().nonnegative(),
            })
            .strict(),
        additionalInstructions: z.boolean(),
        entityPromptShape: z.enum(["facets", "flat", "facets-with-schema"]),
        userContext: z.enum(["none", "active-schema"]),
        activityContext: z.literal("none"),
        schemaOptimization: z
            .object({
                enabled: z.boolean(),
                numInitialActions: z.number().int().nonnegative(),
            })
            .strict(),
    })
    .strict();

export type TranslationBenchScenario = z.infer<
    typeof translationBenchScenarioSchema
>;

export function getDefaultTranslationBenchScenario(): TranslationBenchScenario {
    return parseWithZod(
        translationBenchScenarioSchema,
        {
            id: "baseline",
            history: { mode: "case", limit: 20 },
            recentActions: { enabled: true, limit: 3 },
            additionalInstructions: true,
            entityPromptShape: "facets-with-schema",
            userContext: "none",
            activityContext: "none",
            schemaOptimization: { enabled: false, numInitialActions: 5 },
        },
        "defaultScenario",
    );
}

export function parseTranslationBenchScenario(
    value: unknown,
): TranslationBenchScenario {
    return parseWithZod(translationBenchScenarioSchema, value, "scenario");
}
