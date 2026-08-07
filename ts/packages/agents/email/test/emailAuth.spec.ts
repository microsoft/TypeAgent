// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const { runEmailLogin } = await import(
    pathToFileURL(path.join(packageRoot, "dist", "emailActionHandler.js")).href
);

describe("email auth actions", () => {
    it("refreshes readiness after setup login completes", async () => {
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    emailProvider: {
                        login: async () => true,
                        getUser: async () => ({
                            displayName: "Ada",
                            email: "ada@example.com",
                        }),
                    },
                    providerType: "microsoft",
                    kpIndex: { loaded: false },
                    indexingInProgress: true,
                },
                notifyReadinessChanged: async () => {
                    readinessCalls++;
                },
            },
            actionIO: {
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any;

        await runEmailLogin(context);

        assert.equal(readinessCalls, 1);
        assert.match(JSON.stringify(displays), /typeagent-user-signed-in/);
        assert.match(JSON.stringify(displays), /ada@example\.com/);
    });
});
