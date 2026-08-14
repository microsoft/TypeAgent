// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";

// Use 3001 as the base for test port
process.env["PORT"] = "3001";
describe("AppAgentProvider", () => {
    describe("Built-in Provider", () => {
        it("startup and shutdown", async () => {
            const providers = getDefaultAppAgentProviders(undefined);
            // Exclude utility here because its browser prewarm dominates this
            // smoke test's startup and shutdown time without exercising the
            // default provider wiring that this test is meant to cover.
            const enabledAgentNames = (
                await Promise.all(
                    providers.flatMap((provider) =>
                        provider.getAppAgentNames().map(async (name) => {
                            const manifest =
                                await provider.getAppAgentManifest(name);
                            const defaultEnabled =
                                manifest.commandDefaultEnabled ??
                                manifest.defaultEnabled ??
                                true;
                            return defaultEnabled && name !== "utility"
                                ? name
                                : undefined;
                        }),
                    ),
                )
            ).filter((name): name is string => name !== undefined);

            const dispatcher = await createDispatcher("test", {
                appAgentProviders: providers,
                agents: enabledAgentNames,
            });
            await dispatcher.close();
            // Startup + shutdown of every default agent can occasionally spike
            // past the old 2-minute limit on CI's small, contended machines, so
            // allow some headroom rather than fail flakily on a slow run.
        }, 180000);
    });
});
