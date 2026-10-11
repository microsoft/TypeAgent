// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
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
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-yaml-config-"));
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
        - endpoint: https://synthetic.invalid/translation
          region: eastus
          auth: synthetic-test-key
reasoning:
  copilotModel: configured-reasoning
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
            "https://synthetic.invalid/default",
        );
        expect(openai.getChatModelSettings(openai.GPT_6_LUNA).endpoint).toBe(
            "https://synthetic.invalid/translation",
        );
        const limits = resolveReviewedWikiBudget({});
        const defaults = createWikiModels(limits.outputTokens);
        expect(defaults.provider).toBe("azure");
        expect(defaults.extractionModel.completionSettings).toMatchObject({
            response_format: { type: "json_object" },
            max_completion_tokens: 4000,
        });
        expect(defaults.languageModel.completionSettings).toMatchObject({
            max_completion_tokens: 4000,
        });
        expect(
            createWikiModels(2000, "azure:custom_reasoning").languageModel
                .completionSettings.max_completion_tokens,
        ).toBe(2000);
        expect(
            openai.getChatModelSettings("azure:custom_reasoning").endpoint,
        ).toBe("https://synthetic.invalid/reasoning");
        expect(getRuntimeConfig()).toBe(config);
        expect(new RequestBudget(limits).receipts).toEqual([]);
        const requested: string[] = [];
        globalThis.fetch = async (input) => {
            requested.push(String(input));
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
        const roles = createWikiModels(2000, "azure:custom_reasoning");
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
            "https://synthetic.invalid/translation",
            "https://synthetic.invalid/reasoning",
        ]);
        expect(budget.receipts).toHaveLength(2);
        expect(
            budget.receipts.map((receipt) => receipt.tokenAccounting),
        ).toEqual(["estimate", "estimate"]);
    } finally {
        setRuntimeConfig(original);
        globalThis.fetch = originalFetch;
        await rm(root, { recursive: true, force: true });
    }
});
