// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { loadRuntimeConfigSync } from "@typeagent/config";
import {
    getRuntimeConfig,
    openai,
    setRuntimeConfig,
    RequestBudget,
    runWithRequestBudget,
} from "@typeagent/aiclient";
import { createWikiModels } from "../src/wikiModels.js";
import { resolveReviewedWikiBudget } from "../src/wikiBudget.js";

test("YAML-only configuration stays pinned and normal model defaults require no wiki declarations", async () => {
    const original = getRuntimeConfig();
    const originalFetch = globalThis.fetch;
    const root = await mkdtemp(path.join(process.cwd(), ".wiki-yaml-config-"));
    try {
        await writeFile(
            path.join(root, "config.local.yaml"),
            `modelProvider: azure
azureOpenAI:
  responseFormat: true
  deployments:
    gpt_4_o:
      endpoints:
        - endpoint: https://synthetic.invalid/default
          region: eastus
          auth: synthetic-test-key
    custom_reasoning:
      endpoints:
        - endpoint: https://synthetic.invalid/reasoning
          region: eastus
          auth: synthetic-test-key
    gpt_6_luna:
      endpoints:
        - endpoint: https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions
          region: eastus
          auth: synthetic-test-key
reasoning:
  copilotModel: configured-reasoning
modelRequestConstraints:
  "azure:chat:custom_reasoning":
    contextTokens: 50000
    inputTokens: 20000
    outputTokens: 12000
`,
        );
        const { config } = loadRuntimeConfigSync({
            workspaceRoot: root,
            populateProcessEnv: false,
        });
        setRuntimeConfig(config);
        expect(getRuntimeConfig()).toBe(config);
        expect(getRuntimeConfig().reasoning?.copilotModel).toBe(
            "configured-reasoning",
        );
        expect(openai.getChatModelSettings().endpoint).toBe(
            "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
        );
        expect(openai.getChatModelSettings(openai.GPT_6_LUNA).endpoint).toBe(
            "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
        );
        const limits = resolveReviewedWikiBudget({}, "azure:custom_reasoning");
        expect(limits).toMatchObject({
            contextTokens: 1050000,
            inputTokens: 16000,
            outputTokens: 128000,
        });
        const defaults = createWikiModels();
        expect(defaults.provider).toBe("azure");
        expect(defaults.extractionModel.completionSettings).toMatchObject({
            response_format: { type: "json_object" },
        });
        for (const model of [defaults.languageModel, defaults.extractionModel])
            for (const key of [
                "max_completion_tokens",
                "max_tokens",
                "max_output_tokens",
            ])
                expect(model.completionSettings).not.toHaveProperty(key);
        expect(
            openai.getChatModelSettings("azure:custom_reasoning").endpoint,
        ).toBe("https://synthetic.invalid/reasoning");
        expect(getRuntimeConfig()).toBe(config);
        expect(new RequestBudget(limits).receipts).toEqual([]);
        const requested: string[] = [];
        globalThis.fetch = async (input, options) => {
            requested.push(String(input));
            const body: unknown = JSON.parse(String(options?.body));
            for (const key of [
                "max_completion_tokens",
                "max_tokens",
                "max_output_tokens",
            ])
                expect(body).not.toHaveProperty(key);
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: { content: "{}" },
                            finish_reason: "stop",
                        },
                    ],
                }),
                { status: 200 },
            );
        };
        // Synthetic transports exercise normal YAML routing, not authentication.
        const budget = new RequestBudget(limits);
        const roles = createWikiModels("azure:custom_reasoning");
        await runWithRequestBudget(budget, async () => {
            expect(
                (await roles.extractionModel.complete("synthetic extraction"))
                    .success,
            ).toBe(true);
            expect(
                (await roles.languageModel.complete("synthetic reasoning"))
                    .success,
            ).toBe(true);
        });
        expect(requested).toEqual([
            "https://synthetic.invalid/openai/deployments/gpt-6-luna/chat/completions",
            "https://synthetic.invalid/reasoning",
        ]);
        expect(budget.receipts).toHaveLength(2);
        expect(budget.receipts.map((receipt) => receipt.outputTokens)).toEqual([
            128000, 12000,
        ]);
        expect(
            budget.receipts.map((receipt) => receipt.tokenAccounting),
        ).toEqual(["estimate", "estimate"]);
    } finally {
        setRuntimeConfig(original);
        globalThis.fetch = originalFetch;
        await rm(root, { recursive: true, force: true });
    }
});
