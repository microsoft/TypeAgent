// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the desktop agent's readiness wiring.
 *
 * `evaluateDesktopReadiness` is a pure decision function split out from the
 * agent's `checkReadiness` hook so it can be tested without hitting disk or
 * relying on `process.platform`. Mirrors the player/screencapture/github-cli
 * pattern.
 *
 * The `setup` hook (which spawns `dotnet build`) is intentionally not
 * unit-tested here — exercising it would require a working .NET SDK and the
 * full autoShell project, which is the integration-test surface.
 */

import { evaluateDesktopReadiness } from "../src/readiness.js";

const DEBUG_PATH = "C:\\repo\\dotnet\\autoShell\\bin\\Debug\\autoShell.exe";
const RELEASE_PATH = "C:\\repo\\dotnet\\autoShell\\bin\\Release\\autoShell.exe";
const ENV_PATH = "C:\\custom\\autoShell.exe";

describe("evaluateDesktopReadiness", () => {
    test("ready when probe finds the binary", () => {
        expect(
            evaluateDesktopReadiness("win32", {
                kind: "ready",
                binaryPath: DEBUG_PATH,
            }),
        ).toEqual({ state: "ready" });
    });

    test("setup-required when binary missing — points the user at @config agent setup desktop", () => {
        const r = evaluateDesktopReadiness("win32", {
            kind: "binary-missing",
            debugPath: DEBUG_PATH,
            releasePath: RELEASE_PATH,
        });
        expect(r.state).toBe("setup-required");
        // Surface that this is a build problem, not a config problem
        expect(r.message).toMatch(/not found|hasn't been built/);
        // The dispatcher's setup-required pre-flight needs to send the user
        // somewhere actionable — `@config agent setup desktop` triggers our
        // setup hook (dotnet build).
        expect(r.details).toMatch(/@config agent setup desktop/);
        expect(r.details).toMatch(/dotnet build/);
        // Both candidate paths surfaced so the user can sanity-check
        // expectations against their checkout.
        expect(r.details).toContain(DEBUG_PATH);
        expect(r.details).toContain(RELEASE_PATH);
    });

    test("setup-required when AUTOSHELL_PATH override points at a missing file — does NOT promise auto-build", () => {
        const r = evaluateDesktopReadiness("win32", {
            kind: "override-missing",
            envPath: ENV_PATH,
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/AUTOSHELL_PATH/);
        expect(r.message).toContain(ENV_PATH);
        // Override-missing is a config issue we can't fix automatically (we
        // don't know where the user wants the binary built). Detail should
        // route the user to manual remediation, not setup() — pointing
        // them at refresh, not setup, is intentional.
        expect(r.details).toMatch(/unset AUTOSHELL_PATH|fix the path/);
        expect(r.details).toMatch(/@config agent refresh desktop/);
        expect(r.details).not.toMatch(/@config agent setup desktop/);
    });

    test("unsupported on non-Windows platforms regardless of probe outcome", () => {
        for (const platform of ["darwin", "linux"] as const) {
            const r = evaluateDesktopReadiness(platform, {
                kind: "ready",
                binaryPath: "/anywhere/autoShell.exe",
            });
            expect(r.state).toBe("unsupported");
            // Reason should explain WHY (autoShell's TFM is Windows-only)
            // so the user understands this isn't fixable.
            expect(r.message).toMatch(/Windows-only|net8\.0-windows/);
            expect(r.message).toContain(platform);
        }
    });

    test("unsupported wins over a missing binary on non-Windows — no false setup-required", () => {
        // Defensive case: even if we somehow reached binary-missing on a
        // non-Windows platform, we should still report unsupported, not
        // setup-required. Otherwise the user gets nudged to run a setup
        // hook that will refuse anyway.
        const r = evaluateDesktopReadiness("linux", {
            kind: "binary-missing",
            debugPath: DEBUG_PATH,
            releasePath: RELEASE_PATH,
        });
        expect(r.state).toBe("unsupported");
    });
});
