// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Render the staleness footer that closes every AUTOGEN block.
 *
 * Format (intentionally LLM- and grep-friendly):
 *
 *   ---
 *   _Auto-generated against commit `<full-sha>` on `<iso-date>` by
 *   `docs-generate.yml`. Links validated at that commit; the working
 *   tree may have drifted by up to 24h. Re-run
 *   `pnpm --filter <pkg> docs:verify-links` to spot-check._
 *
 * The full SHA is rendered as a plain backticked string (no URL),
 * sidestepping the `https://github.com/...` prohibition entirely.
 */
export function renderStalenessFooter(
    sha: string,
    isoDate: string,
    packageName: string,
): string {
    const lines = [
        "---",
        "",
        `_Auto-generated against commit \`${sha}\` on \`${isoDate}\` by \`docs-generate.yml\`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run \`pnpm --filter ${packageName} docs:verify-links\` to spot-check._`,
        "",
    ];
    return lines.join("\n");
}

/**
 * Strip the staleness footer from a block body, so the diff guard can
 * compare two block bodies without the date+SHA dance making every
 * regen look "changed".
 *
 * Matches conservatively: only removes the trailing `---` ... `_…
 * docs-generate.yml. …_` paragraph, which is the only output of
 * `renderStalenessFooter` we ever emit.
 */
export function stripStalenessFooter(body: string): string {
    const lines = body.split(/\r?\n/u);
    let lastHr = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.trim() === "---") {
            lastHr = i;
            break;
        }
    }
    if (lastHr === -1) return body;
    const tail = lines.slice(lastHr + 1).join("\n");
    if (!/`docs-generate\.yml`/u.test(tail)) return body;
    return lines.slice(0, lastHr).join("\n").replace(/\s+$/u, "");
}
