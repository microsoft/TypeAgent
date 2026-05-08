// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the github-cli agent's readiness wiring.
 *
 * `evaluateGhReadiness` is a pure decision function split out from the
 * agent's `checkReadiness` hook so it can be tested without spawning the
 * `gh` subprocess. Mirrors the player/screencapture pattern.
 *
 * No `setup` hook to test — `gh auth login` is interactive and must be run
 * by the user in a terminal, so github-cli takes the manual-config shape
 * (same as player's Spotify env-var setup).
 */

import { evaluateGhReadiness } from "../src/github-cliActionHandler.js";

describe("evaluateGhReadiness", () => {
    test("ready when probe succeeds (gh installed AND authenticated)", () => {
        expect(evaluateGhReadiness({ kind: "ready" })).toEqual({
            state: "ready",
        });
    });

    test("setup-required when gh is not on PATH — points at install docs", () => {
        const r = evaluateGhReadiness({ kind: "not-installed" });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/not found on PATH/);
        // Details should include the canonical install URL plus per-platform
        // hints so the user can pick whichever fits.
        expect(r.details).toMatch(/cli\.github\.com/);
        expect(r.details).toMatch(/winget install GitHub\.cli/);
        expect(r.details).toMatch(/brew install gh/);
        expect(r.details).toMatch(/apt install gh/);
        expect(r.details).toMatch(/@config agent refresh github-cli/);
    });

    test("setup-required when gh runs but auth status fails — points at gh auth login", () => {
        const r = evaluateGhReadiness({ kind: "not-auth" });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/not authenticated/);
        // Details should explicitly call out `gh auth login` since that's
        // the only path forward (no automated setup hook).
        expect(r.details).toMatch(/gh auth login/);
        expect(r.details).toMatch(/@config agent refresh github-cli/);
    });

    test("setup-required when gh runs but auth status fails — stderr is captured but does NOT leak into the user-facing message", () => {
        // The probe captures stderr for debugging, but we don't want the raw
        // gh output (which can contain hostname tables / advice the user
        // doesn't need) bleeding into the dispatcher's pre-flight error.
        const r = evaluateGhReadiness({
            kind: "not-auth",
            stderr: "You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
        });
        expect(r.message).toBe(
            "GitHub CLI is installed but not authenticated.",
        );
        expect(r.message).not.toMatch(/logged into any GitHub hosts/);
    });

    test("setup-required when probe throws unexpectedly — surfaces the underlying error so the user can debug", () => {
        const r = evaluateGhReadiness({
            kind: "probe-failed",
            message: "spawn ETIMEDOUT",
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/probe failed/);
        // Underlying error is preserved so the user has a thread to pull on.
        expect(r.message).toMatch(/spawn ETIMEDOUT/);
        // Probe-failed details should explain that there's no auto-setup
        // path (so the user doesn't wait for one).
        expect(r.details).toMatch(/setup.*hook|interactive/i);
    });
});
