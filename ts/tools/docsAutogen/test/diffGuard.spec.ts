// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compareReadmes } from "../src/diffGuard.js";

const HASH = "<!-- AUTOGEN:DOCS:HASH:sha256=" + "0".repeat(64) + " -->";
const HASH2 = "<!-- AUTOGEN:DOCS:HASH:sha256=" + "1".repeat(64) + " -->";

const FOOTER_OLD =
    "---\n\n_Auto-generated against commit `aaa` on `2026-01-01T00:00:00Z` by `docs-generate.yml`. Re-run `pnpm --filter pkg docs:verify-links` to spot-check._";
const FOOTER_NEW =
    "---\n\n_Auto-generated against commit `bbb` on `2026-02-02T00:00:00Z` by `docs-generate.yml`. Re-run `pnpm --filter pkg docs:verify-links` to spot-check._";

const BODY = `# pkg

<!-- AUTOGEN:DOCS:START -->
HASH_LINE

## Overview

The body of the package.

## Reference

### Entry points

- \`.\` → \`./dist/index.js\`

FOOTER_LINE
<!-- AUTOGEN:DOCS:END -->

## Trademarks
`;

function withFooterAndHash(footer: string, hash: string): string {
    return BODY.replace("FOOTER_LINE", footer).replace("HASH_LINE", hash);
}

describe("compareReadmes", () => {
    it("returns unchanged when both READMEs are byte-identical", () => {
        const text = withFooterAndHash(FOOTER_OLD, HASH);
        const result = compareReadmes(text, text);
        expect(result.verdict).toBe("unchanged");
    });

    it("returns footer-only when only the staleness footer differs", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = withFooterAndHash(FOOTER_NEW, HASH);
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("footer-only");
    });

    it("returns footer-only when only the embedded content hash differs", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = withFooterAndHash(FOOTER_OLD, HASH2);
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("footer-only");
    });

    it("returns footer-only when both footer and hash differ but content is identical", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = withFooterAndHash(FOOTER_NEW, HASH2);
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("footer-only");
    });

    it("returns content-changed when an actual section body differs", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = withFooterAndHash(FOOTER_OLD, HASH).replace(
            "The body of the package.",
            "The new body of the package, expanded.",
        );
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("content-changed");
    });

    it("treats trailing-newline drift as unchanged", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = oldText.replace(/\n*$/u, "\n\n\n");
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("footer-only");
    });

    it("treats trailing-whitespace drift as footer-only", () => {
        const oldText = withFooterAndHash(FOOTER_OLD, HASH);
        const newText = oldText.replace(/^## Overview$/mu, "## Overview   ");
        const result = compareReadmes(oldText, newText);
        expect(result.verdict).toBe("footer-only");
    });
});
