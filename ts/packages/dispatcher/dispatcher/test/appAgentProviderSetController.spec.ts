// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { createLimiter } from "@typeagent/common-utils";
import {
    AppAgentProvider,
    AppAgentProviderSetMutation,
} from "../src/agentProvider/agentProvider.js";
import {
    AppAgentProviderSetApplyFns,
    AppAgentProviderSetControllerImpl,
} from "../src/context/appAgentSetController.js";

function fakeProvider(name: string): AppAgentProvider {
    return {
        getAppAgentNames: () => [name],
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

function fakeMultiProvider(...names: string[]): AppAgentProvider {
    return {
        getAppAgentNames: () => names,
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function createController(apply?: Partial<AppAgentProviderSetApplyFns>) {
    return new AppAgentProviderSetControllerImpl(createLimiter(1), {
        applyAdd: async () => {},
        applyRemove: async () => {},
        ...apply,
    });
}

describe("AppAgentProviderSetController", () => {
    it("exposes add and remove only through runExclusive", async () => {
        const calls: string[] = [];
        const controller = createController({
            applyAdd: async (provider) => {
                calls.push(`add:${provider.getAppAgentNames()[0]}`);
            },
            applyRemove: async (provider) => {
                calls.push(`remove:${provider.getAppAgentNames()[0]}`);
            },
        });

        const result = await controller.runExclusive(async (mutation) => {
            await mutation.removeProvider(fakeProvider("old"));
            await mutation.addProvider(fakeProvider("new"));
            return "done";
        });

        expect(result).toEqual({ status: "completed", value: "done" });
        expect(calls).toEqual(["remove:old", "add:new"]);
    });

    it("holds the command lock across remove, wait, and add", async () => {
        const commandLock = createLimiter(1);
        const calls: string[] = [];
        const controller = new AppAgentProviderSetControllerImpl(commandLock, {
            applyAdd: async () => {
                calls.push("add");
            },
            applyRemove: async () => {
                calls.push("remove");
            },
        });
        const decision = deferred();
        const replacement = controller.runExclusive(async (mutation) => {
            await mutation.removeProvider(fakeProvider("foo"));
            calls.push("waiting");
            await decision.promise;
            await mutation.addProvider(fakeProvider("foo"));
        });
        const command = commandLock(async () => {
            calls.push("command");
        });

        await tick();
        expect(calls).toEqual(["remove", "waiting"]);
        decision.resolve();
        await Promise.all([replacement, command]);
        expect(calls).toEqual(["remove", "waiting", "add", "command"]);
    });

    it("rejects a captured mutation after its callback returns", async () => {
        const controller = createController();
        let captured!: AppAgentProviderSetMutation;
        await controller.runExclusive((mutation) => {
            captured = mutation;
        });

        await expect(
            captured.addProvider(fakeProvider("late")),
        ).rejects.toThrow(
            "The app-agent-provider-set mutation capability is no longer active.",
        );
    });

    it("waits for accepted unawaited actions before releasing the lock", async () => {
        const gate = deferred();
        const controller = createController({
            applyAdd: async () => {
                await gate.promise;
            },
        });
        let completed = false;
        const running = controller
            .runExclusive((mutation) => {
                void mutation.addProvider(fakeProvider("foo"));
            })
            .then(() => {
                completed = true;
            });

        await tick();
        expect(completed).toBe(false);
        gate.resolve();
        await running;
        expect(completed).toBe(true);
    });

    it("propagates an accepted unawaited action failure", async () => {
        const failure = new Error("add failed");
        const controller = createController({
            applyAdd: async () => {
                throw failure;
            },
        });

        await expect(
            controller.runExclusive((mutation) => {
                void mutation.addProvider(fakeProvider("foo"));
            }),
        ).rejects.toBe(failure);
    });

    it("rejects recursive exclusive entry", async () => {
        const controller = createController();
        await controller.runExclusive(async () => {
            await expect(
                controller.runExclusive(async () => {}),
            ).rejects.toThrow(
                "runExclusive cannot be called recursively for the same app-agent-provider-set controller.",
            );
        });
    });

    it("rejects providers that do not expose exactly one agent", async () => {
        const controller = createController();
        await expect(
            controller.runExclusive((mutation) =>
                mutation.addProvider(fakeMultiProvider("one", "two")),
            ),
        ).rejects.toThrow(/requires a single-agent provider/);
    });

    it("revokes the active mutation when closed", async () => {
        const controller = createController();
        const entered = deferred<AppAgentProviderSetMutation>();
        const resume = deferred();
        const running = controller.runExclusive(async (mutation) => {
            entered.resolve(mutation);
            await resume.promise;
            await mutation.addProvider(fakeProvider("late"));
        });
        const mutation = await entered.promise;

        controller.dispose();
        await expect(
            mutation.addProvider(fakeProvider("closed")),
        ).rejects.toThrow("The app-agent-provider-set controller is closed.");
        resume.resolve();
        await expect(running).rejects.toThrow(
            "The app-agent-provider-set controller is closed.",
        );
    });

    it("returns closed without running a queued callback after dispose", async () => {
        const commandLock = createLimiter(1);
        const controller = new AppAgentProviderSetControllerImpl(commandLock, {
            applyAdd: async () => {},
            applyRemove: async () => {},
        });
        const gate = deferred();
        const busy = commandLock(() => gate.promise);
        let called = false;
        const queued = controller.runExclusive(() => {
            called = true;
        });

        controller.dispose();
        expect(await queued).toEqual({ status: "closed" });
        expect(called).toBe(false);
        gate.resolve();
        await busy;
    });

    it("reports an add from the net mutation", async () => {
        const notifications: string[] = [];
        const provider = fakeProvider("foo");
        const controller = createController({
            notifyChange: (kind) => notifications.push(kind),
        });

        await controller.runExclusive((mutation) =>
            mutation.addProvider(provider, { notify: true }),
        );
        expect(notifications).toEqual(["add"]);
    });

    it("reports remove plus a different add as one update", async () => {
        const notifications: string[] = [];
        const oldProvider = fakeProvider("foo");
        const newProvider = fakeProvider("foo");
        const controller = createController({
            notifyChange: (kind) => notifications.push(kind),
        });

        await controller.runExclusive(async (mutation) => {
            await mutation.removeProvider(oldProvider, { notify: true });
            await mutation.addProvider(newProvider, { notify: true });
        });
        expect(notifications).toEqual(["update"]);
    });

    it("stays silent when rollback restores the same provider", async () => {
        const notifications: string[] = [];
        const provider = fakeProvider("foo");
        const controller = createController({
            notifyChange: (kind) => notifications.push(kind),
        });

        await controller.runExclusive(async (mutation) => {
            await mutation.removeProvider(provider, { notify: true });
            await mutation.addProvider(provider, { notify: true });
        });
        expect(notifications).toEqual([]);
    });

    it("stays silent when an add is canceled by remove in the same run", async () => {
        const notifications: string[] = [];
        const provider = fakeProvider("foo");
        const controller = createController({
            notifyChange: (kind) => notifications.push(kind),
        });

        await controller.runExclusive(async (mutation) => {
            await mutation.addProvider(provider, { notify: true });
            await mutation.removeProvider(provider, { notify: true });
        });
        expect(notifications).toEqual([]);
    });
});
