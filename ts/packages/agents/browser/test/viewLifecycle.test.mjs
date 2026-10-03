// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { viewMethods } from "@typeagent/browser-control-rpc/viewRpc";
import {
    cancelViewServiceStart,
    createViewServiceHost,
    ensureBrowserViewHost,
} from "../dist/agent/viewService.mjs";
import { importProgressEvents } from "../dist/agent/import/importProgressEvents.mjs";

function createContext(folder) {
    const registrations = [];
    return {
        agentContext: { localHostPort: 0 },
        sessionStorage: {
            exists: async () => true,
            list: async () => [path.join(folder, "settings.json")],
        },
        registerPort: (role, port) => {
            const registration = {
                role,
                port,
                released: false,
                release() {
                    this.released = true;
                },
            };
            registrations.push(registration);
            return registration;
        },
        registrations,
    };
}

test(
    "view host readiness shares startup and cleans up after restart",
    { timeout: 20_000 },
    async (t) => {
        const folder = await mkdtemp(
            path.join(tmpdir(), "typeagent-view-lifecycle-"),
        );
        const context = createContext(folder);
        const domain = Object.fromEntries(
            viewMethods.map((method) => [method, async () => null]),
        );
        domain.memoryListCorpora = async () => [
            { corpusId: "test", name: "Lifecycle corpus" },
        ];
        t.after(async () => {
            const child = context.agentContext.viewProcess;
            if (child && child.exitCode === null) {
                const exited = once(child, "exit");
                child.kill();
                await exited;
            }
            await rm(folder, { recursive: true });
        });
        const listenersBefore =
            importProgressEvents.listenerCount("importProgress");
        const [host, sameHost] = await Promise.all([
            ensureBrowserViewHost(context, domain),
            ensureBrowserViewHost(context, domain),
        ]);
        assert.equal(host, sameHost);
        assert.match(host, /^http:\/\/localhost:[1-9]\d*$/);
        assert.equal(context.registrations.length, 1);
        assert.equal(context.registrations[0].role, "view");
        assert.equal(
            importProgressEvents.listenerCount("importProgress"),
            listenersBefore + 1,
        );
        const response = await fetch(`${host}/api/views/invoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "memoryListCorpora", params: {} }),
        });
        assert.deepEqual(await response.json(), {
            success: true,
            data: [{ corpusId: "test", name: "Lifecycle corpus" }],
        });
        const firstChild = context.agentContext.viewProcess;
        const exited = once(firstChild, "exit");
        firstChild.kill();
        await exited;
        assert.equal(context.agentContext.localHostPort, 0);
        assert.equal(context.agentContext.viewProcess, undefined);
        assert.equal(context.registrations[0].released, true);
        assert.equal(
            importProgressEvents.listenerCount("importProgress"),
            listenersBefore,
        );
        await ensureBrowserViewHost(context, domain);
        assert.notEqual(context.agentContext.viewProcess, firstChild);
        assert.equal(context.registrations.length, 2);
    },
);

test("disabling during storage lookup cancels a pending fork", async () => {
    let continueLookup;
    const context = createContext(tmpdir());
    context.sessionStorage.list = () =>
        new Promise((resolve) => {
            continueLookup = resolve;
        });
    const started = createViewServiceHost(context, {});
    await Promise.resolve();
    cancelViewServiceStart(context.agentContext);
    continueLookup([path.join(tmpdir(), "settings.json")]);
    assert.equal(await started, undefined);
    assert.equal(context.agentContext.viewProcess, undefined);
    assert.equal(context.registrations.length, 0);
});
