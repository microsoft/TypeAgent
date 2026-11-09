// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StoryAggregator } from "../src/storyAggregator.js";

test("story aggregator rejects until implemented", async () => {
    await expect(
        new StoryAggregator().aggregate({
            projectPath: process.cwd(),
            revision: "HEAD",
        }),
    ).rejects.toThrow("StoryAggregator.aggregate is not implemented");
});
