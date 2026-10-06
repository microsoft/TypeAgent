// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StoryBuilder } from "../src/storyBuilder.js";

test("story builder rejects until implemented", async () => {
    await expect(
        new StoryBuilder().build({
            commit: { projectPath: process.cwd(), diff: "", message: "" },
            sessions: [],
        }),
    ).rejects.toThrow("StoryBuilder.build is not implemented");
});
