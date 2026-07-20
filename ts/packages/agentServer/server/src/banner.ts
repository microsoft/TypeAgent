// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ConfigDrift } from "@typeagent/config";

// True black text (24-bit) on a yellow background - only emitted to a TTY so
// redirected logs (files, pipes) stay readable. Uses an explicit RGB(0,0,0)
// foreground instead of the ANSI "black" (30): most terminal themes remap
// indexed black to a dark gray (so it shows on a dark background), which then
// renders gray-on-yellow here and is hard to read. Truecolor can't be remapped.
const YELLOW_BG = "\x1b[38;2;0;0;0;43m";
const RESET = "\x1b[0m";

/**
 * Print a hard-to-miss yellow warning banner to stderr. On a TTY the lines are
 * boxed and colored; when output is redirected (file / pipe) it falls back to
 * plain `[logPrefix] line` text so logs stay greppable. Shared by the startup
 * warnings (stale build, config drift) so they render identically.
 *
 * Long lines are truncated with an ellipsis to keep the box aligned, so a
 * caller that must show something in full (e.g. a list) should split it across
 * lines rather than relying on one wide line.
 */
export function printWarningBanner(lines: string[], logPrefix: string): void {
    if (process.stdout.isTTY !== true) {
        // No colors / box for non-interactive logs - just make it greppable.
        process.stderr.write(
            "\n" +
                lines.map((line) => `[${logPrefix}] ${line}`).join("\n") +
                "\n\n",
        );
        return;
    }

    const width = Math.min(Math.max(process.stdout.columns ?? 80, 40), 100);
    const inner = width - 4; // "| " + " |"
    const bar = "-".repeat(width - 2);
    const pad = (s: string) => {
        const text = s.length > inner ? s.slice(0, inner - 3) + "..." : s;
        return "| " + text + " ".repeat(inner - text.length) + " |";
    };
    const box = ["+" + bar + "+", ...lines.map(pad), "+" + bar + "+"];
    process.stderr.write(
        "\n" + box.map((l) => `${YELLOW_BG}${l}${RESET}`).join("\n") + "\n\n",
    );
}

// Cap how many drifted key names are listed in the console banner (one per
// line); the rest are summarized as "... and N more" so a large drift doesn't
// scroll the console.
const CONFIG_DRIFT_BANNER_MAX_KEYS = 8;

/**
 * Print a one-shot yellow banner at startup when this server's local config
 * differs from the shared Key Vault. The client-facing toast (see
 * connectionHandler.ts) covers connected users; this covers whoever is
 * watching the server console. Lists the differing setting NAMES only - never
 * values - so no secret is written to the console or a redirected log.
 */
export function printConfigDriftBanner(drift: ConfigDrift): void {
    const keys = drift.driftedKeys;
    const shown = keys.slice(0, CONFIG_DRIFT_BANNER_MAX_KEYS);
    const remainder = keys.length - shown.length;
    const count = keys.length === 1 ? "1 setting" : `${keys.length} settings`;
    printWarningBanner(
        [
            "CONFIG DRIFT",
            `local config differs from the shared Key Vault (${drift.vaultName}).`,
            `${count} out of sync with the vault:`,
            ...shown.map((k) => `  ${k}`),
            ...(remainder > 0 ? [`  ... and ${remainder} more`] : []),
            "Update config.local.yaml to match the vault (values not shown).",
        ],
        "config-drift",
    );
}
