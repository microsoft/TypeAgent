// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    AppAgent,
    DisplayType,
    DynamicDisplay,
    ReadinessReport,
    SessionContext,
    Storage,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultFromHtmlDisplay,
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { readFile, unlink, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import registerDebug from "debug";

import {
    ScreencaptureAction,
    ScreencaptureActivity,
} from "./screencaptureSchema.js";
import { ScreencaptureActionContext, createInitialContext } from "./context.js";
import {
    PlatformBackend,
    PlatformSupport,
    describePlatformSupport,
    findMissingTool,
    installDetailsFor,
    resolvePlatform,
    toolInstallHint,
} from "./platform/index.js";
import { detectFfmpeg, which } from "./platform/ffmpeg.js";
import {
    SetupPlan,
    planSetupCommand,
    probeLinuxInstaller,
    runSetupCommand,
} from "./setup.js";
import type { WindowInfo } from "./platform/windowEnumerator.js";
import { matchWindow } from "./windowMatcher.js";
import { runOnce, spawnRecording, stopRecording } from "./recordingProcess.js";

const debug = registerDebug("typeagent:screencapture:handler");

const RECORDING_DISPLAY_ID = "recording";
const FULL_SCREEN_ALIASES = new Set([
    "screen",
    "the screen",
    "my screen",
    "desktop",
    "the desktop",
    "my desktop",
    "everything",
    "the whole screen",
    "whole screen",
    "monitor",
    "the monitor",
    "primary monitor",
]);

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: async () => createInitialContext(),
        executeAction,
        getDynamicDisplay,
        checkReadiness,
        setup: async (actionContext) =>
            offerInstall(
                actionContext as ActionContext<ScreencaptureActionContext>,
            ),
        // Routes user yes/no responses (from createYesNoChoiceResult) back to
        // the registered ChoiceManager callback — same shape as
        // osNotifications. The AppAgent signature types context as
        // ActionContext<unknown>; cast to access our agent context.
        handleChoice: async (choiceId, response, context) => {
            const ctx = (context as ActionContext<ScreencaptureActionContext>)
                .sessionContext.agentContext;
            return ctx.choiceManager.handleChoice(choiceId, response, context);
        },
    };
}

// Pure decision function for readiness — split out from the agent's
// checkReadiness hook so it can be unit-tested without spawning `which`
// or mocking process.platform. Mirrors the player/osNotifications pattern.
//
//   - Unsupported platform (macOS, Wayland) → "unsupported".
//   - Missing ffmpeg or platform extra tools → "setup-required".
//   - Otherwise → "ready".
//
// A `setup` hook IS provided (winget on Windows, apt on Linux) — but it's
// best-effort: missing installer or password-required sudo falls back to
// the manual hint baked into ReadinessReport.details. See offerInstall /
// runInstall below.
//
// Exported for unit tests.
export function evaluateReadiness(
    support: PlatformSupport,
    ffmpegFound: boolean,
    missingExtraTools: string[],
): ReadinessReport {
    if (!support.supported) {
        return { state: "unsupported", message: support.reason };
    }
    const missing: string[] = [];
    if (!ffmpegFound) missing.push("ffmpeg");
    missing.push(...missingExtraTools);
    if (missing.length === 0) return { state: "ready" };
    return {
        state: "setup-required",
        message: `Required tools not found on PATH: ${missing.join(", ")}.`,
        details: installDetailsFor(support.platformName, missing),
    };
}

// Thin async wrapper: probes PATH for ffmpeg and any platform-specific
// extra tools, then defers to evaluateReadiness for the decision. Probes
// are `where`/`which` subprocess calls — borderline of "cheap" per the
// AppAgent.checkReadiness contract, but the dispatcher caches the result,
// so this runs at most once per refresh.
async function checkReadiness(): Promise<ReadinessReport> {
    const support = describePlatformSupport(
        process.platform,
        process.env.XDG_SESSION_TYPE,
    );
    if (!support.supported) {
        return evaluateReadiness(support, false, []);
    }
    const ffmpegFound = (await which("ffmpeg")) !== undefined;
    const missingExtraTools: string[] = [];
    for (const tool of support.extraTools) {
        if ((await which(tool)) === undefined) missingExtraTools.push(tool);
    }
    return evaluateReadiness(support, ffmpegFound, missingExtraTools);
}

