// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Readiness/setup wiring for the code agent.
//
// Architecture note: the agent itself is the WebSocket SERVER; the VS Code
// extension is a client that connects to it. So "ready" means a VS Code
// instance with the extension installed has an open connection to our
// server — not that we can dial out to a port.

import { spawn } from "child_process";
import registerDebug from "debug";
import {
    ActionContext,
    ActionResult,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";

const debug = registerDebug("typeagent:code");

// HH:MM timestamp prefix for status updates — same convention used by
// screencapture / desktop / calendar so progress reads consistently.
function ts(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type CodeReadinessProbe = {
    // True iff CodeAgentWebSocketServer.isConnected() returns true. Combines
    // "server not yet started" and "server started but no client" — both
    // surface the same way to the user.
    clientConnected: boolean;
    // True iff `code` resolves on PATH. Cheap proxy for "VS Code is
    // installed and CLI-accessible". Used to distinguish a real
    // configuration gap (VS Code not installed) from a transient runtime
    // state (VS Code just isn't running right now). The user-facing
    // framing matters here: blocking with "needs configuration" when the
    // user has set everything up correctly and just closed VS Code is
    // misleading.
    vsCodeCliInstalled: boolean;
    // For messaging only. Undefined until the shared server is bound; the
    // user-facing message then omits the port number. Pulled from the
    // actual bound port (via getSharedCodePort()) so readiness stays in
    // sync with the registered listener, including when the OS picked a
    // free ephemeral port (port=0 default).
    port: number | undefined;
};

// Pure decision function — exported for unit tests so we don't have to
// stand up a real WebSocketServer to exercise the readiness contract.
//
// Three outcomes (all but the last block execution at the dispatcher's
// pre-flight):
//   - connected → ready.
//   - not connected, no CLI on PATH → setup-required (real config gap;
//       install VS Code + Coda extension).
//   - not connected, CLI present → setup-required (transient; VS Code
//       just isn't running). Same state but distinct messaging — `setup`
//       will launch VS Code and resolve it.
export function evaluateCodeReadiness(
    probe: CodeReadinessProbe,
): ReadinessReport {
    if (probe.clientConnected) {
        return { state: "ready" };
    }
    if (!probe.vsCodeCliInstalled) {
        return {
            state: "setup-required",
            message: "VS Code is not installed (or `code` is not on PATH).",
            details: [
                "Install VS Code (https://code.visualstudio.com) and the Coda extension, then run `@config agent refresh code`.",
                "On macOS you may also need to run \"Shell Command: Install 'code' command in PATH\" from the VS Code Command Palette.",
            ].join("\n"),
        };
    }
    // CLI present but no client connected → the user has VS Code installed
    // but it isn't currently running (or the Coda extension hasn't loaded).
    // This is a transient runtime state, not a config problem; `setup`
    // resolves it by launching VS Code and waiting for the extension to
    // connect.
    const portSuffix = probe.port !== undefined ? ` on port ${probe.port}` : "";
    return {
        state: "setup-required",
        message: `VS Code isn't currently running (or the Coda extension isn't connected${portSuffix}).`,
        details:
            "Run `@config agent setup code` to launch VS Code — the Coda extension will auto-connect — or open VS Code yourself and your code commands will start working immediately.",
    };
}

// Cheap "is this on PATH" probe via `where` (Windows) or `which` (POSIX).
// One subprocess per readiness refresh, which the dispatcher caches —
// well within the AppAgent.checkReadiness contract. Returns false on any
// error (spawn failure, non-zero exit) since either way the tool isn't
// usable.
export async function whichExists(tool: string): Promise<boolean> {
    const cmd = process.platform === "win32" ? "where" : "which";
    return new Promise((resolve) => {
        const child = spawn(cmd, [tool], {
            stdio: ["ignore", "ignore", "ignore"],
            windowsHide: true,
        });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}

// Resolves the explicit port override (CODE_WEBSOCKET_PORT) for readiness
// messaging when the shared server isn't bound yet. Returns undefined to
// signal "no static port" — the caller (readiness probe) should query
// `getSharedCodePort()` first and fall through here only when the server
// hasn't been started yet.
//
// Validation matches getCodeBindPort() in codeActionHandler.ts.
export function resolveCodePortOverride(
    env: NodeJS.ProcessEnv,
): number | undefined {
    const raw = env.CODE_WEBSOCKET_PORT;
    if (raw === undefined) return undefined;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
        debug(
            `CODE_WEBSOCKET_PORT override active: using port ${n} (set in environment)`,
        );
        return n;
    }
    debug(
        `CODE_WEBSOCKET_PORT override ignored: invalid value %o; falling back to OS-assigned port`,
        raw,
    );
    return undefined;
}

// ============================================================================
// Setup hook — drives `code --new-window` and polls the agent's WebSocket
// server until the extension client connects (or times out).
// ============================================================================

// Spawns `code --new-window` to launch VS Code. The Coda extension auto-
// connects to our server on activation. Errors are non-fatal here — the
// poll-for-connection loop is the actual success signal.
async function launchVSCode(): Promise<void> {
    return new Promise((resolve) => {
        const child = spawn("code", ["--new-window"], {
            detached: true,
            stdio: "ignore",
            shell: process.platform === "win32",
        });
        child.on("error", () => resolve());
        // Don't await VS Code's exit — it's a long-running window the user
        // is supposed to interact with. Once spawn succeeds, return.
        child.unref();
        resolve();
    });
}

// Polls the WebSocket server's isConnected() at 500ms intervals up to the
// supplied timeout. Splits the wait into small steps so we can report
// progress and bail promptly when the client connects.
async function waitForClient(
    isConnected: () => boolean,
    timeoutMs: number,
    onTick: (elapsedSec: number) => void,
): Promise<boolean> {
    const start = Date.now();
    const POLL_MS = 500;
    let lastReportedSec = -1;
    while (Date.now() - start < timeoutMs) {
        if (isConnected()) return true;
        await new Promise((r) => setTimeout(r, POLL_MS));
        const elapsedSec = Math.floor((Date.now() - start) / 1000);
        // Throttle status updates to roughly one per 5s — enough that the
        // user knows we haven't hung, not so frequent that the chat fills
        // up with countdown lines.
        if (elapsedSec % 5 === 0 && elapsedSec !== lastReportedSec) {
            onTick(elapsedSec);
            lastReportedSec = elapsedSec;
        }
    }
    return isConnected();
}

// `setup` entry point — returns the yes/no card. The actual launch +
// polling runs later in the choice callback.
export async function setupCode(
    actionContext: ActionContext<unknown>,
    choiceManager: ChoiceManager,
    isConnected: () => boolean,
    port: number | undefined,
): Promise<ActionResult> {
    if (isConnected()) {
        // Defense-in-depth: dispatcher only invokes setup() when readiness
        // is `setup-required`, but the cached state can lag (especially on
        // initial probe before updateAgentContext has run). Short-circuit
        // when we can — the dispatcher's post-setup readiness refresh will
        // pick up the actual state.
        return createActionResultFromTextDisplay(
            "VS Code is already connected.",
        );
    }
    const portSuffix = port !== undefined ? ` on port ${port}` : "";
    return createYesNoChoiceResult(
        choiceManager,
        `Launch VS Code? The Coda extension will auto-connect to the code agent's WebSocket server${portSuffix}. I'll wait up to 30 seconds for the connection — you can keep working in the meantime.`,
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Skipped. Open VS Code with the Coda extension when ready, then run `@config agent refresh code`.",
                );
            }
            return runLaunchAndWait(liveActionContext, isConnected, port);
        },
    );
}

