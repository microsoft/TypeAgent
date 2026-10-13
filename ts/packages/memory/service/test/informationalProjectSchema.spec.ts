// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { projectSummarySchema } from "../src/informationalProject.js";
import { createInventoryConstructionSchema } from "../src/viewSynthesisSchemas.js";
import { evidenceRecord } from "../src/viewSynthesisEvidence.js";
import { parseProjectBriefDetails } from "../src/projectBrief.js";

test("project summary schema has indexed citations and typed states without inventory contracts", () => {
    const schema = evidenceRecord(projectSummarySchema(["f0"]).schema);
    const properties = evidenceRecord(schema.properties);
    expect(Object.keys(properties)).toEqual([
        "title",
        "goalsScope",
        "owners",
        "status",
        "milestones",
        "decisions",
        "risks",
        "context",
        "limits",
        "citationIds",
        "projectState",
        "incidentState",
        "capacityState",
    ]);
    expect(
        evidenceRecord(evidenceRecord(properties.citationIds).items).enum,
    ).toEqual(["f0"]);
    expect(JSON.stringify(schema)).not.toMatch(
        /inventory|witness|sourceDecisions/,
    );
    expect(() =>
        createInventoryConstructionSchema(["fact"], "projectBrief"),
    ).toThrow("Project construction requires informational-project-summary-v1");
});

test("project content rejects inventory witnesses and retains editable typed ownership", () => {
    expect(() =>
        parseProjectBriefDetails({ kind: "goalsScope", inventoryIds: ["old"] }),
    ).toThrow("Unsupported project brief detail field");
    expect(
        parseProjectBriefDetails({
            kind: "owners",
            assignments: [
                {
                    id: "owner",
                    responsibility: "Capacity review",
                    state: "unknown",
                    owner: null,
                },
            ],
        }),
    ).toEqual({
        kind: "owners",
        assignments: [
            {
                id: "owner",
                responsibility: "Capacity review",
                state: "unknown",
                owner: null,
            },
        ],
    });
});
