// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    repairAbsoluteLinks,
    repairBareCodeFences,
    repairH1Headings,
    repairOutput,
    repairSelfReadmeLinks,
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

describe("repairH1Headings", () => {
    it("demotes a leading H1 to H2", () => {
        const out = repairH1Headings("# Discord Agent\n\nBody text.\n");
        expect(out).toBe("## Discord Agent\n\nBody text.\n");
    });

    it("demotes H1s deeper in the body", () => {
        const out = repairH1Headings(
            "## Overview\n\nIntro.\n\n# Architecture\n\nDetails.\n",
        );
        expect(out).toBe(
            "## Overview\n\nIntro.\n\n## Architecture\n\nDetails.\n",
        );
    });

    it("leaves H2 and deeper headings untouched", () => {
        const input = "## Overview\n\n### Subsection\n\n#### Even deeper\n";
        expect(repairH1Headings(input)).toBe(input);
    });

    it("does not touch `# foo` inside fenced code blocks (shell comments)", () => {
        const input =
            "## Overview\n\n```bash\n# install dependencies\npnpm install\n```\n";
        expect(repairH1Headings(input)).toBe(input);
    });

    it("does not match `#foo` without a trailing space", () => {
        const input = "Reference issue #123 for context.";
        expect(repairH1Headings(input)).toBe(input);
    });

    it("is idempotent", () => {
        const input = "# Title\n\n## Section\n\n# Another\n";
        const once = repairH1Headings(input);
        const twice = repairH1Headings(once);
        expect(twice).toBe(once);
    });
});

describe("repairSelfReadmeLinks", () => {
    it("strips `[X](./README.md)` to plain text X", () => {
        const out = repairSelfReadmeLinks(
            "See [the hand-written README](./README.md) for setup.",
        );
        expect(out).toBe("See the hand-written README for setup.");
    });

    it("strips the literal `[README.md](./README.md)` self-reference", () => {
        const out = repairSelfReadmeLinks(
            "See [README.md](./README.md) for details.",
        );
        expect(out).toBe("See README.md for details.");
    });

    it("leaves links to other README files untouched", () => {
        const input = "See [calendar README](../calendar/README.md) for that.";
        expect(repairSelfReadmeLinks(input)).toBe(input);
    });

    it("leaves links to deeper paths untouched", () => {
        const input = "See [setup notes](./docs/SETUP.md) for that.";
        expect(repairSelfReadmeLinks(input)).toBe(input);
    });

    it("does not touch self-links inside fenced code blocks", () => {
        const input =
            "## Overview\n\n```md\nSee [README.md](./README.md) above.\n```\n";
        expect(repairSelfReadmeLinks(input)).toBe(input);
    });

    it("handles multiple self-links on the same line", () => {
        const out = repairSelfReadmeLinks(
            "[A](./README.md) and [B](./README.md).",
        );
        expect(out).toBe("A and B.");
    });

    it("is idempotent", () => {
        const input = "See [the README](./README.md) for setup.";
        const once = repairSelfReadmeLinks(input);
        const twice = repairSelfReadmeLinks(once);
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
