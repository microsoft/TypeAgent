// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcMain, dialog, WebContentsView, BrowserWindow } from "electron";
import { readFileSync } from "fs";

async function openDemoFile(window: BrowserWindow) {
    const options = {
        filters: [{ name: "Text files", extensions: ["txt"] }],
    };

    const result = await dialog.showOpenDialog(window, options);
    if (result && !result.canceled) {
        let paths = result.filePaths;
        if (paths && paths.length > 0) {
            const content = readFileSync(paths[0], "utf-8").toString();
            console.log(content);
            return content;
        }
    }

    return undefined;
}

function registerAbort(): {
    promise: Promise<void>;
    unregister: () => void;
} {
    let resolveFn!: () => void;
    const promise = new Promise<void>((resolve) => {
        resolveFn = resolve;
    });
    abortListeners.add(resolveFn);
    return {
        promise,
        unregister: () => {
            abortListeners.delete(resolveFn);
        },
    };
}

function getActionCompleteEvent(awaitKeyboardInput: boolean) {
    const timeoutPromise = new Promise((f) => setTimeout(f, 3000));

    let ipcCallback:
        | ((event: Electron.IpcMainEvent, name: string) => void)
        | undefined;
    const actionPromise = new Promise<string | undefined>((resolve) => {
        ipcCallback = (_event: Electron.IpcMainEvent, name: string) => {
            const targetName = awaitKeyboardInput
                ? "Alt+Right"
                : "CommandProcessed";
            if (name === targetName) {
                resolve(undefined);
            }
        };
        ipcMain.on("send-demo-event", ipcCallback);
    });

    const abort = registerAbort();
    const races: Promise<unknown>[] = awaitKeyboardInput
        ? [actionPromise, abort.promise]
        : [actionPromise, timeoutPromise, abort.promise];

    return Promise.race(races).finally(() => {
        if (ipcCallback) ipcMain.removeListener("send-demo-event", ipcCallback);
        abort.unregister();
    });
}

function sendChatInputText(message: string, chatView: WebContentsView) {
    const timeoutPromise = new Promise((f) =>
        setTimeout(f, Math.max(2000, message.length * 50)),
    );

    let ipcCallback: ((event: Electron.IpcMainEvent) => void) | undefined;
    const actionPromise = new Promise<string | undefined>((resolve) => {
        ipcCallback = (_event: Electron.IpcMainEvent) => {
            resolve(undefined);
        };
        ipcMain.on("send-input-text-complete", ipcCallback);
    });

    const abort = registerAbort();

    chatView.webContents.send("send-input-text", message);
    return Promise.race([actionPromise, timeoutPromise, abort.promise]).finally(
        () => {
            if (ipcCallback)
                ipcMain.removeListener("send-input-text-complete", ipcCallback);
            abort.unregister();
        },
    );
}

const abortListeners = new Set<() => void>();

// "aborted" is the transient internal state set by breakDemo() while
// the running loop unwinds; it is not emitted to the UI (the renderer
// only sees the user-facing "running" / "paused" / "idle" trio, and
// "aborted" collapses to "idle" once the loop exits).
export type DemoState = "idle" | "running" | "paused" | "aborted";

let demoState: DemoState = "idle";

// Helper to defeat TS's narrowing of the module-level `demoState` after the
// runDemo() entry guard.  Without it, TS sees `demoState !== "idle"` early-
// return and narrows demoState to `"idle"` for the rest of the function,
// which makes subsequent comparisons against "aborted" look "unintentional"
// even though setDemoState() mutates it asynchronously.
function getDemoState(): DemoState {
    return demoState;
}

function setDemoState(chatView: WebContentsView, state: DemoState): void {
    demoState = state;
    if (state !== "aborted") {
        chatView.webContents.send("demo-state", state);
    }
}

/** True if a demo is currently running, paused, or aborting. */
export function isDemoActive(): boolean {
    return demoState !== "idle";
}

/** Request that the currently-running demo abort at the next safe point. */
export function breakDemo(): boolean {
    if (demoState === "idle") return false;
    demoState = "aborted";
    // Snapshot + clear so re-entrant unregister calls during resolve are safe.
    const listeners = Array.from(abortListeners);
    abortListeners.clear();
    for (const l of listeners) l();
    return true;
}

export async function runDemo(
    window: BrowserWindow,
    chatView: WebContentsView,
    awaitKeyboardInput: boolean,
    onStart?: () => void,
): Promise<boolean> {
    if (demoState !== "idle") {
        await dialog.showMessageBox(window, {
            type: "warning",
            title: "Demo already running",
            message:
                "A demo is already running. Wait for it to finish, press Esc to abort it, or restart the shell before starting another.",
        });
        return false;
    }

    const data = await openDemoFile(window);
    if (!data) {
        return false;
    }

    onStart?.();
    setDemoState(chatView, "running");
    try {
        const lines = data.split(/\r?\n/);

        for (let line of lines) {
            if (getDemoState() === "aborted") break;
            if (line.startsWith("@pauseForInput")) {
                setDemoState(chatView, "paused");
                await getActionCompleteEvent(true);
                if (getDemoState() === "aborted") break;
                setDemoState(chatView, "running");
            } else if (line && !line.startsWith("#")) {
                var manualInput = awaitKeyboardInput && !line.startsWith("@");
                if (manualInput) setDemoState(chatView, "paused");
                await sendChatInputText(line, chatView);
                await getActionCompleteEvent(manualInput);
                if (manualInput && getDemoState() !== "aborted")
                    setDemoState(chatView, "running");
            }
        }
    } finally {
        // Defensive: drop any abort resolvers that escaped per-wait cleanup.
        abortListeners.clear();
        setDemoState(chatView, "idle");
    }
    return true;
}
