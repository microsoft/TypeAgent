// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { SessionContext } from "@typeagent/agent-sdk";
import type {
    ViewInvokeFunctions,
    ViewCallFunctions,
    ViewCancelResult,
    MemoryHubFunctions,
    MemoryHubRunbookFunctions,
    MemoryHubRunbookImportFunctions,
} from "@typeagent/browser-control-rpc/viewRpc";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import type { BrowserAgentInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import type { BrowserActionContext } from "./browserActions.mjs";
import {
    importProgressEvents,
    type ImportProgressEvent,
} from "./import/importProgressEvents.mjs";
import {
    knowledgeProgressEvents,
    type KnowledgeExtractionProgressEvent,
} from "./knowledge/progress/knowledgeProgressEvents.mjs";
import { ImportStateManager } from "./import/importStateManager.mjs";
import { getSessionFolderPath } from "./browserSessionStorage.mjs";

const pendingViewHosts = new WeakMap<
    BrowserActionContext,
    Promise<ChildProcess | undefined>
>();
const cancelViewHosts = new WeakMap<BrowserActionContext, () => void>();

export type BrowserViewDomainFunctions = BrowserAgentInvokeFunctions &
    MemoryHubFunctions &
    MemoryHubRunbookFunctions & {
        [M in keyof MemoryHubRunbookImportFunctions]: MemoryHubRunbookImportFunctions[M];
    } & Pick<
        ViewInvokeFunctions,
        | "getAutoIndexSetting"
        | "listAutomations"
        | "getAutomation"
        | "validateAutomation"
        | "approveAutomation"
        | "disableAutomation"
        | "deleteAutomation"
    >;

export function startViewService(
    context: SessionContext<BrowserActionContext>,
    start: (isCancelled: () => boolean) => Promise<ChildProcess | undefined>,
): Promise<ChildProcess | undefined> {
    const agentContext = context.agentContext;
    const pending = pendingViewHosts.get(agentContext);
    if (pending) {
        return pending;
    }
    if (agentContext.viewProcess?.connected && agentContext.localHostPort > 0) {
        return Promise.resolve(agentContext.viewProcess);
    }
    let cancelled = false;
    cancelViewHosts.set(agentContext, () => {
        cancelled = true;
        pendingViewHosts.delete(agentContext);
    });
    const promise = start(() => cancelled).finally(() => {
        if (pendingViewHosts.get(agentContext) === promise) {
            pendingViewHosts.delete(agentContext);
            cancelViewHosts.delete(agentContext);
        }
    });
    pendingViewHosts.set(agentContext, promise);
    return promise;
}

export function cancelViewServiceStart(
    agentContext: BrowserActionContext,
): void {
    cancelViewHosts.get(agentContext)?.();
    cancelViewHosts.delete(agentContext);
}

export function createViewServiceHost(
    context: SessionContext<BrowserActionContext>,
    domain: BrowserViewDomainFunctions,
): Promise<ChildProcess | undefined> {
    return startViewService(context, async (isCancelled) => {
        const sessionDir = await getSessionFolderPath(context);
        if (isCancelled()) return undefined;
        if (!sessionDir) {
            throw new Error("Session storage is unavailable for browser views");
        }
        const folderPath = path.join(sessionDir, "files");
        fs.mkdirSync(folderPath, { recursive: true });
        const child = fork(
            fileURLToPath(
                new URL("../views/server/server.mjs", import.meta.url),
            ),
            [String(context.agentContext.localHostPort)],
            { env: { ...process.env, TYPEAGENT_BROWSER_FILES: folderPath } },
        );
        context.agentContext.viewProcess = child;
        child.once("exit", () => {
            if (context.agentContext.viewProcess === child) {
                context.agentContext.viewPortRegistration?.release();
                context.agentContext.viewPortRegistration = undefined;
                context.agentContext.viewProcess = undefined;
                context.agentContext.localHostPort = 0;
            }
        });
        return new Promise<ChildProcess | undefined>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                child.off("message", onMessage);
                child.off("error", onError);
                child.off("exit", onExit);
            };
            const fail = (error: Error) => {
                cleanup();
                child.kill();
                reject(error);
            };
            const onError = (error: Error) => fail(error);
            const onExit = () => {
                cleanup();
                resolve(undefined);
            };
            const onMessage = (message: unknown) => {
                if (message === "Failure") {
                    fail(new Error("Browser view server failed to start"));
                    return;
                }
                if (
                    typeof message !== "object" ||
                    message === null ||
                    !("type" in message) ||
                    message.type !== "Success"
                ) {
                    return;
                }
                if (
                    isCancelled() ||
                    context.agentContext.viewProcess !== child
                ) {
                    cleanup();
                    child.kill();
                    resolve(undefined);
                    return;
                }
                if (
                    !("port" in message) ||
                    typeof message.port !== "number" ||
                    !Number.isInteger(message.port) ||
                    message.port <= 0 ||
                    message.port > 65535
                ) {
                    fail(
                        new Error(
                            "Browser view server reported an invalid port",
                        ),
                    );
                    return;
                }
                try {
                    context.agentContext.viewPortRegistration?.release();
                    context.agentContext.viewPortRegistration =
                        context.registerPort("view", message.port);
                    context.agentContext.localHostPort = message.port;
                    cleanup();
                    resolve(child);
                } catch (error) {
                    fail(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    );
                }
            };
            const timeout = setTimeout(
                () =>
                    fail(new Error("Browser views service creation timed out")),
                10_000,
            );
            child.on("message", onMessage);
            child.once("error", onError);
            child.once("exit", onExit);
            try {
                connectViewService(child, domain);
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}

export async function ensureBrowserViewHost(
    context: SessionContext<BrowserActionContext>,
    domain: BrowserViewDomainFunctions,
): Promise<string> {
    const child = await createViewServiceHost(context, domain);
    const port = context.agentContext.localHostPort;
    if (
        !child?.connected ||
        child !== context.agentContext.viewProcess ||
        !Number.isInteger(port) ||
        port <= 0 ||
        port > 65535
    ) {
        throw new Error("Browser view host is unavailable");
    }
    return `http://localhost:${port}`;
}

export function connectViewService(
    child: ChildProcess,
    domain: BrowserViewDomainFunctions,
) {
    const latestProgress = new Map<string, ImportProgressEvent>();
    const unsupportedCancellation = async (): Promise<ViewCancelResult> => ({
        success: false,
        cancelled: false,
        error: "This import pipeline does not support cancellation. Work continues until completion.",
    });
    const handlers: ViewInvokeFunctions = {
        ...domain,
        getFileImportProgress: async ({ importId }) => {
            const state = await ImportStateManager.loadImportState(importId);
            return {
                importId,
                progress: latestProgress.get(importId),
                ...(state ? { state } : {}),
            };
        },
        cancelImport: unsupportedCancellation,
        cancelFileImport: unsupportedCancellation,
    };
    const exposedHandlers = Object.fromEntries(
        viewMethods.map((method) => [method, handlers[method]]),
    ) as ViewInvokeFunctions;
    const rpc = createRpc<{}, ViewCallFunctions, ViewInvokeFunctions>(
        "browser-view-parent",
        child,
        exposedHandlers,
    );
    const onImportProgress = (progress: ImportProgressEvent) => {
        latestProgress.set(progress.importId, progress);
        if (latestProgress.size > 100) {
            latestProgress.delete(latestProgress.keys().next().value!);
        }
        if (child.connected) {
            rpc.send("viewEvent", {
                type: "importProgress",
                data: progress,
                timestamp: new Date(progress.timestamp).toISOString(),
            });
        }
    };
    const onKnowledgeProgress = (
        progress: KnowledgeExtractionProgressEvent,
    ) => {
        if (child.connected) {
            rpc.send("viewEvent", {
                type: "knowledgeExtractionProgress",
                data: progress,
                timestamp: new Date(progress.timestamp).toISOString(),
            });
        }
    };
    importProgressEvents.onProgress(onImportProgress);
    knowledgeProgressEvents.onProgress(onKnowledgeProgress);
    const dispose = () => {
        importProgressEvents.off("importProgress", onImportProgress);
        knowledgeProgressEvents.off(
            "knowledgeExtractionProgress",
            onKnowledgeProgress,
        );
        latestProgress.clear();
    };
    child.once("disconnect", dispose);
    child.once("exit", dispose);
    return dispose;
}
