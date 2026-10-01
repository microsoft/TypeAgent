// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    listFixture,
    normalizeLists,
    fileFixture,
} from "./ghcp-eval-corpus.mjs";
import { fileStateMatches } from "./ghcp-eval-files.mjs";

export const listCorpusVersion = "lists-v1";
export const listCandidates = [1, 2, 3, 4];
export const listPreparation =
    "Discover contracts for list inventory, reading, adding/removing items, creating and clearing lists, read-only GitHub issue details and reading files. Do not execute actions, inspect contents, establish preferred targets, or guess future requests.";

export function buildListCorpus(files, repo, issue) {
    return [
        ["S1", "Show my lists."],
        ["S2", "Show my grocery list."],
        ["S3", "Remove milk from my grocery list, preserving the other items."],
        ["S4", "Add apples to my grocery list."],
        ["S5", "Create a new empty list named book."],
        ["M1", "Show my grocery list and my pantry list, labeling each."],
        [
            "M2",
            "Add tea and coffee to my office list, then remove notebook. Preserve its other items.",
        ],
        ["M3", "Empty my grocery list, then add bread and oranges to it."],
        [
            "M4",
            "Create a new list named picnic, then add blanket and water to it.",
        ],
        [
            "M5",
            `Show issue ${issue} in ${repo}, then add "review issue ${issue}" to my errand list.`,
        ],
        ["R1", "Which items are on both my grocery list and my pantry list?"],
        [
            "R2",
            "Compare my packing and pantry lists. Which has more items, and by how many?",
        ],
        [
            "R3",
            "Add the items from my travel list that are missing from my packing list to packing. Preserve existing items and tell me what you added.",
        ],
        [
            "R4",
            `Read ${path.join(files, "trip.txt")}. If it says a jacket is required, add jacket to my packing list; otherwise leave the list unchanged. Tell me what you did.`,
        ],
        [
            "R5",
            `Read issue ${issue} in ${repo} and add its exact title to my errand list, but only if that title is not already there.`,
        ],
        ["A1", "Add apples to my list.", "The grocery list."],
        ["A2", "Show that list.", "The pantry list."],
        ["A3", "Remove charger from one of my lists.", "The travel list."],
        [
            "A4",
            "Remove the item from my grocery list.",
            "Remove milk, keeping the other items.",
        ],
        ["A5", "Empty my list, but keep the list itself.", "The office list."],
    ].map(([id, prompt, clarification]) => ({
        id: `list-${id}`,
        category: "lists",
        cohort: id[0],
        prompt,
        ...(clarification ? { clarification } : {}),
    }));
}

export function expectedLists(id, issue = 2617, title) {
    const lists = structuredClone(listFixture);
    const add = (name, items) => {
        lists[name] = [...new Set([...(lists[name] ?? []), ...items])];
    };
    if (["list-S4", "list-A1"].includes(id)) add("grocery", ["apples"]);
    if (["list-S3", "list-A4"].includes(id))
        lists.grocery = lists.grocery.filter((item) => item !== "milk");
    if (id === "list-S5") lists.book = [];
    if (id === "list-M2") lists.office = ["charger", "pen", "tea", "coffee"];
    if (id === "list-M3") lists.grocery = ["bread", "oranges"];
    if (id === "list-M4") lists.picnic = ["blanket", "water"];
    if (id === "list-M5") add("errand", [`review issue ${issue}`]);
    if (id === "list-R3") add("packing", ["adapter"]);
    if (id === "list-R4") add("packing", ["jacket"]);
    if (id === "list-R5") {
        if (!title)
            throw new Error(
                "List title oracle requires independent issue evidence",
            );
        add("errand", [title]);
    }
    if (id === "list-A3") lists.travel = ["adapter"];
    if (id === "list-A5") lists.office = [];
    return normalizeLists(
        Object.entries(lists).map(([name, items]) => ({ name, items })),
    );
}

export function readLists(store) {
    const stat = fs.lstatSync(store);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error("Unsafe evaluation list store");
    const lists = JSON.parse(fs.readFileSync(store, "utf8"));
    if (
        !Array.isArray(lists) ||
        lists.some(
            (entry) =>
                typeof entry.name !== "string" ||
                !Array.isArray(entry.items) ||
                entry.items.some((item) => typeof item !== "string"),
        ) ||
        new Set(lists.map((entry) => entry.name)).size !== lists.length
    )
        throw new Error("Invalid evaluation list snapshot");
    return normalizeLists(lists);
}

export function resetLists(store) {
    readLists(store);
    fs.writeFileSync(
        store,
        JSON.stringify(
            Object.entries(listFixture).map(([name, items]) => ({
                name,
                items,
            })),
        ),
    );
}

