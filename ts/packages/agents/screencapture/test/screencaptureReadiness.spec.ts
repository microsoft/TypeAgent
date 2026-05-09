// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the screencapture agent's readiness/setup wiring.
 *
 * `evaluateReadiness` is a pure decision function split out from the
 * agent's `checkReadiness` hook so it can be tested without spawning
 * `which` subprocesses or mocking process.platform. `describePlatformSupport`
 * is the matching pure platform check (also avoids dynamic-importing the
 * heavyweight backend modules).
 */

import {
    evaluateReadiness,
    runInstall,
} from "../src/screencaptureActionHandler.js";
import {
    describePlatformSupport,
    installDetailsFor,
} from "../src/platform/index.js";
import { isProgressNoise, planSetupCommand } from "../src/setup.js";
import {
    ScreencaptureActionContext,
    createInitialContext,
} from "../src/context.js";
import type { ActionContext } from "@typeagent/agent-sdk";

describe("describePlatformSupport", () => {
    test("supports win32 with no extra tools", () => {
        const s = describePlatformSupport("win32", undefined);
        expect(s.supported).toBe(true);
        if (s.supported) {
            expect(s.platformName).toBe("windows");
            expect(s.extraTools).toEqual([]);
        }
    });

    test("supports linux X11 with wmctrl + xdotool", () => {
        const s = describePlatformSupport("linux", "x11");
        expect(s.supported).toBe(true);
        if (s.supported) {
            expect(s.platformName).toBe("linux");
            expect(s.extraTools).toEqual(["wmctrl", "xdotool"]);
        }
    });

    test("supports linux when XDG_SESSION_TYPE is undefined (treat as X11)", () => {
        const s = describePlatformSupport("linux", undefined);
        expect(s.supported).toBe(true);
    });

    test("rejects linux Wayland with a switch-to-X11 hint", () => {
        const s = describePlatformSupport("linux", "wayland");
        expect(s.supported).toBe(false);
        if (!s.supported) {
            expect(s.reason).toMatch(/Wayland/);
            expect(s.reason).toMatch(/X11/);
        }
    });

    test("rejects darwin (macOS not supported)", () => {
        const s = describePlatformSupport("darwin", undefined);
        expect(s.supported).toBe(false);
        if (!s.supported) {
            expect(s.reason).toMatch(/darwin/);
        }
    });
});

describe("evaluateReadiness", () => {
    const winSupport = describePlatformSupport("win32", undefined);
    const linuxSupport = describePlatformSupport("linux", "x11");
    const waylandSupport = describePlatformSupport("linux", "wayland");
    const darwinSupport = describePlatformSupport("darwin", undefined);

    test("ready on win32 when ffmpeg is found", () => {
        expect(evaluateReadiness(winSupport, true, [])).toEqual({
            state: "ready",
        });
    });

    test("ready on linux when ffmpeg + wmctrl + xdotool are all found", () => {
        expect(evaluateReadiness(linuxSupport, true, [])).toEqual({
            state: "ready",
        });
    });

    test("setup-required on win32 when ffmpeg is missing", () => {
        const r = evaluateReadiness(winSupport, false, []);
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/ffmpeg/);
        expect(r.details).toMatch(/winget/);
    });

    test("setup-required on linux when one extra tool is missing", () => {
        const r = evaluateReadiness(linuxSupport, true, ["xdotool"]);
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/xdotool/);
        expect(r.details).toMatch(/apt install/);
    });

    test("setup-required on linux when ffmpeg AND extra tools are missing — listed together", () => {
        const r = evaluateReadiness(linuxSupport, false, ["wmctrl", "xdotool"]);
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/ffmpeg/);
        expect(r.message).toMatch(/wmctrl/);
        expect(r.message).toMatch(/xdotool/);
    });

    test("ffmpeg listed before extra tools (consistent message ordering)", () => {
        const r = evaluateReadiness(linuxSupport, false, ["wmctrl"]);
        expect(r.state).toBe("setup-required");
        expect(r.message).toBe(
            "Required tools not found on PATH: ffmpeg, wmctrl.",
        );
    });

    test("unsupported on Wayland regardless of tool availability", () => {
        // Wayland is permanent (the user has to switch to X11 at the login
        // screen) — no `setup` hook should run.
        const r = evaluateReadiness(waylandSupport, true, []);
        expect(r.state).toBe("unsupported");
        expect(r.message).toMatch(/Wayland/);
    });

    test("unsupported on darwin regardless of tool availability", () => {
        const r = evaluateReadiness(darwinSupport, true, []);
        expect(r.state).toBe("unsupported");
    });
});

