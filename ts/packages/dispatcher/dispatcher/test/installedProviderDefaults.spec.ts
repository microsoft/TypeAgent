// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { persistProviderDisabledDefaults } from "../src/context/installedProviderDefaults.js";

describe("persistProviderDisabledDefaults", () => {
    it("disables newly installed provider surfaces without overwriting explicit preferences", () => {
        const updates: unknown[] = [];
        const context = {
            session: {
                getSettings: () => ({
                    schemas: { photo: null, "photo.edit": true },
                    actions: {},
                    commands: {},
                }),
                updateSettings: (settings: unknown) => updates.push(settings),
            },
            agents: {
                getActionConfigs: () => [
                    { schemaName: "photo" },
                    { schemaName: "photo.edit" },
                    { schemaName: "calendar" },
                ],
            },
        } as unknown as CommandHandlerContext;
        const provider = {
            getAppAgentNames: () => ["photo"],
        } as AppAgentProvider;

        persistProviderDisabledDefaults(context, provider);

        expect(updates).toEqual([
            {
                schemas: { photo: false },
                actions: { photo: false, "photo.edit": false },
                commands: { photo: false },
            },
        ]);
    });
});
