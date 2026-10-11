// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { createInventoryConstructionSchema } from "../src/viewSynthesisSchemas.js";
import { evidenceRecord, evidenceArray } from "../src/viewSynthesisEvidence.js";
import type { ViewFactInventory } from "../src/viewTypes.js";
import { projectFieldStates } from "../src/projectBrief.js";

test("legacy project construction references checked fact kinds and couples known as-of basis", () => {
    const inventory: ViewFactInventory = {
        schemaVersion: 1,
        sourceFingerprint: "source",
        fingerprint: "inventory",
        sourceDecisions: [],
        items: (["owner", "decision", "risk", "milestone"] as const).map(
            (kind, i) => ({
                id: `fact-${i}`,
                key: `key-${i}`,
                kind,
                status: "unknown",
                statement: "Unknown recorded state.",
                measurements: [],
                occurredAt: "",
                learnedAt: "",
                citations: [
                    {
                        sourceId: "s",
                        revisionId: "r",
                        locator: "chars:0-23",
                        excerpt: "Unknown recorded state.",
                    },
                ],
            }),
        ),
    };
    const result = createInventoryConstructionSchema(
        inventory.items.map((item) => item.id),
        "projectBrief",
        [],
        undefined,
        inventory,
    );
    const properties = evidenceRecord(evidenceRecord(result.schema).properties);
    const content = evidenceRecord(
        evidenceRecord(properties.content).properties,
    );
    const sections = evidenceRecord(evidenceRecord(content.sections).items);
    const details = evidenceRecord(evidenceRecord(sections.properties).details);
    const variants = evidenceArray(details.anyOf, 7).map((variant) =>
        evidenceRecord(evidenceRecord(variant).properties),
    );
    const decisions = evidenceRecord(evidenceRecord(variants[4].items).items);
    expect(
        evidenceRecord(evidenceRecord(decisions.properties).inventoryId).enum,
    ).toEqual(["fact-1"]);
    const ownerItems = evidenceRecord(
        evidenceRecord(variants[1].assignments).items,
    );
    const owners = evidenceRecord(evidenceArray(ownerItems.anyOf, 2)[0]);
    expect(
        evidenceRecord(evidenceRecord(owners.properties).inventoryId).enum,
    ).toEqual(["fact-0"]);
    const unknownOwner = evidenceRecord(owners.properties);
    expect(unknownOwner.owner).toEqual({ type: "null" });
    expect(variants[6].asOf).toEqual({ type: "null" });
    expect(evidenceRecord(variants[6].basis).enum).toEqual(["unknown"]);
    inventory.items[0].statement =
        "`documentation owner` has no recorded identity.";
    inventory.items[0].citations[0].excerpt =
        "The documentation owner was asked to preserve the limitation.";
    expect(() =>
        createInventoryConstructionSchema(
            inventory.items.map((item) => item.id),
            "projectBrief",
            [],
            undefined,
            inventory,
        ),
    ).not.toThrow();
    inventory.items[0].statement = "The accountable role is <service-owner>.";
    inventory.items[0].citations[0].excerpt =
        "The accountable role is <service-owner>.";
    expect(
        JSON.stringify(
            createInventoryConstructionSchema(
                inventory.items.map((item) => item.id),
                "projectBrief",
                [],
                undefined,
                inventory,
            ),
        ),
    ).toContain("<service-owner>");
    inventory.items[0].status = "confirmed";
    inventory.items[0].statement = "Mira Vale owns the capacity review.";
    inventory.items[0].citations[0].excerpt = inventory.items[0].statement;
    const known = createInventoryConstructionSchema(
        inventory.items.map((item) => item.id),
        "projectBrief",
        [],
        undefined,
        inventory,
    );
    const knownContent = evidenceRecord(
        evidenceRecord(evidenceRecord(known.schema).properties).content,
    );
    const knownSections = evidenceRecord(
        evidenceRecord(evidenceRecord(knownContent.properties).sections).items,
    );
    const knownDetails = evidenceRecord(
        evidenceRecord(knownSections.properties).details,
    );
    const knownOwners = evidenceRecord(
        evidenceRecord(evidenceArray(knownDetails.anyOf, 7)[1]).properties,
    );
    const assignments = evidenceRecord(
        evidenceRecord(knownOwners.assignments).items,
    );
    const assignment = evidenceRecord(
        evidenceRecord(evidenceArray(assignments.anyOf, 2)[0]).properties,
    );
    expect(evidenceRecord(assignment.state).enum).toEqual(["known"]);
    expect(evidenceRecord(assignment.owner).enum).toContain("Mira Vale");
    expect(evidenceRecord(assignment.owner).type).toEqual("string");
    const statusFact = {
        ...inventory.items[0],
        kind: "projectStatus" as const,
        statement: "Project active; incident closed is not project completion.",
        citations: [
            {
                ...inventory.items[0].citations[0],
                excerpt:
                    "Project active; incident closed is not project completion.",
            },
        ],
    };
    expect(
        projectFieldStates([statusFact], "projectStatus", [
            "unknown",
            "active",
            "complete",
        ]),
    ).toEqual(["active"]);
    expect(
        projectFieldStates(
            [
                {
                    ...statusFact,
                    statement: "The charter records project status as active.",
                },
            ],
            "projectStatus",
            ["unknown", "active", "complete"],
        ),
    ).toEqual(["active"]);
    expect(
        projectFieldStates(
            [
                {
                    ...statusFact,
                    statement: "Project completion is not established.",
                },
            ],
            "projectStatus",
            ["active", "complete"],
        ),
    ).toEqual([]);
    expect(
        projectFieldStates(
            [{ ...statusFact, kind: "capacity", status: "blocked" }],
            "capacity",
            ["unknown", "pendingOwnerReview", "validated"],
        ),
    ).toEqual(["pendingOwnerReview"]);
});
