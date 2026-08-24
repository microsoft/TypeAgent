// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    AppAgentProviderSetController,
    AppAgentProviderSetRunResult,
} from "agent-dispatcher";
import { createDefaultAgentRuntime } from "../src/defaultAgentRuntime.js";
import type { PackageAgentContext } from "../src/installSources/packageAgent.js";

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-default-runtime-"));
}

describe("createDefaultAgentRuntime", () => {
    it("binds the package agent to the same MCP API used by the MCP source", async () => {
        const runtime = createDefaultAgentRuntime(tmpInstanceDir());
        const controller: AppAgentProviderSetController = {
            async runExclusive<T>(
                cb: (mutation: never) => Promise<T> | T,
            ): Promise<AppAgentProviderSetRunResult<T>> {
                return {
                    status: "completed",
                    value: await cb(undefined as never),
                };
            },
        };

        const installedConnection =
            runtime.appAgentSources[0].connect(controller);
        const providers = await installedConnection.providers;
        const packageProvider = providers.find((provider) =>
            provider.getAppAgentNames().includes("package"),
        );
        expect(packageProvider).toBeDefined();

        const packageAgent = await packageProvider!.loadAppAgent!("package");
        const initialize =
            packageAgent.initializeAgentContext as () => Promise<PackageAgentContext>;
        const context = await initialize();
        expect(context.mcpSource).toBe(runtime.mcpServerSourceApi);
        installedConnection.dispose();
    });
});
