// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateDocumentation,
    type DocumentationChatModel,
} from "../src/generateDocumentation.js";
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
    actions: [],
    envVars: [],
    readmeContext: { exists: false, raw: "", handAuthored: "", wordCount: 0 },
    existingBlock: null,
};

function makeModel(
    responses: Array<
        { success: true; data: string } | { success: false; message: string }
    >,
): { model: DocumentationChatModel; calls: () => number } {
    let i = 0;
    const tracker = { calls: 0 };
    const model: DocumentationChatModel = {
        complete: async () => {
            tracker.calls++;
            const r = responses[i] ?? responses[responses.length - 1]!;
            i++;
            return r;
        },
    };
    return { model, calls: () => tracker.calls };
}

const goodBody = [
    "## Overview",
    "",
    "Lorem ipsum ".repeat(180).trim() + ".",
    "",
    "## Architecture",
    "",
    "Dolor sit amet ".repeat(120).trim() + ".",
].join("\n");

const tooShortBody = "## Overview\n\nTiny note.";

describe("generateDocumentation", () => {
    it("returns ok on the first attempt for a clean response", async () => {
        const { model } = makeModel([{ success: true, data: goodBody }]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok");
        expect(result.attempts).toBe(1);
        expect(result.isPlaceholder).toBe(false);
        expect(result.body).toContain("## Overview");
        expect(result.body).toContain("Lorem ipsum");
    });

    it("flags ok-with-warnings when target-band rules emit a warning", async () => {
        const { model } = makeModel([{ success: true, data: tooShortBody }]);
        const result = await generateDocumentation(
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
            {
                success: true,
                data: "## Overview\n\nThis package is powerful. " + goodBody,
            },
            { success: true, data: goodBody },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.attempts).toBe(2);
        expect(result.status).toBe("ok");
        expect(result.isPlaceholder).toBe(false);
    });

    it("falls back to placeholder when validation never passes", async () => {
        const bad = "## Overview\n\npowerful seamless robust. " + goodBody;
        const { model } = makeModel([
            { success: true, data: bad },
            { success: true, data: bad },
            { success: true, data: bad },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("validation-failed");
        expect(result.isPlaceholder).toBe(true);
        expect(result.body).toContain("Placeholder documentation");
        expect(result.attempts).toBe(3);
    });

    it("falls back to placeholder on a model error after exhausting retries", async () => {
        const { model, calls } = makeModel([
            { success: false, message: "rate limited" },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("model-error");
        expect(result.isPlaceholder).toBe(true);
        expect(result.attempts).toBe(3);
        // Each attempt that returned an error should be reported.
        expect(calls()).toBe(3);
        expect(result.diagnostics.join(" ")).toMatch(/rate limited/u);
    });

    it("recovers from a transient model error on a retry", async () => {
        const { model, calls } = makeModel([
            { success: false, message: "5xx blip" },
            { success: true, data: goodBody },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok");
        expect(result.attempts).toBe(2);
        expect(result.isPlaceholder).toBe(false);
        expect(calls()).toBe(2);
    });

    it("reports validation-failed (not model-error) when the last attempt completed but failed validation", async () => {
        const bad = "## Overview\n\npowerful seamless robust. " + goodBody;
        const { model } = makeModel([
            { success: false, message: "transient" },
            { success: true, data: bad },
            { success: true, data: bad },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        // Last attempt was a validation failure, not a model error,
        // so the final verdict is validation-failed (more useful for
        // an operator deciding whether to retry vs revise prompts).
        expect(result.status).toBe("validation-failed");
        expect(result.attempts).toBe(3);
    });

    it("strips a leading H1 the model included", async () => {
        const { model } = makeModel([
            { success: true, data: "# example\n\n" + goodBody },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok");
        expect(result.body.startsWith("# example")).toBe(false);
        expect(result.body.startsWith("## Overview")).toBe(true);
    });

    it("strips a leading '## Documentation' title-shaped heading", async () => {
        const { model } = makeModel([
            { success: true, data: "## Documentation\n\n" + goodBody },
        ]);
        const result = await generateDocumentation(
            baseInputs,
            "## Reference",
            model,
        );
        expect(result.status).toBe("ok");
        expect(result.body.startsWith("## Documentation")).toBe(false);
        expect(result.body.startsWith("## Overview")).toBe(true);
    });
});
