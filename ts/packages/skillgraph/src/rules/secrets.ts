// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineRule } from "./sdk.js";

// Credentials written into skill docs or scripts. Skills are copied, shared,
// and loaded into model context, so a literal secret leaks with them.
//   AccountKey=Zm9vYmFy…  ──▶ secret-literal (warn)

/** Joins pattern parts so push-time secret scanners don't flag this file. */
const re = (...parts: string[]) => new RegExp(parts.join(""));
/** Well-known credential shapes; placeholders like `<key>` never match. */
const SECRETS: [string, RegExp][] = [
    ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,})\b/],
    ["AWS access key", re("\\bAK", "IA[0-9A-Z]{16}\\b")],
    ["Azure storage key", re("Account", "Key=[A-Za-z0-9+/]{40,}={0,2}")],
    ["SAS signature", /[?&]sig=[A-Za-z0-9%+/]{30,}/],
    ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
    ["private key", re("-----BEGIN (?:[A-Z]+ )?PRIV", "ATE KEY-----")],
];

export const secretsRule = defineRule({
    meta: {
        name: "secrets",
        description: "No credentials in skill files.",
        diagnostics: { "secret-literal": "warn" },
    },
    create: (ctx) => ({
        skillEnd: () => {
            for (const file of ctx.files) {
                const text = ctx.read(file);
                if (text === undefined || text.includes("\0")) continue; // binary
                text.split("\n").forEach((line, i) => {
                    for (const [kind, pattern] of SECRETS) {
                        const m = pattern.exec(line);
                        if (!m) continue;
                        ctx.report({
                            rule: "secret-literal",
                            at: {
                                file,
                                line: i + 1,
                                col: m.index + 1,
                                endCol: m.index + 1 + m[0].length,
                            },
                            message: `${kind} literal; load it from the environment or a vault`,
                        });
                    }
                });
            }
        },
    }),
});