// ============================================================================
// Setup — best-effort installer (winget on Windows, apt on Linux). The
// dispatcher invokes setup() when the agent is in `setup-required` and the
// user confirms via @config agent setup (or the setupOnFirstUse pre-flight
// path). After setup runs, the dispatcher re-calls checkReadiness — agents
// don't get to self-report readiness, so a stale/cached install probe is
// not a concern. See setup.ts for the install pipeline.
// ============================================================================

// Re-probes the environment to figure out exactly which tools are missing
// and whether an installer is available. Returns a concrete SetupPlan plus
// the missing-tool list (used in the confirmation card body).
async function planAutomatedSetup(): Promise<{
    missing: string[];
    plan: SetupPlan;
}> {
    const support = describePlatformSupport(
        process.platform,
        process.env.XDG_SESSION_TYPE,
    );
    if (!support.supported) {
        // Unsupported platform shouldn't reach setup() (state is "unsupported"
        // not "setup-required"), but defense-in-depth.
        return {
            missing: [],
            plan: { kind: "error", message: support.reason },
        };
    }
    const missing: string[] = [];
    if ((await which("ffmpeg")) === undefined) missing.push("ffmpeg");
    for (const tool of support.extraTools) {
        if ((await which(tool)) === undefined) missing.push(tool);
    }
    if (missing.length === 0) {
        return { missing, plan: { kind: "ok", commands: [] } };
    }
    if (support.platformName === "windows") {
        const wingetPresent = (await which("winget")) !== undefined;
        const plan = planSetupCommand("windows", missing, { wingetPresent });
        return { missing, plan };
    }
    const linux = await probeLinuxInstaller();
    const plan = planSetupCommand("linux", missing, { linux });
    return { missing, plan };
}

// Builds the yes/no confirmation card. The actual install runs in the
// choice callback (a fresh ActionContext minted by the dispatcher) — see
// runInstall.
async function offerInstall(
    actionContext: ActionContext<ScreencaptureActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const { missing, plan } = await planAutomatedSetup();

    if (missing.length === 0) {
        return createActionResultFromTextDisplay(
            "Nothing to install — all required tools are already on PATH.",
        );
    }
    if (plan.kind === "error") {
        // No installer / passwordless sudo — return a plain error so the
        // dispatcher surfaces the manual-install hint to the user.
        return createActionResultFromError(plan.message);
    }
    return offerYesNoCard(ctx, missing, plan);
}

function offerYesNoCard(
    ctx: ScreencaptureActionContext,
    missing: string[],
    plan: SetupPlan & { kind: "ok" },
): ActionResultSuccess {
    const summary = plan.commands
        .map((c) => `  - ${c.argv.join(" ")}`)
        .join("\n");
    const prompt = [
        `Install missing tool${missing.length === 1 ? "" : "s"} (${missing.join(", ")})? The following will run:`,
        summary,
        "",
        "Downloads can take 30–60 seconds (or longer on slow networks). I'll stream progress here and post a final message when it completes — no need to wait actively.",
    ].join("\n");
    return createYesNoChoiceResult(
        ctx.choiceManager,
        prompt,
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Install skipped. Run the commands manually, then `@config agent refresh screencapture`.",
                );
            }
            return runInstall(
                plan,
                liveActionContext as ActionContext<ScreencaptureActionContext>,
            );
        },
    );
}

