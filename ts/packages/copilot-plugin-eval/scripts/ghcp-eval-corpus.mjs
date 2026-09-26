// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";

export const protocolVersion = 5;
export const corpusVersion = "common-files-v1";

export function buildTrialSchedule(cases, candidateIds, repetitions) {
    const order = balancedOrder(cases, candidateIds, repetitions).map(
        (entry) => ({
            ...entry,
            applicable: true,
        }),
    );
    return {
        order,
        totalSlots: order.length,
        scheduledTrials: order.filter(({ applicable }) => applicable).length,
        applicableCounts: Object.fromEntries(
            candidateIds.map((candidate) => [
                candidate,
                order.filter(
                    (entry) =>
                        entry.candidate === candidate && entry.applicable,
                ).length,
            ]),
        ),
    };
}

export function assertFrozenSpecification(previous, next) {
    if (previous !== undefined && previous !== next)
        throw new Error(
            "Frozen run specification changed; start a distinct run",
        );
}

export function assertCorpusReadiness(readiness) {
    if (
        readiness?.corpusVersion !== corpusVersion ||
        readiness.status !== "passed" ||
        !["listFiles", "readFile", "writeFile", "copyFile"].every((name) =>
            readiness.externalEvidence?.some(
                (entry) =>
                    entry.actionName === name &&
                    entry.outcome?.status === "completed",
            ),
        )
    )
        throw new Error(
            "Fresh common-files-v1 preflight with verified file inventory/read/write/copy is required",
        );
}

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
    "grocery.txt": "milk\neggs\nrice\n",
    "pantry.txt": "rice\nbeans\n",
    "packing.txt": "passport\ncharger\nsocks\n",
    "errands.txt": "pharmacy\npost office\n",
};

export function buildCorpus(files, repo, prA, prB, issueA) {
    const file = (name) => path.join(files, name);
    return [
        { id: "S1", prompt: `Show the files in ${files}.` },
        { id: "S2", prompt: `Read ${file("report-a.txt")}.` },
        {
            id: "S3",
            prompt: `Show the files changed by pull request ${prA} in ${repo}.`,
        },
        {
            id: "S4",
            prompt: `Append apples as a new line to ${file("grocery.txt")}, preserving the existing lines.`,
        },
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
            prompt: `Copy ${file("grocery.txt")} to ${file("grocery-backup.txt")}, then replace the contents of ${file("grocery.txt")} with bread and oranges, one per line.`,
        },
        {
            id: "M4",
            prompt: `Show the changed files and check results for pull request ${prA} in ${repo}.`,
        },
        {
            id: "M5",
            prompt: `Show issue ${issueA} in ${repo}, then append "review issue ${issueA}" as a new line to ${file("errands.txt")}, preserving the existing lines.`,
        },
        {
            id: "R1",
            prompt: `Which entries occur in both ${file("grocery.txt")} and ${file("pantry.txt")}?`,
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
            prompt: `Read ${file("trip.txt")}. If it says a jacket is required, append jacket as a new line to ${file("packing.txt")}; otherwise leave the file unchanged. Preserve existing entries and tell me what you did.`,
        },
        {
            id: "R5",
            prompt: `Read issue ${issueA} in ${repo} and append its exact title as a new line to ${file("errands.txt")}, but only if that title is not already there. Preserve existing entries.`,
        },
        {
            id: "A1",
            prompt: `Add apples as a new line to one of these shopping files: ${file("grocery.txt")} or ${file("pantry.txt")}. Preserve the existing lines.`,
            clarification: "grocery.txt.",
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
            prompt: `Remove an item from ${file("grocery.txt")}, preserving the other entries.`,
            clarification: "Remove eggs.",
        },
        {
            id: "A5",
            prompt: `Read that file in ${files}.`,
            clarification: "trip.txt.",
        },
    ];
}

export function expectedFiles(id, issueA, issueTitle, initial = fileFixture) {
    const state = { ...initial };
    const append = (name, line) => {
        state[name] = `${state[name].replace(/\r?\n*$/, "")}\n${line}\n`;
    };
    if (id === "S4" || id === "A1") append("grocery.txt", "apples");
    if (id === "M3") {
        state["grocery-backup.txt"] = initial["grocery.txt"];
        state["grocery.txt"] = "bread\noranges\n";
    }
    if (id === "M5") append("errands.txt", `review issue ${issueA}`);
    if (id === "R4" && /^jacket:\s*required\s*$/m.test(initial["trip.txt"]))
        append("packing.txt", "jacket");
    if (id === "R5") {
        if (!issueTitle) return undefined;
        if (!initial["errands.txt"].split(/\r?\n/).includes(issueTitle))
            append("errands.txt", issueTitle);
    }
    if (id === "A4")
        state["grocery.txt"] = initial["grocery.txt"]
            .split(/\r?\n/)
            .filter((line) => line !== "eggs")
            .join("\n");
    return state;
}

