// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { countTokens } from "gpt-tokenizer";
import { defineRule } from "./sdk.js";

// SKILL.md loads whole into context when the skill triggers; keep it small and
// move detail to references/. Threshold: .skillgraphrc.json "maxSkillTokens".

export const DEFAULT_MAX_SKILL_TOKENS = 5000;

export const sizeRule = defineRule({
    meta: {
        name: "size",
        description: "SKILL.md stays under maxSkillTokens.",
        diagnostics: { "skill-too-large": "warn" },
    },
    create: (ctx) => ({
        doc: ({ file, md, isEntry }) => {
            if (!isEntry) return;
            const max = ctx.config.maxSkillTokens ?? DEFAULT_MAX_SKILL_TOKENS;
            const tokens = countTokens(md.text);
            if (tokens <= max) return;
            ctx.report({
                rule: "skill-too-large",
                at: { file, line: 1, col: 1, endCol: 4 },
                message: `${tokens} tokens > ${max}; move detail to references/`,
            });
        },
    }),
});
