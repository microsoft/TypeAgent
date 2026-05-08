// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the github-cli agent's readiness + setup wiring.
 *
 * `evaluateGhReadiness` (decision) and `planGhSetupCommand` (install
 * planning) are pure functions exercised without spawning subprocesses.
 * `runInstall` is exercised through the mutex early-return path —
 * verifying the heavy install pipeline itself would require a real
 * winget/apt subprocess.
 *
 * The setup hook handles the not-installed case (winget / apt). The
 * not-auth case still has no automation — `gh auth login` is an
 * interactive browser flow we can't drive from chat.
 */

import {
    evaluateGhReadiness,
    runInstall,
} from "../src/github-cliActionHandler.js";
import { isProgressNoise, planGhSetupCommand } from "../src/setup.js";
import type { ActionContext } from "@typeagent/agent-sdk";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";

describe("evaluateGhReadiness", () => {
    test("ready when probe succeeds (gh installed AND authenticated)", () => {
        expect(evaluateGhReadiness({ kind: "ready" })).toEqual({
            state: "ready",
        });
    });

    test("setup-required when gh is not on PATH — points at @config agent setup", () => {
        const r = evaluateGhReadiness({ kind: "not-installed" });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/not found on PATH/);
        // The not-installed branch now has an automated setup path
        // (winget / apt) — the message should direct the user there
        // first, with the canonical URL as fallback for unsupported
        // OSes (macOS).
        expect(r.details).toMatch(/@config agent setup github-cli/);
        expect(r.details).toMatch(/cli\.github\.com/);
        expect(r.details).toMatch(/brew install gh/);
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
        // Probe failures want the user to confirm `gh auth status` works
        // in a terminal first — refreshing without fixing the underlying
        // issue would just loop.
        expect(r.details).toMatch(/gh auth status/);
        expect(r.details).toMatch(/@config agent refresh github-cli/);
    });
});

describe("planGhSetupCommand", () => {
    describe("windows", () => {
        test("error when winget is missing", () => {
            const r = planGhSetupCommand("windows", { wingetPresent: false });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/winget is not available/);
                expect(r.message).toMatch(/cli\.github\.com/);
            }
        });

        test("emits a winget command for GitHub.cli with user scope", () => {
            const r = planGhSetupCommand("windows", { wingetPresent: true });
            expect(r.kind).toBe("ok");
            if (r.kind === "ok") {
                expect(r.commands).toHaveLength(1);
                expect(r.commands[0].argv).toEqual([
                    "winget",
                    "install",
                    "--id",
                    "GitHub.cli",
                    "--silent",
                    "--scope",
                    "user",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ]);
            }
        });
    });

    describe("linux", () => {
        test("error when apt-get is missing", () => {
            const r = planGhSetupCommand("linux", {
                linux: { aptPresent: false, sudoNoninteractiveOk: false },
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/apt-based distributions/);
                expect(r.message).toMatch(/install_linux\.md/);
            }
        });

        test("error when passwordless sudo is unavailable — surfaces manual command + repo-setup hint", () => {
            const r = planGhSetupCommand("linux", {
                linux: { aptPresent: true, sudoNoninteractiveOk: false },
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/passwordless sudo/);
                expect(r.message).toMatch(/sudo apt-get install -y gh/);
                expect(r.message).toMatch(/install_linux\.md/);
            }
        });

        test("emits a single apt-get install when both apt + sudo are available", () => {
            const r = planGhSetupCommand("linux", {
                linux: { aptPresent: true, sudoNoninteractiveOk: true },
            });
            expect(r.kind).toBe("ok");
            if (r.kind === "ok") {
                expect(r.commands).toHaveLength(1);
                expect(r.commands[0].argv).toEqual([
                    "sudo",
                    "-n",
                    "apt-get",
                    "install",
                    "-y",
                    "gh",
                ]);
            }
        });
    });
});

describe("isProgressNoise", () => {
    test("filters empty / whitespace lines and single spinner glyphs", () => {
        expect(isProgressNoise("")).toBe(true);
        expect(isProgressNoise("   ")).toBe(true);
        expect(isProgressNoise("-")).toBe(true);
        expect(isProgressNoise("\\")).toBe(true);
    });

    test("filters bar/percent lines (winget download progress)", () => {
        expect(isProgressNoise("  ██████████▒▒▒▒▒▒▒▒▒▒  1.2 MB / 5.4 MB")).toBe(
            true,
        );
        expect(isProgressNoise("  ▒▒▒▒▒▒▒▒▒▒  17%")).toBe(true);
    });

    test("keeps informational lines (URLs, status, errors)", () => {
        expect(isProgressNoise("Downloading https://example.com/x.zip")).toBe(
            false,
        );
        expect(isProgressNoise("Successfully installed")).toBe(false);
        expect(isProgressNoise("E: Unable to locate package gh")).toBe(false);
    });
});

describe("runInstall — install mutex", () => {
    function makeAgentContext(installInProgress: boolean) {
        return {
            choiceManager: new ChoiceManager(),
            installInProgress,
        };
    }

    function makeActionContext(agentCtx: ReturnType<typeof makeAgentContext>) {
        const appended: any[] = [];
        return {
            sessionContext: {
                agentContext: agentCtx,
                notify: () => {},
            } as any,
            actionIO: {
                appendDisplay: (content: any) => appended.push(content),
                setDisplay: () => {},
                takeAction: () => {},
            } as any,
            _appended: appended,
        } as any as ActionContext<unknown>;
    }

    test("returns an in-progress error when installInProgress is already true", async () => {
        const ctx = makeAgentContext(true);
        const actionContext = makeActionContext(ctx);
        const result = await runInstall(
            { kind: "ok", commands: [] },
            actionContext as any,
        );
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/already in progress/i);
        // Early-return must not append "Installing…" status.
        expect((actionContext as any)._appended).toEqual([]);
    });

    test("does NOT clear installInProgress when an in-progress caller short-circuits", async () => {
        // The early-return must NOT clear the flag — that would let the
        // second concurrent caller release the lock the first caller is
        // still holding.
        const ctx = makeAgentContext(true);
        await runInstall(
            { kind: "ok", commands: [] },
            makeActionContext(ctx) as any,
        );
        expect(ctx.installInProgress).toBe(true);
    });

    test("clears installInProgress in finally on the success path (empty plan)", async () => {
        const ctx = makeAgentContext(false);
        const result = await runInstall(
            { kind: "ok", commands: [] },
            makeActionContext(ctx) as any,
        );
        expect(result.error).toBeUndefined();
        expect(ctx.installInProgress).toBe(false);
    });
});