export function writableFiles(id) {
    return (
        {
            S4: ["grocery.txt"],
            M3: ["grocery-backup.txt", "grocery.txt"],
            M5: ["errands.txt"],
            R4: ["packing.txt"],
            R5: ["errands.txt"],
            A1: ["grocery.txt"],
            A4: ["grocery.txt"],
        }[id] ?? []
    );
}

export function filePolicy(id, clarified = false) {
    return {
        version: 1,
        readFiles: [
            ...Object.keys(fileFixture),
            ...(id === "M3" ? ["grocery-backup.txt"] : []),
        ],
        writeFiles: writableFiles(id),
        allowInventory: id === "S1",
        allowCopy:
            id === "M3"
                ? { source: "grocery.txt", destination: "grocery-backup.txt" }
                : undefined,
        writesEnabled: !["A1", "A4"].includes(id) || clarified,
        readsEnabled: !["A2", "A5"].includes(id) || clarified,
        prerequisites:
            id === "M3"
                ? {
                      "grocery.txt": {
                          "grocery-backup.txt": fileFixture["grocery.txt"],
                      },
                  }
                : {},
    };
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
    if (!action?.parameters || typeof action.parameters !== "object")
        return false;
    const { schemaName, actionName, parameters } = action;
    const fileCases = {
        S2: ["report-a.txt"],
        M1: ["report-a.txt", "report-b.txt"],
        R1: ["grocery.txt", "pantry.txt"],
        R2: ["report-a.txt", "report-b.txt"],
        R4: ["trip.txt", "packing.txt"],
        R5: ["errands.txt"],
        S4: ["grocery.txt"],
        M3: ["grocery.txt", "grocery-backup.txt"],
        M5: ["errands.txt"],
        A1: ["grocery.txt"],
        A4: ["grocery.txt"],
        A2: ["report-b.txt"],
        A5: ["trip.txt"],
    };
    const samePath = (actual, name) =>
        typeof actual === "string" &&
        path.relative(
            path.resolve(files, name),
            path.resolve(files, actual),
        ) === "";
    if (schemaName !== "powershell.powershell-files") return false;
    if (
        schemaName === "powershell.powershell-files" &&
        actionName === "readFile"
    ) {
        return (
            fileCases[id]?.some((name) => samePath(parameters.path, name)) ??
            false
        );
    }

    if (actionName === "listFiles")
        return (
            id === "S1" && samePath(parameters.path, ".") && !parameters.recurse
        );
    if (actionName === "copyFile")
        return (
            id === "M3" &&
            !parameters.recurse &&
            samePath(parameters.source, "grocery.txt") &&
            samePath(parameters.destination, "grocery-backup.txt")
        );
    if (actionName !== "writeFile" || typeof parameters.content !== "string")
        return false;
    const expected = expectedFiles(id, issueNumber, issueTitle);
    const target = writableFiles(id).find((name) =>
        samePath(parameters.path, name),
    );
    if (!target || !expected) return false;
    const append = parameters.append === true;
    const content = append
        ? `${fileFixture[target]}${parameters.content}`
        : parameters.content;
    return logicalFileContent(content) === logicalFileContent(expected[target]);
}

export function logicalFileContent(content) {
    return content
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\n+$/, "");
}

export function fileHandlerConfirmation(prompt, action) {
    if (
        action?.schemaName !== "powershell.powershell-files" ||
        prompt?.type !== "question" ||
        JSON.stringify(prompt.choices) !== JSON.stringify(["Run", "Cancel"]) ||
        (prompt.defaultId !== undefined && prompt.defaultId !== 1)
    )
        return undefined;
    const message = {
        copyFile: "Copy the requested file or directory?",
        writeFile: "Write content to the requested file?",
    }[action.actionName];
    return message && prompt.message === message
        ? { type: "question", selected: 0 }
        : undefined;
}

export function pendingFileAction(events) {
    const pending = [];
    for (const { event, detail } of events) {
        if (event === "action.admitted") pending.push(detail);
        else if (event === "action.completed") {
            if (
                pending.length !== 1 ||
                pending[0].schemaName !== detail?.schemaName ||
                pending[0].actionName !== detail?.actionName
            )
                return undefined;
            pending.pop();
        } else if (event === "action.denied" || event === "action.failed")
            return undefined;
    }
    return pending.length === 1 &&
        pending[0]?.schemaName === "powershell.powershell-files"
        ? pending[0]
        : undefined;
}

export function consumeFixtureContinuation(approvals, args, stopped) {
    const approval = approvals.get(args?.interactionId);
    approvals.delete(args?.interactionId);
    return (
        !stopped &&
        approval !== undefined &&
        approval.operationId === args.operationId &&
        approval.scopeId === args.scopeId &&
        JSON.stringify(approval.response) === JSON.stringify(args.response)
    );
}

export function isClarificationQuestion(id, question) {
    if (/\b(confirm|approve|proceed|allow)\b/i.test(question)) return false;
    const subject = {
        A1: /\b(file|shopping)\b/i,
        A2: /\b(report|file)\b/i,
        A3: /\b(pull request|PR|number)\b/i,
        A4: /\b(item|entry|line)\b/i,
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