describe("planSetupCommand", () => {
    test("no commands when nothing missing", () => {
        expect(
            planSetupCommand("windows", [], { wingetPresent: true }),
        ).toEqual({ kind: "ok", commands: [] });
        expect(
            planSetupCommand("linux", [], {
                linux: { aptPresent: true, sudoNoninteractiveOk: true },
            }),
        ).toEqual({ kind: "ok", commands: [] });
    });

    describe("windows", () => {
        test("error when winget is missing", () => {
            const r = planSetupCommand("windows", ["ffmpeg"], {
                wingetPresent: false,
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/winget is not available/);
            }
        });

        test("emits a winget command for ffmpeg", () => {
            const r = planSetupCommand("windows", ["ffmpeg"], {
                wingetPresent: true,
            });
            expect(r.kind).toBe("ok");
            if (r.kind === "ok") {
                expect(r.commands).toHaveLength(1);
                expect(r.commands[0].argv).toEqual([
                    "winget",
                    "install",
                    "--id",
                    // Gyan.FFmpeg.Essentials, not Gyan.FFmpeg — see WINGET_IDS
                    // comment in setup.ts (smaller download + sidesteps the
                    // "Nested installer file does not exist" manifest bug
                    // on Gyan.FFmpeg's full build).
                    "Gyan.FFmpeg.Essentials",
                    "--silent",
                    "--scope",
                    "user",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ]);
            }
        });

        test("error when an unknown tool has no winget mapping", () => {
            // No mapping for fictional "wmctrl" on Windows (it's a Linux-only
            // tool, so describePlatformSupport would never list it for win32 —
            // but we still want defense-in-depth here).
            const r = planSetupCommand("windows", ["wmctrl"], {
                wingetPresent: true,
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/No automated installer mapping/);
            }
        });
    });

    describe("linux", () => {
        test("error when apt-get is missing", () => {
            const r = planSetupCommand("linux", ["ffmpeg"], {
                linux: { aptPresent: false, sudoNoninteractiveOk: false },
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/apt-based distributions/);
            }
        });

        test("error when passwordless sudo is unavailable", () => {
            const r = planSetupCommand("linux", ["ffmpeg", "wmctrl"], {
                linux: { aptPresent: true, sudoNoninteractiveOk: false },
            });
            expect(r.kind).toBe("error");
            if (r.kind === "error") {
                expect(r.message).toMatch(/passwordless sudo/);
                // Manual hint includes the exact missing-package list.
                expect(r.message).toMatch(
                    /sudo apt-get install -y ffmpeg wmctrl/,
                );
            }
        });

        test("emits a single apt-get install with all missing packages", () => {
            const r = planSetupCommand(
                "linux",
                ["ffmpeg", "wmctrl", "xdotool"],
                { linux: { aptPresent: true, sudoNoninteractiveOk: true } },
            );
            expect(r.kind).toBe("ok");
            if (r.kind === "ok") {
                expect(r.commands).toHaveLength(1);
                expect(r.commands[0].argv).toEqual([
                    "sudo",
                    "-n",
                    "apt-get",
                    "install",
                    "-y",
                    "ffmpeg",
                    "wmctrl",
                    "xdotool",
                ]);
            }
        });
    });
});