// HH:MM timestamp prefix for status updates. Honored across every status
// line during install so the user can read elapsed time at a glance even
// if winget output is intermittent.
function ts(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Runs after the user confirms the setup card. Lives in the handleChoice
// callback path, so it executes in a fresh ActionContext — display goes
// via actionIO.appendDisplay; the final ActionResult closes the message.
//
// Exported for unit tests — they verify the mutex early-return path
// without invoking the heavy install pipeline.
export async function runInstall(
    plan: SetupPlan & { kind: "ok" },
    actionContext: ActionContext<ScreencaptureActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;

    // See ScreencaptureActionContext.installInProgress — the dispatcher's
    // setup-window mutex only covers the synchronous setup() call, not the
    // deferred work behind the yes/no card. This catches two clients each
    // confirming their own setup prompt before either install completes.
    if (ctx.installInProgress) {
        return createActionResultFromError(
            "Install is already in progress (another client is running it). Wait for it to finish, then re-run `@config agent setup screencapture` if needed.",
        );
    }
    ctx.installInProgress = true;
    const overallStartMs = Date.now();

    try {
        const stepCount = plan.commands.length;
        if (stepCount > 0) {
            // Anchor message — guarantees the user sees something
            // immediately after clicking Yes, even before winget produces
            // its first line.
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] Starting install (${stepCount} step${stepCount === 1 ? "" : "s"}). I'll post here when it finishes — feel free to do other things in the meantime.`,
                    kind: "status",
                },
                "block",
            );
        }

        for (let i = 0; i < plan.commands.length; i++) {
            const cmd = plan.commands[i];
            const stepStartMs = Date.now();
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] Step ${i + 1}/${stepCount}: ${cmd.description}…`,
                    kind: "status",
                },
                "block",
            );
            const { code, tail } = await runSetupCommand(cmd, (line) =>
                actionContext.actionIO.appendDisplay(
                    {
                        type: "text",
                        content: `[${ts()}] ${line}`,
                        kind: "status",
                    },
                    "inline",
                ),
            );
            const stepElapsed = Math.round((Date.now() - stepStartMs) / 1000);
            if (code !== 0) {
                return createActionResultFromError(
                    `[${ts()}] Install failed after ${stepElapsed}s (\`${cmd.argv[0]}\` exited with code ${code}). Last output:\n${tail}`,
                );
            }
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] ✓ Step ${i + 1}/${stepCount} complete (${stepElapsed}s).`,
                    kind: "status",
                },
                "block",
            );
        }
        // The dispatcher re-runs checkReadiness after setup completes; if
        // anything is still missing the next action will surface another
        // setup-required error with the remaining tools listed.
        const totalElapsed = Math.round((Date.now() - overallStartMs) / 1000);
        return createActionResultFromTextDisplay(
            `[${ts()}] Install complete in ${totalElapsed}s. Re-run your screen capture command — readiness was re-checked automatically.`,
        );
    } finally {
        ctx.installInProgress = false;
    }
}

async function executeAction(
    action: TypeAgentAction<ScreencaptureAction | ScreencaptureActivity>,
    context: ActionContext<ScreencaptureActionContext>,
): Promise<ActionResult> {
    const ctx = context.sessionContext.agentContext;
    switch (action.actionName) {
        case "listWindows":
            return handleListWindows(ctx);
        case "takeScreenshot":
            return handleTakeScreenshot(
                action.parameters.target,
                ctx,
                context.sessionContext.sessionStorage,
            );
        case "startRecording":
            return handleStartRecording(action.parameters.target, ctx);
        case "stopRecording":
            return handleStopRecording(
                ctx,
                context.sessionContext.sessionStorage,
            );
        case "recording":
            // Activity-resume: nothing to do; the recording is already running.
            return createActionResultFromTextDisplay(
                describeActiveRecording(ctx),
            );
        default:
            return createActionResultFromError(
                `Unknown action: ${(action as any).actionName}`,
            );
    }
}

async function ensureBackend(
    ctx: ScreencaptureActionContext,
): Promise<PlatformBackend | string> {
    if (ctx.backend !== undefined) return ctx.backend;
    if (ctx.backendError !== undefined) return ctx.backendError;
    const res = await resolvePlatform();
    if (!res.ok) {
        ctx.backendError = res.reason;
        return res.reason;
    }
    ctx.backend = res.backend;
    return res.backend;
}

async function ensureFfmpeg(
    ctx: ScreencaptureActionContext,
): Promise<string | { error: string }> {
    if (ctx.ffmpegPath) return ctx.ffmpegPath;
    if (ctx.ffmpegPath === null) {
        // Probed previously and missing — re-probe, the user may have just
        // installed it.
        ctx.ffmpegPath = undefined;
    }
    const status = await detectFfmpeg();
    if (status.found) {
        ctx.ffmpegPath = status.path;
        return status.path;
    }
    ctx.ffmpegPath = null;
    return { error: status.installHint };
}

async function ensureExtraTools(
    backend: PlatformBackend,
): Promise<string | undefined> {
    const missing = await findMissingTool(backend.requiredTools);
    if (missing) return toolInstallHint(missing);
    return undefined;
}

function isFullScreenAlias(target: string | undefined): boolean {
    if (!target) return true;
    return FULL_SCREEN_ALIASES.has(target.trim().toLowerCase());
}

function timestampForFile(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureTempDir(): Promise<string> {
    const dir = path.join(tmpdir(), "typeagent-screencapture");
    await mkdir(dir, { recursive: true });
    return dir;
}

// Reads the captured file once, optionally writes it to session storage,
// then unlinks the temp file. Returns the buffer (so callers can embed it
// inline in chat without a second disk read) plus any non-fatal storage
// error to surface to the user.
async function persistCapture(
    storage: Storage | undefined,
    absolutePath: string,
    storagePath: string,
): Promise<{ buffer: Buffer | undefined; moveError: string | undefined }> {
    let buffer: Buffer | undefined;
    let moveError: string | undefined;
    try {
        buffer = await readFile(absolutePath);
        if (storage) {
            try {
                await storage.write(storagePath, buffer);
            } catch (e: any) {
                moveError = `Capture file could not be saved into session storage: ${e.message}`;
            }
        }
    } catch (e: any) {
        moveError = `Capture file could not be read for storage/embed: ${e.message}`;
    } finally {
        await unlink(absolutePath).catch(() => {});
    }
    return { buffer, moveError };
}

// Cap on inline-embed size. Bigger captures (4K screens, busy desktops)
// fall back to text-only with the storage path so we don't bloat chat
// history with multi-MB base64 blobs that have to be re-rendered on
// every session restore. 8 MB raw → ~11 MB base64; comfortable for
// typical 1080p desktop screenshots, conservative for the rest.
const MAX_INLINE_EMBED_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
};

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function resolveTarget(
    target: string | undefined,
    backend: PlatformBackend,
): Promise<
    | { kind: "fullScreen" }
    | { kind: "window"; window: WindowInfo }
    | { kind: "noMatch"; tried: string }
> {
    if (isFullScreenAlias(target)) return { kind: "fullScreen" };
    const windows = await backend.enumerateWindows();
    const matched = await matchWindow(target!, windows);
    if (matched) return { kind: "window", window: matched };
    return { kind: "noMatch", tried: target! };
}

function describeWindow(w: WindowInfo): string {
    return `${w.processName} — ${w.title}`;
}

async function handleListWindows(
    ctx: ScreencaptureActionContext,
): Promise<ActionResult> {
    const backend = await ensureBackend(ctx);
    if (typeof backend === "string") {
        return createActionResultFromError(backend);
    }
    const toolError = await ensureExtraTools(backend);
    if (toolError) return createActionResultFromError(toolError);

    let windows: WindowInfo[];
    try {
        windows = await backend.enumerateWindows();
    } catch (e: any) {
        return createActionResultFromError(
            `Could not list windows: ${e.message}`,
        );
    }
    if (windows.length === 0) {
        return createActionResult("No visible windows.");
    }
    const lines = windows.map((w) => `- **${w.processName}** — ${w.title}`);
    return createActionResultFromMarkdownDisplay(
        `Visible windows:\n\n${lines.join("\n")}`,
    );
}

async function handleTakeScreenshot(
    target: string | undefined,
    ctx: ScreencaptureActionContext,
    storage: Storage | undefined,
): Promise<ActionResult> {
    const backend = await ensureBackend(ctx);
    if (typeof backend === "string") {
        return createActionResultFromError(backend);
    }
    const ffmpeg = await ensureFfmpeg(ctx);
    if (typeof ffmpeg !== "string") {
        return createActionResultFromError(ffmpeg.error);
    }
    if (!isFullScreenAlias(target)) {
        const toolError = await ensureExtraTools(backend);
        if (toolError) return createActionResultFromError(toolError);
    }

    const resolved = await resolveTarget(target, backend);
    if (resolved.kind === "noMatch") {
        return createActionResultFromError(
            `No visible window matched "${resolved.tried}". Try "list open windows" to see what's available.`,
        );
    }

    const ext = backend.extensions.screenshot;
    const filename = `${timestampForFile()}-${randomUUID().slice(0, 8)}.${ext}`;
    const tempDir = await ensureTempDir();
    const absolutePath = path.join(tempDir, filename);
    const storagePath = `../screenshots/${filename}`;

    const args = await backend.buildScreenshotArgs(
        resolved.kind === "window" ? resolved.window : null,
        absolutePath,
    );
    debug("screenshot args:", args);
    const { code, stderr } = await runOnce(ffmpeg, args);
    if (code !== 0) {
        await unlink(absolutePath).catch(() => {});
        return createActionResultFromError(
            `ffmpeg exited with code ${code}.\n${truncate(stderr, 800)}`,
        );
    }

    const { buffer, moveError } = await persistCapture(
        storage,
        absolutePath,
        storagePath,
    );
    const subject =
        resolved.kind === "window"
            ? `window "${describeWindow(resolved.window)}"`
            : "the screen";
    const savedTo = moveError ? absolutePath : storagePath.substring(3);
    const successMessage = moveError
        ? `Screenshot of ${subject} saved to ${absolutePath}. ${moveError}`
        : `Screenshot of ${subject} saved to ${savedTo}.`;

    // TODO(screencapture-ux):
    //   1. Add a "copy to clipboard" affordance on the rendered image.
    //   2. Make the rendered image clickable to open in the OS image viewer.
    //   3. Save a copy in the OS-standard screenshots folder
    //      (Windows: %USERPROFILE%\Pictures\Screenshots, Linux: ~/Pictures)
    //      in addition to session storage.

    const mime = MIME_BY_EXT[ext] ?? "image/png";
    const canEmbed =
        buffer !== undefined && buffer.length <= MAX_INLINE_EMBED_BYTES;

    // Both helpers return ActionResultSuccess; type the local var as
    // such so we can push into entities without narrowing the union.
    let result: ActionResultSuccess;
    if (canEmbed) {
        // The bubble shows the message + inline image. historyText keeps
        // only the textual summary so retrieval/contextual replay doesn't
        // pull megabytes of base64 forward.
        const dataUri = `data:${mime};base64,${buffer!.toString("base64")}`;
        const html = [
            `<div>`,
            `  <div>${escapeHtml(successMessage)}</div>`,
            `  <img src="${dataUri}"`,
            `       alt="screenshot of ${escapeHtml(subject)}"`,
            `       style="max-width:100%;max-height:400px;margin-top:6px;border-radius:4px;border:1px solid #e5e7eb;display:block" />`,
            `</div>`,
        ].join("\n");
        result = createActionResultFromHtmlDisplay(html, successMessage);
    } else {
        // Buffer missing (read failure) or too large — fall back to text
        // and lean on the saved path. Note buffer-too-large is
        // diagnostic-only; the file IS saved.
        result = createActionResultFromTextDisplay(successMessage);
    }
    result.entities.push({
        name: savedTo,
        type: ["file", "image", "screenshot"],
    });
    return result;
}

