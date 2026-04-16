// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IndexData, TokenStats } from "../src/indexingService.js";

describe("IndexData.tokenStats", () => {
    test("IndexData can be constructed without tokenStats", () => {
        const data: IndexData = {
            source: "image",
            name: "my-index",
            location: "/photos",
            size: 10,
            path: "/index/path",
            state: "finished",
            progress: 10,
            sizeOnDisk: 4096,
        };
        expect(data.tokenStats).toBeUndefined();
    });

    test("IndexData can include tokenStats", () => {
        const stats: TokenStats = {
            promptTokens: 200,
            completionTokens: 80,
            totalTokens: 280,
        };
        const data: IndexData = {
            source: "image",
            name: "my-index",
            location: "/photos",
            size: 10,
            path: "/index/path",
            state: "finished",
            progress: 10,
            sizeOnDisk: 4096,
            tokenStats: stats,
        };
        expect(data.tokenStats?.promptTokens).toBe(200);
        expect(data.tokenStats?.completionTokens).toBe(80);
        expect(data.tokenStats?.totalTokens).toBe(280);
    });

    test("tokenStats totalTokens equals prompt + completion", () => {
        const prompt = 150;
        const completion = 60;
        const stats: TokenStats = {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: prompt + completion,
        };
        expect(stats.totalTokens).toBe(
            stats.promptTokens + stats.completionTokens,
        );
    });

    test("IndexData state transitions are type-safe", () => {
        const states: IndexData["state"][] = [
            "new",
            "indexing",
            "finished",
            "stopped",
            "idle",
            "error",
        ];
        for (const state of states) {
            const data: IndexData = {
                source: "email",
                name: "email-index",
                location: "/emails",
                size: 0,
                path: "/idx",
                state,
                progress: 0,
                sizeOnDisk: 0,
            };
            expect(data.state).toBe(state);
        }
    });
});
