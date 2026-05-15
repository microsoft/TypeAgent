// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateOverview,
    type OverviewChatModel,
} from "../src/generateOverview.js";
import type { PackageInputs } from "../src/packageInputs.js";
import type { WorkspacePackage } from "../src/workspaceGraph.js";

const pkg: WorkspacePackage = {
    name: "@x/example",
    relDir: "packages/example",
    dir: "/tmp/x",
    isPrivate: true,
    packageJson: { name: "@x/example", description: "An example package." },
};

const baseInputs: PackageInputs = {
    pkg,
    description: "An example package.",
    workspaceDeps: [],
    externalDeps: [],
    reverseDeps: [],
    sourceFiles: [],
    totalSourceLines: 0,
    entryPoints: [],
    agentSurface: {
        manifestPath: null,
        schemaPath: null,
        grammarPath: null,
        handlerPath: null,
    },
    isAgentPackage: false,
    existingBlock: null,
};

function makeModel(
    responses: Array<
        { success: true; data: string } | { success: false; message: string }
    >,
): { model: OverviewChatModel; calls: number } {
    let i = 0;
    const tracker = { calls: 0 };
    const model: OverviewChatModel = {
        complete: async () => {
            tracker.calls++;
            const r = responses[i] ?? responses[responses.length - 1]!;
            i++;
            return r;
        },
    };
    return { model, calls: tracker.calls };
}

const goodBody = "word ".repeat(280).trim() + ".";
const tooShortBody = "Tiny note.";

describe("generateOverview", () => {
    it("returns ok on the first attempt for a clean response", async () => {
        const { model } = makeModel([{ success: true, data: goodBody }]);
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok");
        expect(result.attempts).toBe(1);
        expect(result.isPlaceholder).toBe(false);
        expect(result.body).toContain("word");
    });

    it("flags ok-with-warnings when target-band rules emit a warning", async () => {
        const { model } = makeModel([{ success: true, data: tooShortBody }]);
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok-with-warnings");
        expect(result.attempts).toBe(1);
        expect(result.isPlaceholder).toBe(false);
    });

    it("retries once on validation failure and accepts the second attempt", async () => {
        const { model } = makeModel([
            { success: true, data: "This package is powerful. " + goodBody },
            { success: true, data: goodBody },
        ]);
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.attempts).toBe(2);
        expect(result.status).toBe("ok");
        expect(result.isPlaceholder).toBe(false);
    });

    it("falls back to placeholder when validation never passes", async () => {
        const bad = "powerful seamless robust. " + goodBody;
        const { model } = makeModel([
            { success: true, data: bad },
            { success: true, data: bad },
        ]);
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("validation-failed");
        expect(result.isPlaceholder).toBe(true);
        expect(result.body).toContain("Pending LLM-authored Overview");
        expect(result.attempts).toBe(2);
    });

    it("falls back to placeholder on a model error", async () => {
        const { model } = makeModel([
            { success: false, message: "rate limited" },
        ]);
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("model-error");
        expect(result.isPlaceholder).toBe(true);
        expect(result.diagnostics.join(" ")).toMatch(/rate limited/u);
    });

    it("strips a leading '## Overview' heading the model included", async () => {
        const { model } = makeModel([
            { success: true, data: "## Overview\n\n" + goodBody },
            { success: true, data: "## Overview\n\n" + goodBody }, // for retry
        ]);
        // First attempt has a heading (rejected); second still has one.
        // After 2 attempts → validation-failed. We want to verify the
        // body that's rejected was post-strip; assert via diagnostics.
        const result = await generateOverview(
            baseInputs,
            "## Reference",
            model,
        );
        // After stripping, the heading is gone but the prose is fine,
        // so this should actually pass on attempt 1.
        expect(result.status).toBe("ok");
        expect(result.body.startsWith("## Overview")).toBe(false);
    });
});
