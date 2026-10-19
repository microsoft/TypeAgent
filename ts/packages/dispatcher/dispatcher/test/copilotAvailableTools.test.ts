// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";

// Jest's ESM VM lacks import.meta.resolve; use the SDK's CommonJS entry so its
// bundled CLI resolver can use Node's native module resolution.
const { CopilotClient }: typeof import("@github/copilot-sdk") = createRequire(
    import.meta.url,
)("@github/copilot-sdk");

describe("installed Copilot runtime tool contract", () => {
    const client = new CopilotClient();
    beforeAll(async () => {
        await client.start();
    }, 60_000);

    test("lists native read and search tools for Luna", async () => {
        const { tools } = await client.rpc.tools.list({ model: "gpt-6-luna" });
        expect(tools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining(["view", "glob", "grep"]),
        );
    }, 60_000);

    afterAll(async () => {
        expect(await client.stop()).toEqual([]);
    });
});
