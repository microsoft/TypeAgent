// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import type { ViewFactInventory } from "../src/viewTypes.js";

export function wikiTestAnswer(
    name: string,
    value: unknown,
    prose = "Definitions and scope remain conditional; competing explanations are unresolved.\n\n",
): unknown {
    if (name !== "memory_wiki_construction")
        return inventoryTestAnswer(name, value);
    const raw = value as { inventory: ViewFactInventory };
    const ids = raw.inventory.items.map((item) => item.id);
    return {
        content: {
            title: "Payments operations knowledge",
            summary:
                "Competing explanations and unresolved capacity questions.",
            pages: [
                {
                    id: "pool-pressure",
                    title: "Pool pressure",
                    taxonomy: "concept",
                    prose,
                    inventoryIds: ids,
                },
                {
                    id: "payments-system",
                    title: "Payments system",
                    taxonomy: "system",
                    prose,
                    inventoryIds: ids,
                },
                {
                    id: "capacity-project",
                    title: "Capacity project",
                    taxonomy: "project",
                    prose,
                    inventoryIds: ids,
                },
            ],
        },
        relationships: [
            {
                from: "payments-system",
                to: "pool-pressure",
                predicate: "relatedTo",
            },
            {
                from: "pool-pressure",
                to: "capacity-project",
                predicate: "contradicts",
            },
        ],
        outcome: "knowledgePages",
        missingEvidence: [
            "Competing explanations remain unresolved; no universal target or owner approval.",
        ],
    };
}