describe("isProgressNoise", () => {
    test("filters empty / whitespace-only lines", () => {
        expect(isProgressNoise("")).toBe(true);
        expect(isProgressNoise("   ")).toBe(true);
    });

    test("filters single spinner glyphs", () => {
        expect(isProgressNoise("-")).toBe(true);
        expect(isProgressNoise("\\")).toBe(true);
        expect(isProgressNoise("|")).toBe(true);
        expect(isProgressNoise("/")).toBe(true);
    });

    test("filters bar/percent lines (winget download progress)", () => {
        expect(
            isProgressNoise(
                "  ██████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  1024 KB / 2.90 MB",
            ),
        ).toBe(true);
        expect(isProgressNoise("  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  17%")).toBe(
            true,
        );
        expect(isProgressNoise("  ██████████████████████████████  100%")).toBe(
            true,
        );
    });

    test("keeps informational lines (URLs, status, errors)", () => {
        expect(isProgressNoise("Downloading https://example.com/x.zip")).toBe(
            false,
        );
        expect(isProgressNoise("Successfully verified installer hash")).toBe(
            false,
        );
        expect(isProgressNoise("Extracting archive...")).toBe(false);
        expect(
            isProgressNoise(
                "Nested installer file does not exist. Ensure the specified...",
            ),
        ).toBe(false);
        expect(
            isProgressNoise("Found FFmpeg [Gyan.FFmpeg] Version 8.1.1"),
        ).toBe(false);
    });
});

describe("runInstall — install mutex", () => {
    function makeAgentContext(
        overrides: Partial<ScreencaptureActionContext> = {},
    ): ScreencaptureActionContext {
        return { ...createInitialContext(), ...overrides };
    }

    function makeActionContext(
        agentCtx: ScreencaptureActionContext,
    ): ActionContext<ScreencaptureActionContext> {
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
            // Test reads `appended` off the action context for assertions.
            _appended: appended,
        } as any;
    }

    test("returns an in-progress error when installInProgress is already true", async () => {
        const ctx = makeAgentContext({ installInProgress: true });
        const actionContext = makeActionContext(ctx);

        const result = await runInstall(
            { kind: "ok", commands: [] },
            actionContext,
        );
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/already in progress/i);
        // Did not append any "Installing…" status — the early-return is
        // supposed to bail before any side effects.
        expect((actionContext as any)._appended).toEqual([]);
    });

    test("does not flip the installInProgress flag back to false on early-return", async () => {
        // Subtle but important: the early-return must NOT clear the flag,
        // otherwise the second concurrent caller would clear the lock the
        // first caller is still holding.
        const ctx = makeAgentContext({ installInProgress: true });
        await runInstall({ kind: "ok", commands: [] }, makeActionContext(ctx));
        expect(ctx.installInProgress).toBe(true);
    });

    test("clears the flag in the finally block on the success path (empty plan)", async () => {
        const ctx = makeAgentContext({ installInProgress: false });
        const result = await runInstall(
            { kind: "ok", commands: [] },
            makeActionContext(ctx),
        );
        expect(result.error).toBeUndefined();
        expect(ctx.installInProgress).toBe(false);
    });
});

describe("installDetailsFor", () => {
    test("empty when nothing missing", () => {
        expect(installDetailsFor("windows", [])).toBe("");
        expect(installDetailsFor("linux", [])).toBe("");
    });

    test("windows hint points at winget + refresh command", () => {
        const d = installDetailsFor("windows", ["ffmpeg"]);
        expect(d).toMatch(/winget install Gyan\.FFmpeg/);
        expect(d).toMatch(/@config agent refresh screencapture/);
    });

    test("linux hint includes apt/dnf/pacman commands and the missing packages", () => {
        const d = installDetailsFor("linux", ["ffmpeg", "wmctrl"]);
        expect(d).toMatch(/sudo apt install ffmpeg wmctrl/);
        expect(d).toMatch(/sudo dnf install ffmpeg wmctrl/);
        expect(d).toMatch(/sudo pacman -S ffmpeg wmctrl/);
        expect(d).toMatch(/@config agent refresh screencapture/);
    });
});
