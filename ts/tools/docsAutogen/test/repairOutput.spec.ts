// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    repairAbsoluteLinks,
    repairBareCodeFences,
    repairOutput,
} from "../src/repairOutput.js";
import { validateDocumentation } from "../src/documentationValidation.js";

describe("repairBareCodeFences", () => {
    it("infers `bash` for shell command blocks", () => {
        const out = repairBareCodeFences(
            "## Overview\n\n```\npnpm install\npnpm build\n```\n",
        );
        expect(out).toContain("```bash");
        // Closing fence is untouched (bare closers are valid markdown).
        expect(out).toContain("pnpm install");
    });

    it("infers `json` for JSON blocks", () => {
        const out = repairBareCodeFences(
            '## Overview\n\n```\n{\n  "foo": 1\n}\n```\n',
        );
        expect(out).toContain("```json");
    });

    it("infers `ts` for TypeScript blocks", () => {
        const out = repairBareCodeFences(
            "## Overview\n\n```\nimport { foo } from './bar';\n```\n",
        );
        expect(out).toContain("```ts");
    });

    it("falls back to `text` when no signal is found", () => {
        const out = repairBareCodeFences(
            "## Overview\n\n```\nsome arbitrary words\n```\n",
        );
        expect(out).toContain("```text");
    });

    it("leaves fences that already declare a language alone", () => {
        const input = "## Overview\n\n```bash\npnpm test\n```\n";
        expect(repairBareCodeFences(input)).toBe(input);
    });

    it("handles multiple bare fences in one document independently", () => {
        const out = repairBareCodeFences(
            "```\n{\n}\n```\n\n```\nnpm run build\n```\n",
        );
        expect(out).toMatch(/```json/u);
        expect(out).toMatch(/```bash/u);
    });

    it("is idempotent", () => {
        const input = "```\nnpm install\n```\n";
        const once = repairBareCodeFences(input);
        const twice = repairBareCodeFences(once);
        expect(twice).toBe(once);
    });

    it("preserves indentation on the opener", () => {
        const out = repairBareCodeFences("  ```\n  npm test\n  ```\n");
        expect(out).toContain("  ```bash");
    });
});

describe("repairAbsoluteLinks", () => {
    it("strips the URL from `[text](https://...)` markdown links", () => {
        const out = repairAbsoluteLinks(
            "Visit [Discord Developer Portal](https://discord.com/developers) to start.",
        );
        expect(out).toBe("Visit Discord Developer Portal to start.");
    });

    it("wraps `<https://...>` autolinks in inline code", () => {
        const out = repairAbsoluteLinks(
            "Sign in at <https://aka.ms/foo> first.",
        );
        expect(out).toBe("Sign in at `https://aka.ms/foo` first.");
    });

    it("leaves repo-relative markdown links untouched", () => {
        const input = "See [the README](./README.md) for setup.";
        expect(repairAbsoluteLinks(input)).toBe(input);
    });

    it("leaves bare URLs in plain prose alone (the validator now allows them)", () => {
        const input = "Open https://example.com in your browser.";
        expect(repairAbsoluteLinks(input)).toBe(input);
    });

    it("leaves URLs already wrapped in inline code alone", () => {
        const input = "Set the env var to `https://example.com`.";
        expect(repairAbsoluteLinks(input)).toBe(input);
    });

    it("handles multiple links on the same line", () => {
        const out = repairAbsoluteLinks(
            "[A](https://a.com) and [B](https://b.com).",
        );
        expect(out).toBe("A and B.");
    });

    it("is idempotent", () => {
        const input =
            "[Discord Developer Portal](https://discord.com/developers) and <https://aka.ms/foo>.";
        const once = repairAbsoluteLinks(input);
        const twice = repairAbsoluteLinks(once);
        expect(twice).toBe(once);
    });
});

describe("repairOutput end-to-end", () => {
    it("composes both repairs and produces a body that passes the validator", () => {
        const broken = `## Overview

This package talks to the [Discord Developer Portal](https://discord.com/developers).
See <https://aka.ms/setup> for the full guide.

\`\`\`
pnpm install
pnpm build
\`\`\`

## What it does

It does things.`;
        const repaired = repairOutput(broken);
        const v = validateDocumentation(repaired);
        // Both the markdown link and the autolink are gone; the bare
        // fence now has a language tag — validation must pass.
        expect(v.violations).toEqual([]);
        expect(v.valid).toBe(true);
    });
});
