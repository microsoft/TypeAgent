// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Limiter } from "@typeagent/common-utils";
import {
    AppAgentProvider,
    AppAgentProviderSetController,
    AppAgentProviderSetMutation,
    AppAgentProviderSetRunResult,
} from "../agentProvider/agentProvider.js";
import { AsyncLocalStorage } from "node:async_hooks";

type PendingExclusiveRun = {
    settled: boolean;
    running: boolean;
    close: () => void;
};

type AppliedMutation = {
    kind: "add" | "remove";
    provider: AppAgentProvider;
    notify: boolean;
};

const exclusiveControllerContext =
    new AsyncLocalStorage<AppAgentProviderSetController>();

/** Dispatcher-local leaf operations used by the scoped controller. */
export type AppAgentProviderSetApplyFns = {
    applyAdd: (
        provider: AppAgentProvider,
        recordAsKnown: boolean,
    ) => Promise<void>;
    applyRemove: (
        provider: AppAgentProvider,
        dropConfig: boolean,
    ) => Promise<void>;
    notifyChange?: (
        kind: "add" | "remove" | "update",
        oldProvider: AppAgentProvider | undefined,
        newProvider: AppAgentProvider | undefined,
    ) => void;
};

/**
 * Controls one dispatcher's live app-agent provider set. Every mutation runs under the
 * dispatcher command lock and is available only through the callback-scoped
 * capability passed to `runExclusive`.
 */
export class AppAgentProviderSetControllerImpl
    implements AppAgentProviderSetController
{
    private closed = false;
    private readonly pending = new Set<PendingExclusiveRun>();
    private activeMutation: { revoke: () => void } | undefined;

    public constructor(
        private readonly commandLock: Limiter,
        private readonly apply: AppAgentProviderSetApplyFns,
    ) {}

    public runExclusive<T>(
        callback: (mutation: AppAgentProviderSetMutation) => Promise<T> | T,
    ): Promise<AppAgentProviderSetRunResult<T>> {
        if (exclusiveControllerContext.getStore() === this) {
            return Promise.reject(
                new Error(
                    "runExclusive cannot be called recursively for the same app-agent-provider-set controller.",
                ),
            );
        }
        if (this.closed) {
            return Promise.resolve({ status: "closed" });
        }

        return new Promise<AppAgentProviderSetRunResult<T>>(
            (resolve, reject) => {
                let close = () => resolve({ status: "closed" });
                const run: PendingExclusiveRun = {
                    settled: false,
                    running: false,
                    close: () => close(),
                };
                this.pending.add(run);

                void this.commandLock(async () => {
                    if (run.settled) {
                        return;
                    }
                    if (this.closed) {
                        this.settle(run, () => resolve({ status: "closed" }));
                        return;
                    }
                    run.running = true;

                    let active = true;
                    let tail = Promise.resolve();
                    const accepted: Promise<void>[] = [];
                    const applied: AppliedMutation[] = [];
                    const revoke = () => {
                        active = false;
                    };
                    this.activeMutation = { revoke };

                    const accept = (
                        action: () => Promise<void>,
                    ): Promise<void> => {
                        if (!active) {
                            return Promise.reject(
                                new Error(
                                    this.closed
                                        ? "The app-agent-provider-set controller is closed."
                                        : "The app-agent-provider-set mutation capability is no longer active. Use it only inside its runExclusive callback.",
                                ),
                            );
                        }
                        const acceptedAction = tail.then(action);
                        tail = acceptedAction.catch(() => {});
                        accepted.push(acceptedAction);
                        return acceptedAction;
                    };

                    const mutation: AppAgentProviderSetMutation = {
                        addProvider: (provider, options) =>
                            accept(async () => {
                                this.assertSingleAgent(provider, "addProvider");
                                await this.apply.applyAdd(
                                    provider,
                                    options?.recordAsKnown ?? true,
                                );
                                applied.push({
                                    kind: "add",
                                    provider,
                                    notify: options?.notify ?? false,
                                });
                            }),
                        removeProvider: (provider, options) =>
                            accept(async () => {
                                this.assertSingleAgent(
                                    provider,
                                    "removeProvider",
                                );
                                await this.apply.applyRemove(
                                    provider,
                                    options?.dropConfig ?? true,
                                );
                                applied.push({
                                    kind: "remove",
                                    provider,
                                    notify: options?.notify ?? false,
                                });
                            }),
                    };

                    try {
                        const value = await exclusiveControllerContext.run(
                            this,
                            () => callback(mutation),
                        );
                        revoke();
                        await Promise.all(accepted);
                        if (!this.closed) {
                            this.notifyNetChanges(applied);
                        }
                        this.settle(run, () =>
                            resolve({ status: "completed", value }),
                        );
                    } catch (error) {
                        revoke();
                        await Promise.allSettled(accepted);
                        this.settle(run, () => reject(error));
                    } finally {
                        if (this.activeMutation?.revoke === revoke) {
                            this.activeMutation = undefined;
                        }
                    }
                }).catch((error) => {
                    this.settle(run, () => reject(error));
                });

                close = () =>
                    this.settle(run, () => resolve({ status: "closed" }));
            },
        );
    }

    public get isClosed(): boolean {
        return this.closed;
    }

    public dispose(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.activeMutation?.revoke();
        for (const run of [...this.pending]) {
            if (!run.running) {
                run.close();
            }
        }
    }

    private assertSingleAgent(
        provider: AppAgentProvider,
        operation: "addProvider" | "removeProvider",
    ): void {
        const names = provider.getAppAgentNames();
        if (names.length !== 1) {
            throw new Error(
                `AppAgentProviderSetMutation.${operation} requires a single-agent provider; got ${names.length} name(s): [${names.join(", ")}]`,
            );
        }
    }

    private notifyNetChanges(applied: AppliedMutation[]): void {
        if (this.apply.notifyChange === undefined) {
            return;
        }
        const changes = new Map<
            string,
            {
                oldProvider: AppAgentProvider | undefined;
                newProvider: AppAgentProvider | undefined;
                notify: boolean;
            }
        >();
        for (const mutation of applied) {
            const name = mutation.provider.getAppAgentNames()[0];
            let change = changes.get(name);
            if (change === undefined) {
                change = {
                    oldProvider: undefined,
                    newProvider: undefined,
                    notify: false,
                };
                changes.set(name, change);
            }
            change.notify ||= mutation.notify;
            if (mutation.kind === "remove") {
                change.oldProvider ??= mutation.provider;
                if (change.newProvider === mutation.provider) {
                    change.newProvider = undefined;
                }
            } else {
                change.newProvider = mutation.provider;
            }
        }

        for (const change of changes.values()) {
            if (!change.notify || change.oldProvider === change.newProvider) {
                continue;
            }
            const kind =
                change.oldProvider === undefined
                    ? "add"
                    : change.newProvider === undefined
                      ? "remove"
                      : "update";
            this.apply.notifyChange(
                kind,
                change.oldProvider,
                change.newProvider,
            );
        }
    }

    private settle(run: PendingExclusiveRun, complete: () => void): void {
        if (run.settled) {
            return;
        }
        run.settled = true;
        this.pending.delete(run);
        complete();
    }
}
