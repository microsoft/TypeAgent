// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";

export const listFixture = {
    grocery: ["milk", "eggs", "rice"],
    pantry: ["rice", "beans"],
    packing: ["passport", "charger", "socks"],
    travel: ["charger", "adapter"],
    office: ["notebook", "pen", "charger"],
    errand: ["pharmacy", "post office"],
    weekend: [],
};
export const fileFixture = {
    "report-a.txt": "passport\ncharger\nsocks\n",
    "report-b.txt": "charger\nadapter\n",
    "trip.txt": "destination: mountain\njacket: required\n",
};

export function buildCorpus(files, repo, prA, prB, issueA) {
    const file = (name) => path.join(files, name);
    return [
        { id: "S1", prompt: "Show my lists." },
        { id: "S2", prompt: `Read ${file("report-a.txt")}.` },
        {
            id: "S3",
            prompt: `Show the files changed by pull request ${prA} in ${repo}.`,
        },
        { id: "S4", prompt: "Add apples to my grocery list." },
        { id: "S5", prompt: "Show my full network configuration." },
        {
            id: "M1",
            prompt: `Read ${file("report-a.txt")} and ${file("report-b.txt")}.`,
        },
        {
            id: "M2",
            prompt: "Show my full network configuration and the contents of my DNS resolver cache.",
        },
        {
            id: "M3",
            prompt: "Empty my grocery list, then add bread and oranges to it.",
        },
        {
            id: "M4",
            prompt: `Show the changed files and check results for pull request ${prA} in ${repo}.`,
        },
        {
            id: "M5",
            prompt: `Show issue ${issueA} in ${repo}, then add "review issue ${issueA}" to my errand list.`,
        },
        {
            id: "R1",
            prompt: "Which items are on both my grocery list and my pantry list?",
        },
        {
            id: "R2",
            prompt: `Compare ${file("report-a.txt")} and ${file("report-b.txt")}. Which contains more nonempty lines, and by how many?`,
        },
        {
            id: "R3",
            prompt: `Compare pull requests ${prA} and ${prB} in ${repo}. Which needs attention first based on check failures, using the number of changed files as the tie-breaker?`,
        },
        {
            id: "R4",
            prompt: `Read ${file("trip.txt")}. If it says a jacket is required, add jacket to my packing list; otherwise leave the list unchanged. Tell me what you did.`,
        },
        {
            id: "R5",
            prompt: `Read issue ${issueA} in ${repo} and add its exact title to my errand list, but only if that title is not already there.`,
        },
        {
            id: "A1",
            prompt: "Add apples to my list.",
            clarification: "The grocery list.",
        },
        {
            id: "A2",
            prompt: `Read the report in ${files}.`,
            clarification: "report-b.txt.",
        },
        {
            id: "A3",
            prompt: `Show the files changed by that pull request in ${repo}.`,
            clarification: `Pull request ${prA}.`,
        },
        {
            id: "A4",
            prompt: "Clean up my grocery list.",
            clarification: "Remove all items but keep the list itself.",
        },
        {
            id: "A5",
            prompt: `Read that file in ${files}.`,
            clarification: "trip.txt.",
        },
    ];
}

export function expectedLists(id, issueA, issueTitle) {
    const state = structuredClone(listFixture);
    if (id === "S4" || id === "A1") state.grocery.push("apples");
    if (id === "M3") state.grocery = ["bread", "oranges"];
    if (id === "M5") state.errand.push(`review issue ${issueA}`);
    if (id === "R4") state.packing.push("jacket");
    if (id === "R5") {
        if (!issueTitle) return undefined;
        state.errand.push(issueTitle);
    }
    if (id === "A4") state.grocery = [];
    return state;
}

export function normalizeLists(lists) {
    return Object.fromEntries(
        lists
            .map(({ name, items }) => [name, [...items].sort()])
            .sort(([a], [b]) => a.localeCompare(b)),
    );
}

