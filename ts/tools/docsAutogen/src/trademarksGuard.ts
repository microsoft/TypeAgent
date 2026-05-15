// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Result of validating a README against the canonical Trademarks
 * block enforced by `tools/scripts/policyChecks/npmPackage.mjs`.
 */
export interface TrademarksValidation {
    /** True when the canonical block is present verbatim. */
    readonly ok: boolean;
    /** Human-readable diagnostic when ok=false. */
    readonly reason?: string;
}

/**
 * Read the canonical Trademarks block from `npmPackage.mjs`. The
 * value lives there (not in this package) so the policy check and the
 * docs generator cannot drift apart.
 *
 * @param monorepoRoot Absolute path of the directory containing
 *   `tools/scripts/policyChecks/npmPackage.mjs`.
 */
export async function loadCanonicalTrademarks(
    monorepoRoot: string,
): Promise<string> {
    const target = path.join(
        monorepoRoot,
        "tools",
        "scripts",
        "policyChecks",
        "npmPackage.mjs",
    );
    const text = await fs.readFile(target, "utf8");
    const m = /const\s+trademark\s*=\s*`([\s\S]*?)`;/u.exec(text);
    if (m === null || m[1] === undefined) {
        throw new Error(
            `Could not extract canonical trademark block from ${target}`,
        );
    }
    return m[1];
}

/**
 * Validate that `readme` contains the canonical Trademarks block
 * verbatim. The block must appear exactly as the policy check
 * expects, otherwise repo-policy-check will fail in CI.
 */
export function validateTrademarks(
    readme: string,
    canonical: string,
): TrademarksValidation {
    if (readme.includes(canonical)) {
        return { ok: true };
    }
    if (!/^##\s+Trademarks\s*$/mu.test(readme)) {
        return {
            ok: false,
            reason: "README is missing a `## Trademarks` heading.",
        };
    }
    return {
        ok: false,
        reason: "Trademarks block is present but does not match the canonical text in tools/scripts/policyChecks/npmPackage.mjs.",
    };
}