export function listsUnchanged(store) {
    return (
        JSON.stringify(readLists(store)) ===
        JSON.stringify(expectedLists("list-S1"))
    );
}

export function listFilePolicy(id) {
    return {
        version: 1,
        readFiles: id === "list-R4" ? ["trip.txt"] : [],
        writeFiles: [],
        readsEnabled: id === "list-R4",
        writesEnabled: false,
        allowInventory: false,
        prerequisites: {},
    };
}

export function listPolicy(id, store, clarified = false, title, issue = 2617) {
    const rule = (actionName, listName, items, before) => ({
        actionName,
        ...(listName ? { listName } : {}),
        ...(items ? { items } : {}),
        ...(before ? { before } : {}),
    });
    const reads = {
        S1: [],
        S2: ["grocery"],
        S3: ["grocery"],
        S4: ["grocery"],
        S5: ["book"],
        M1: ["grocery", "pantry"],
        M2: ["office"],
        M3: ["grocery"],
        M4: ["picnic"],
        M5: ["errand"],
        R1: ["grocery", "pantry"],
        R2: ["packing", "pantry"],
        R3: ["travel", "packing"],
        R4: ["packing"],
        R5: ["errand"],
        A1: ["grocery"],
        A2: ["pantry"],
        A3: ["travel"],
        A4: ["grocery"],
        A5: ["office"],
    };
    const key = id.replace(/^list-/, "");
    if (!id.startsWith("list-") || !Object.hasOwn(reads, key))
        throw new Error("Unknown list case");
    const rules = reads[key].map((name) => rule("getList", name));
    if (key === "S1") rules.push(rule("listLists"));
    if (["S4", "A1"].includes(key))
        rules.push(rule("addItems", "grocery", ["apples"]));
    if (["S3", "A4"].includes(key))
        rules.push(rule("removeItems", "grocery", ["milk"]));
    if (key === "S5")
        rules.push(rule("createList", "book", undefined, { book: null }));
    if (key === "M2")
        rules.push(
            rule("addItems", "office", ["tea", "coffee"]),
            rule("removeItems", "office", ["notebook"], {
                office: [...listFixture.office, "tea", "coffee"],
            }),
        );
    if (key === "M3")
        rules.push(
            rule("clearList", "grocery", undefined, {
                grocery: listFixture.grocery,
            }),
            ...[[], ["bread"], ["oranges"]].map((before) =>
                rule("addItems", "grocery", ["bread", "oranges"], {
                    grocery: before,
                }),
            ),
        );
    if (key === "M4")
        rules.push(
            rule("createList", "picnic", undefined, { picnic: null }),
            ...[[], ["blanket"], ["water"]].map((before) =>
                rule("addItems", "picnic", ["blanket", "water"], {
                    picnic: before,
                }),
            ),
        );
    if (key === "M5")
        rules.push(rule("addItems", "errand", [`review issue ${issue}`]));
    if (key === "R3") rules.push(rule("addItems", "packing", ["adapter"]));
    if (key === "R4") rules.push(rule("addItems", "packing", ["jacket"]));
    if (key === "R5") {
        if (!title)
            throw new Error("List policy requires independent issue title");
        rules.push(rule("addItems", "errand", [title]));
    }
    if (key === "A3") rules.push(rule("removeItems", "travel", ["charger"]));
    if (key === "A5") rules.push(rule("clearList", "office"));
    return {
        version: 1,
        category: "lists",
        store,
        enabled: !key.startsWith("A") || clarified,
        rules,
        externalReads: ["M5", "R5"].includes(key)
            ? [
                  {
                      schemaName: "github-cli",
                      actionName: "issueView",
                      repo: "microsoft/TypeAgent",
                      number: issue,
                  },
              ]
            : [],
    };
}

export function listClarificationQuestion(id, question) {
    if (/\b(confirm|approve|proceed|allow)\b/i.test(question)) return false;
    const subject = id === "list-A4" ? /\b(item|entry)\b/i : /\blist\b/i;
    return (
        subject.test(question) &&
        /\b(which|what|choose|specify|mean)\b/i.test(question)
    );
}

export function gradeListTrial(result, store, files, title) {
    const lists = readLists(store);
    return {
        listStateMatchesOracle:
            JSON.stringify(lists) ===
            JSON.stringify(expectedLists(result.caseId, 2617, title)),
        fileStateMatchesOracle: fileStateMatches(files, fileFixture),
        noPrematureListMutation:
            result.noPrematureListMutation === true &&
            (!result.caseId.startsWith("list-A") ||
                JSON.stringify(result.listsAtClarification) ===
                    JSON.stringify(expectedLists("list-S1"))),
    };
}
