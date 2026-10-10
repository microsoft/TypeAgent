// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import type { ViewFactInventory, ViewBuildSnapshot } from "../src/viewTypes.js";

export function wikiTestAnswer(
    name: string,
    value: unknown,
    prose = "Definitions and scope remain conditional; competing explanations are unresolved.\n\n",
): unknown {
    if (name !== "memory_wiki_construction")
        return inventoryTestAnswer(name, value);
    const raw = value as {
        inventory: ViewFactInventory;
        input?: ViewBuildSnapshot;
    };
    const ids = raw.inventory.items.map((item) => item.id);
    return {
        content: {
            title: "Payments operations knowledge",
            summary:
                "Competing explanations and unresolved capacity questions.",
            pages: raw.input?.maintenance?.subjects.length
                ? raw.input.maintenance.subjects.map((subject) => ({
                      id: subject.pageId,
                      title: subject.title,
                      taxonomy: subject.taxonomy,
                      prose,
                      inventoryIds: ids,
                  }))
                : [
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
        relationships: raw.input?.maintenance?.subjects.length
            ? []
            : [
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
