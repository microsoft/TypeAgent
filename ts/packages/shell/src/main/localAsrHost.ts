// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    app,
    dialog,
    utilityProcess,
    type UtilityProcess,
    type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
    LocalAsrCommand,
    LocalAsrEvent,
    LocalAsrWorkerEvent,
} from "../preload/localAsrTypes.js";

class LocalAsrHost {
    private worker?: UtilityProcess;
    private stoppingWorker?: UtilityProcess;
    private requestId = 0;
    private pending = new Map<
        number,
        { resolve: () => void; reject: (error: Error) => void }
    >();
    private owner?: { sender: WebContents; id: string; release: () => void };
    private progress?: (message: string, percent?: number) => void;

    private getWorker() {
        if (this.worker) return this.worker;
        const worker = utilityProcess.fork(
            fileURLToPath(new URL("./localAsrWorker.js", import.meta.url)),
            [],
            { serviceName: "TypeAgent local speech", stdio: "pipe" },
        );
        worker.stderr?.on("data", (data: Buffer) =>
            console.error(`[local-speech] ${data}`),
        );
        worker.on("message", (event: LocalAsrWorkerEvent) => {
            if (event.type === "reply") {
                const pending = this.pending.get(event.requestId);
                this.pending.delete(event.requestId);
                if (event.error) pending?.reject(new Error(event.error));
                else pending?.resolve();
            } else if (event.type === "progress") {
                this.progress?.(event.message, event.percent);
            } else if (
                this.owner?.id === event.sessionId &&
                !this.owner.sender.isDestroyed()
            ) {
                this.owner.sender.send("local-asr-event", event);
            }
        });
        worker.on("exit", (code) => {
            if (this.worker !== worker) return;
            const stopped = this.stoppingWorker === worker;
            this.worker = undefined;
            this.stoppingWorker = undefined;
            const error = new Error(
                stopped
                    ? "Local speech was stopped."
                    : `Local speech worker exited (code ${code}). Select Nemotron again to restart it.`,
            );
            for (const pending of this.pending.values()) pending.reject(error);
            this.pending.clear();
            const owner = this.owner;
            this.releaseOwner();
            if (owner && !owner.sender.isDestroyed()) {
                owner.sender.send("local-asr-event", {
                    type: "error",
                    sessionId: owner.id,
                    message: error.message,
                } satisfies LocalAsrEvent);
            }
            if (!stopped) console.error(error);
        });
        this.worker = worker;
        return worker;
    }

    private request(command: LocalAsrCommand) {
        const worker = this.getWorker();
        const requestId = ++this.requestId;
        return new Promise<void>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            try {
                worker.postMessage({ ...command, requestId });
            } catch (error) {
                this.pending.delete(requestId);
                reject(error);
            }
        });
    }

    async prepare(
        allowDownload: boolean,
        progress?: (message: string, percent?: number) => void,
    ) {
        this.progress = progress;
        try {
            await this.request({
                type: "prepare",
                cacheDir: path.join(app.getPath("userData"), "local-speech"),
                allowDownload,
            });
        } finally {
            this.progress = undefined;
        }
    }

    cancelSetup() {
        return this.request({ type: "cancelSetup" });
    }

    async start(sender: WebContents) {
        if (this.owner) throw new Error("Local speech is already recording.");
        await this.prepare(false);
        if (sender.isDestroyed())
            throw new Error("The speech window was closed.");
        if (this.owner) throw new Error("Local speech is already recording.");
        const id = randomUUID();
        const cancel = () => {
            void this.end(sender, id, true).catch((error) =>
                console.error("Failed to cancel local speech", error),
            );
        };
        sender.once("destroyed", cancel);
        sender.once("did-start-navigation", cancel);
        this.owner = {
            sender,
            id,
            release: () => {
                sender.removeListener("destroyed", cancel);
                sender.removeListener("did-start-navigation", cancel);
            },
        };
        try {
            await this.request({ type: "start", sessionId: id });
            return id;
        } catch (error) {
            this.releaseOwner();
            throw error;
        }
    }

    async append(sender: WebContents, id: string, pcm: Uint8Array) {
        this.checkOwner(sender, id);
        await this.request({ type: "append", sessionId: id, pcm });
    }

    async end(sender: WebContents, id: string, cancel: boolean) {
        this.checkOwner(sender, id);
        try {
            await this.request({
                type: cancel ? "cancel" : "finish",
                sessionId: id,
            });
        } finally {
            if (this.owner?.id === id) this.releaseOwner();
        }
    }

    private checkOwner(sender: WebContents, id: string) {
        if (this.owner?.sender !== sender || this.owner.id !== id) {
            throw new Error(
                "The speech session does not belong to this window.",
            );
        }
    }

    private releaseOwner() {
        this.owner?.release();
        this.owner = undefined;
    }

    isRecording() {
        return this.owner !== undefined;
    }

    async dispose() {
        const worker = this.worker;
        this.releaseOwner();
        if (worker) {
            this.stoppingWorker = worker;
            await new Promise<void>((resolve) => {
                worker.once("exit", () => resolve());
                worker.kill();
            });
        }
    }

    reportError(message: string) {
        console.error("[local-speech]", message);
        dialog.showErrorBox("Speech recognition", message);
    }
}

export const localAsrHost = new LocalAsrHost();
