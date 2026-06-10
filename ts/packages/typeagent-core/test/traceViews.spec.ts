// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InProcessEventStream } from "../src/events/index.js";
import {
    buildWorkflowViewModel,
    loadReasoningTrace,
} from "../src/replay/index.js";

describe("reasoning trace read models", () => {
    it("loads reasoning steps correlated by requestId", async () => {
        const stream = new InProcessEventStream();

        stream.emit({
            schemaVersion: 1,
            type: "reasoning.step",
            ts: 3,
            requestId: "r2",
            sandboxId: "s",
            stepName: "ignored",
        });
        stream.emit({
            schemaVersion: 1,
            type: "reasoning.step",
            ts: 2,
            requestId: "r1",
            sandboxId: "s",
            stepName: "b",
        });
        stream.emit({
            schemaVersion: 1,
            type: "reasoning.step",
            ts: 1,
            requestId: "r1",
            sandboxId: "s",
            stepName: "a",
            payload: {
                workflow: {
                    stepId: "n1",
                    title: "Start",
                },
            },
        });

        const rows = await loadReasoningTrace(stream, "r1");
        expect(rows.map((r) => r.stepName)).toEqual(["a", "b"]);
    });

    it("builds graph from explicit workflow metadata", () => {
        const model = buildWorkflowViewModel([
            {
                ts: 1,
                sandboxId: "s",
                stepName: "a",
                payload: { workflow: { stepId: "n1", title: "Start" } },
            },
            {
                ts: 2,
                sandboxId: "s",
                stepName: "b",
                payload: {
                    workflow: {
                        stepId: "n2",
                        parentStepId: "n1",
                        title: "Translate",
                    },
                },
            },
        ]);

        expect(model.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
        expect(model.edges).toEqual([{ from: "n1", to: "n2" }]);
    });

    it("falls back to linear chain when workflow metadata is absent", () => {
        const model = buildWorkflowViewModel([
            { ts: 1, sandboxId: "s", stepName: "a" },
            { ts: 2, sandboxId: "s", stepName: "b" },
            { ts: 3, sandboxId: "s", stepName: "c" },
        ]);

        expect(model.nodes.map((n) => n.id)).toEqual([
            "step-1",
            "step-2",
            "step-3",
        ]);
        expect(model.edges).toEqual([
            { from: "step-1", to: "step-2" },
            { from: "step-2", to: "step-3" },
        ]);
    });
});