export function balancedOrder(cases, candidateIds, repetitions) {
    if (!Number.isInteger(repetitions) || repetitions < 1) {
        throw new Error("Repetitions must be a positive integer");
    }

    const result = [];
    for (let repetition = 0; repetition < repetitions; repetition++) {
        for (let i = 0; i < cases.length; i++) {
            for (let j = 0; j < candidateIds.length; j++) {
                result.push({
                    caseId: cases[i].id,
                    candidate:
                        candidateIds[
                            (i + j + repetition) % candidateIds.length
                        ],
                    repetition,
                });
            }
        }
    }
    return result;
}

export function fixtureConfirmationAllowed(
    id,
    action,
    files,
    issueTitle,
    issueNumber = 2617,
) {
    if (!action || typeof action.parameters !== "object") return false;
    const { schemaName, actionName, parameters } = action;
    const fileCases = {
        S2: ["report-a.txt"],
        M1: ["report-a.txt", "report-b.txt"],
        R2: ["report-a.txt", "report-b.txt"],
        R4: ["trip.txt"],
        A2: ["report-b.txt"],
        A5: ["trip.txt"],
    };
    if (
        schemaName === "powershell.powershell-files" &&
        actionName === "readFile"
    ) {
        return (
            fileCases[id]?.some(
                (name) =>
                    path.resolve(files, name).toLowerCase() ===
                    path.resolve(parameters.path ?? "").toLowerCase(),
            ) ?? false
        );
    }

    if (schemaName !== "list") return false;
    if (actionName === "startEditList") {
        const target = {
            S4: "grocery",
            M3: "grocery",
            M5: "errand",
            R4: "packing",
            R5: "errand",
            A1: "grocery",
            A4: "grocery",
        }[id];
        return target !== undefined && parameters.listName === target;
    }
    if (actionName === "clearList") {
        return ["M3", "A4"].includes(id) && parameters.listName === "grocery";
    }
    if (actionName !== "addItems") return false;
    const additions = {
        S4: ["grocery", ["apples"]],
        A1: ["grocery", ["apples"]],
        M3: ["grocery", ["bread", "oranges"]],
        M5: ["errand", [`review issue ${issueNumber}`]],
        R4: ["packing", ["jacket"]],
        R5: ["errand", issueTitle ? [issueTitle] : []],
    };
    const expected = additions[id];
    return (
        expected !== undefined &&
        expected[1].length > 0 &&
        parameters.listName === expected[0] &&
        JSON.stringify(parameters.items?.slice().sort()) ===
            JSON.stringify(expected[1].slice().sort())
    );
}

export function isClarificationQuestion(id, question) {
    if (/\b(confirm|approve|proceed|allow)\b/i.test(question)) return false;
    const subject = {
        A1: /\blist\b/i,
        A2: /\b(report|file)\b/i,
        A3: /\b(pull request|PR|number)\b/i,
        A4: /\b(clean|remove|empty|change|list)\b/i,
        A5: /\bfile\b/i,
    }[id];
    return Boolean(
        subject?.test(question) &&
            /\b(which|what|how|choose|specify|mean)\b/i.test(question),
    );
}

export async function sendWithClarification({
    session,
    prompt,
    timeoutMs,
    testCase,
    canClarify,
    clarify,
}) {
    const start = performance.now();
    const first = await session.sendAndWait({ prompt }, timeoutMs);
    const text = first?.data.content ?? "";
    if (
        canClarify() &&
        testCase.clarification &&
        isClarificationQuestion(testCase.id, text)
    ) {
        const remaining = timeoutMs - (performance.now() - start);
        if (remaining <= 0)
            throw new Error("Clarification exhausted trial timeout");
        const answer = clarify(text, "final_text");
        return session.sendAndWait({ prompt: answer }, remaining);
    }
    return first;
}

export function shuffled(values, seed) {
    const result = [...values];
    let state = seed >>> 0;
    for (let i = result.length - 1; i > 0; i--) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const j = (state >>> 0) % (i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