async function handleStartRecording(
    target: string | undefined,
    ctx: ScreencaptureActionContext,
): Promise<ActionResult> {
    if (ctx.active !== undefined) {
        return createActionResult(
            `Already recording (${describeActiveRecording(ctx)}). Stop the current recording before starting a new one.`,
        );
    }
    const backend = await ensureBackend(ctx);
    if (typeof backend === "string") {
        return createActionResultFromError(backend);
    }
    const ffmpeg = await ensureFfmpeg(ctx);
    if (typeof ffmpeg !== "string") {
        return createActionResultFromError(ffmpeg.error);
    }
    if (!isFullScreenAlias(target)) {
        const toolError = await ensureExtraTools(backend);
        if (toolError) return createActionResultFromError(toolError);
    }

    const resolved = await resolveTarget(target, backend);
    if (resolved.kind === "noMatch") {
        return createActionResultFromError(
            `No visible window matched "${resolved.tried}". Try "list open windows" to see what's available.`,
        );
    }

    const ext = backend.extensions.recording;
    const filename = `${timestampForFile()}-${randomUUID().slice(0, 8)}.${ext}`;
    const tempDir = await ensureTempDir();
    const absolutePath = path.join(tempDir, filename);
    const storagePath = `../recordings/${filename}`;

    const args = await backend.buildRecordArgs(
        resolved.kind === "window" ? resolved.window : null,
        absolutePath,
    );
    debug("record args:", args);
    const rec = spawnRecording(ffmpeg, args);

    // ffmpeg startup errors (missing window, bad geometry, codec issues)
    // surface within the first few hundred ms via early process exit. Wait
    // briefly so we can return a meaningful error instead of a fake "started".
    const earlyExit = await Promise.race([
        rec.exit,
        new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), 750),
        ),
    ]);
    if (earlyExit !== undefined) {
        await unlink(absolutePath).catch(() => {});
        return createActionResultFromError(
            `ffmpeg exited immediately (code ${earlyExit.code}).\n${truncate(earlyExit.stderr, 800)}`,
        );
    }

    const startedAtMs = Date.now();
    const targetLabel =
        resolved.kind === "window"
            ? describeWindow(resolved.window)
            : undefined;
    ctx.active = {
        spawned: rec,
        absolutePath,
        storagePath,
        target: targetLabel,
        startedAtMs,
    };

    rec.exit.catch((e) => debug("recording exit error:", e));

    const subject = targetLabel ? `window "${targetLabel}"` : "the screen";
    const result = createActionResultFromTextDisplay(
        `Recording ${subject}. Say "stop recording" to finish.`,
    );
    result.activityContext = {
        activityName: "recording",
        description: "screen recording in progress",
        state: {
            target: targetLabel,
            outputPath: storagePath,
            startedAtMs,
        },
    };
    result.dynamicDisplayId = RECORDING_DISPLAY_ID;
    result.dynamicDisplayNextRefreshMs = 1000;
    return result;
}

