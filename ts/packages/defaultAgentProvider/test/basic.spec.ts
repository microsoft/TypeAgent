// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { createDispatcherTestFixture } from "./dispatcherTestFixture.js";

// Use 3001 as the base for test port
process.env["PORT"] = "3001";
describe("AppAgentProvider", () => {
    describe("Built-in Provider", () => {
        let closeDispatcher: (() => Promise<void>) | undefined;
        afterEach(async () => {
            await closeDispatcher?.();
        });
        it("startup and shutdown", async () => {
            const fixture = createDispatcherTestFixture(async () => {
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

                return createDispatcher("test", {
                    appAgentProviders: providers,
                    agents: enabledAgentNames,
                });
            });
            closeDispatcher = fixture.close;
            await fixture.dispatcher;
        }, 120000); // Startup is slower on small CI machines.
    });
});