// Executes the launch+wait flow. Exported for unit tests — the
// `isConnected` and `launchImpl` injection points let tests verify the
// poll/timeout behavior without spawning VS Code.
//
// `launchImpl` defaults to the real `code --new-window` spawner; tests
// pass a no-op.
export async function runLaunchAndWait(
    actionContext: ActionContext<unknown>,
    isConnected: () => boolean,
    port: number | undefined,
    options?: {
        timeoutMs?: number;
        launchImpl?: () => Promise<void>;
    },
): Promise<ActionResult> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const launchImpl = options?.launchImpl ?? launchVSCode;

    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: `[${ts()}] Launching VS Code…`,
            kind: "status",
        },
        "block",
    );
    try {
        await launchImpl();
    } catch (e: any) {
        return createActionResultFromError(
            `[${ts()}] Failed to launch VS Code: ${e?.message ?? e}. Make sure the \`code\` CLI is on PATH (Command Palette → "Shell Command: Install 'code' command in PATH"), then try again.`,
        );
    }

    const waitOn = port !== undefined ? ` on port ${port}` : "";
    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: `[${ts()}] Waiting for the Coda extension to connect${waitOn} (up to ${Math.round(timeoutMs / 1000)}s)…`,
            kind: "status",
        },
        "block",
    );

    const connected = await waitForClient(isConnected, timeoutMs, (elapsed) => {
        actionContext.actionIO.appendDisplay(
            {
                type: "text",
                content: `[${ts()}] Still waiting (${elapsed}s elapsed)…`,
                kind: "status",
            },
            "inline",
        );
    });

    if (!connected) {
        return createActionResultFromError(
            `[${ts()}] No connection after ${Math.round(timeoutMs / 1000)}s. Check that the Coda extension is installed and enabled in VS Code, then run \`@config agent refresh code\`.`,
        );
    }
    return createActionResultFromTextDisplay(
        `[${ts()}] VS Code connected. Re-run your code command — readiness was re-checked automatically.`,
    );
}