async function handleStopRecording(
    ctx: ScreencaptureActionContext,
    storage: Storage | undefined,
): Promise<ActionResult> {
    const active = ctx.active;
    if (active === undefined) {
        return createActionResult("No recording is active.");
    }
    const { code, stderr } = await stopRecording(active.spawned);
    ctx.active = undefined;

    if (code !== 0) {
        // ffmpeg can exit non-zero on graceful "q" stop in some versions;
        // still try to keep the file if it exists.
        debug(`ffmpeg exited with ${code}: ${stderr}`);
    }

    // Recordings reuse the same persist helper. Inline-embedding video is
    // a follow-up (would need a <video> tag + larger size cap, and most
    // recordings exceed it anyway), so we ignore the buffer here.
    const { moveError } = await persistCapture(
        storage,
        active.absolutePath,
        active.storagePath,
    );
    const elapsed = Math.round((Date.now() - active.startedAtMs) / 1000);
    const subject = active.target ? `window "${active.target}"` : "the screen";
    const message = moveError
        ? `Stopped recording ${subject} after ${elapsed}s. Saved to ${active.absolutePath}. ${moveError}`
        : `Stopped recording ${subject} after ${elapsed}s. Saved to ${active.storagePath.substring(3)}.`;

    const result = createActionResultFromTextDisplay(message);
    result.entities.push({
        name: moveError ? active.absolutePath : active.storagePath.substring(3),
        type: ["file", "video", "screen-recording"],
    });
    result.activityContext = null;
    return result;
}

function describeActiveRecording(ctx: ScreencaptureActionContext): string {
    const a = ctx.active;
    if (!a) return "no active recording";
    const elapsed = Math.round((Date.now() - a.startedAtMs) / 1000);
    const subject = a.target ? `window "${a.target}"` : "screen";
    return `recording ${subject} — ${formatElapsed(elapsed)} elapsed`;
}

function formatElapsed(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${m}:${pad(s)}`;
}

function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function getDynamicDisplay(
    type: DisplayType,
    displayId: string,
    context: SessionContext<ScreencaptureActionContext>,
): Promise<DynamicDisplay> {
    if (displayId !== RECORDING_DISPLAY_ID) {
        return { content: "", nextRefreshMs: -1 };
    }
    const ctx = context.agentContext;
    if (ctx.active === undefined) {
        return { content: "Recording finished.", nextRefreshMs: -1 };
    }
    return {
        content: describeActiveRecording(ctx),
        nextRefreshMs: 1000,
    };
}
