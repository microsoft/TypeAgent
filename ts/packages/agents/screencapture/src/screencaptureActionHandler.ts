// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAgent,
    DisplayType,
    DynamicDisplay,
    SessionContext,
    Storage,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
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
import {
    ScreencaptureActionContext,
    createInitialContext,
} from "./context.js";
import {
    PlatformBackend,
    findMissingTool,
    resolvePlatform,
    toolInstallHint,
} from "./platform/index.js";
import { detectFfmpeg } from "./platform/ffmpeg.js";
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
    };
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

async function moveToSessionStorage(
    storage: Storage | undefined,
    absolutePath: string,
    storagePath: string,
): Promise<string | undefined> {
    if (!storage) return undefined;
    try {
        const buffer = await readFile(absolutePath);
        await storage.write(storagePath, buffer);
    } catch (e: any) {
        return `Capture file written but could not be saved into session storage: ${e.message}`;
    } finally {
        await unlink(absolutePath).catch(() => {});
    }
    return undefined;
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

    const moveError = await moveToSessionStorage(
        storage,
        absolutePath,
        storagePath,
    );
    const subject =
        resolved.kind === "window"
            ? `window "${describeWindow(resolved.window)}"`
            : "the screen";
    const successMessage = moveError
        ? `Screenshot of ${subject} saved to ${absolutePath}. ${moveError}`
        : `Screenshot of ${subject} saved to ${storagePath.substring(3)}.`;

    // TODO(screencapture-ux):
    //   1. Render the screenshot inline in the agent message bubble
    //      (likely via createActionResultFromHtmlDisplay with an <img src="data:...">
    //      or a host-side resource reference).
    //   2. Add a "copy to clipboard" affordance on the rendered image.
    //   3. Make the rendered image clickable to open in the OS image viewer.
    //   4. Save a copy in the OS-standard screenshots folder
    //      (Windows: %USERPROFILE%\Pictures\Screenshots, Linux: ~/Pictures)
    //      in addition to session storage.
    const result = createActionResultFromTextDisplay(successMessage);
    result.entities.push({
        name: moveError ? absolutePath : storagePath.substring(3),
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

    const moveError = await moveToSessionStorage(
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
