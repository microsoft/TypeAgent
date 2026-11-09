// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const abcdPin = {
    repository: "https://github.com/asappresearch/abcd",
    commit: "6b8700ce67c6b37b062dd7a60abc76d7ef832a97",
    license: "MIT",
    files: [
        {
            file: "guidelines.json",
            upstream: "data/guidelines.json",
            sha256: "9264557941df24fe075138a632a2345172971573124a354ccb2ceee2a12e4c2a",
        },
        {
            file: "ontology.json",
            upstream: "data/ontology.json",
            sha256: "2e1c1d763518ba084ada7f7bc8b54f0b489c81da3b170875cf9340891e06524c",
        },
        {
            file: "abcd_v1.1.json.gz",
            upstream: "data/abcd_v1.1.json.gz",
            sha256: "2bdf53ac359543dcdc38d55bc6513e78df120363f8f44870716e909f4606de15",
        },
        {
            file: "LICENSE",
            upstream: "LICENSE",
            sha256: "3ab7e179a7f13027b7bc64293541f0e9beacca3701cade67fb8fce78c2d9317b",
        },
    ],
};
export type AbcdFlow = {
    id: string;
    subflow: string;
    title: string;
    category: string;
};
export const developmentFlows: readonly AbcdFlow[] = [
    {
        id: "slow-speed",
        subflow: "slow_speed",
        title: "Website Too Slow",
        category: "Troubleshoot Site",
    },
    {
        id: "shopping-cart",
        subflow: "shopping_cart",
        title: "Cart Not Updating",
        category: "Troubleshoot Site",
    },
];
export const exampleFlows: readonly AbcdFlow[] = [
    ...developmentFlows,
    {
        id: "search-not-working",
        subflow: "search_not_working",
        title: "Search Not Working",
        category: "Troubleshoot Site",
    },
    {
        id: "initiate-refund",
        subflow: "initiate_refund",
        title: "Initiate Refund",
        category: "Product Defect",
    },
    {
        id: "missing-item",
        subflow: "missing_item",
        title: "Missing Item",
        category: "Shipping Issue",
    },
];

export function selectExampleSources(
    sourceId: string | undefined,
    sourceIds: string[] | undefined,
    buildOnly: boolean | undefined,
): string[] | undefined {
    if (sourceId !== undefined && sourceIds !== undefined)
        throw new Error("Choose --source or --sources, not both");
    const selected =
        sourceIds ?? (sourceId === undefined ? undefined : [sourceId]);
    if (selected === undefined) return undefined;
    const known = ["mock-connectivity", ...exampleFlows.map(({ id }) => id)];
    if (
        !buildOnly ||
        !selected.length ||
        selected.length > known.length ||
        new Set(selected).size !== selected.length ||
        selected.some((id) => !known.includes(id))
    )
        throw new Error(
            "Selected sources require buildOnly and distinct known procedural fixture IDs",
        );
    return [...selected];
}
const actionAliases: Record<string, string> = {
    "Notify Internal Team": "notify-team",
    "Log Out/In": "log-out-in",
    "Try Again": "try-again",
    Instructions: "instructions",
    "Make Purchase": "make-purchase",
    "Enter Details": "enter-details",
    "Pull up Account": "pull-up-account",
    "Validate Purchase": "validate-purchase",
    "Record Reason": "record-reason",
    "Offer Refund": "offer-refund",
    "Update Order": "update-order",
};

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Invalid ABCD ${label}`);
    return value as Record<string, unknown>;
}
function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim())
        throw new Error("Invalid ABCD source string");
    return value;
}
function strings(value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
    )
        throw new Error("Invalid ABCD source string array");
    return value;
}
export type GuidelineDocument = {
    id: string;
    subflow: string;
    text: string;
    allowedActions: string[];
    mappings: Array<{
        start: number;
        end: number;
        upstreamFile: string;
        upstreamPointer: string;
        kind: "key" | "value";
        valueDigest: string;
    }>;
};

function ontologyActionSchemas(ontology: unknown) {
    const actionGroups = object(
        object(ontology, "ontology").actions,
        "actions",
    );
    const slots = new Map<string, { parameters: string[]; pointer: string }>();
    for (const [groupName, actions] of Object.entries(actionGroups))
        for (const [name, parameters] of Object.entries(
            object(actions, "action group"),
        ))
            slots.set(name, {
                parameters: strings(parameters),
                pointer: `/actions/${groupName}/${name}`,
            });
    return slots;
}

export function constructAbcdGuidelines(
    guidelines: unknown,
    ontology: unknown,
    flows: readonly AbcdFlow[] = developmentFlows,
): GuidelineDocument[] {
    const groups = object(guidelines, "guidelines");
    const slots = ontologyActionSchemas(ontology);
    return flows.map((flow) => {
        const group = object(groups[flow.category], flow.category);
        const subflows = object(group.subflows, "subflows");
        const guide = object(subflows[flow.title], flow.title);
        if (!Array.isArray(guide.actions))
            throw new Error("ABCD guideline actions are required");
        let retained = "";
        const mappings: GuidelineDocument["mappings"] = [];
        const append = (
            value: string,
            pointer: string,
            separator = "\n\n",
            upstreamFile = "guidelines.json",
            kind: "key" | "value" = "value",
        ) => {
            if (retained) retained += separator;
            const start = retained.length;
            retained += value;
            mappings.push({
                start,
                end: retained.length,
                upstreamPointer: pointer,
                upstreamFile,
                kind,
                valueDigest: createHash("sha256").update(value).digest("hex"),
            });
        };
        const pointer = `/${flow.category}/subflows/${flow.title}`;
        append(flow.title, pointer, "\n\n", "guidelines.json", "key");
        append(text(group.description), `/${flow.category}/description`);
        strings(guide.instructions).forEach((instruction, index) =>
            append(instruction, `${pointer}/instructions/${index}`),
        );
        const allowedActions = guide.actions.map((value, index) => {
            const action = object(value, "guideline action");
            const button = text(action.button);
            const name = actionAliases[button];
            const communication =
                button === "N/A" && action.type === "communication";
            if ((!name && !communication) || (name && !slots.has(name)))
                throw new Error(`Unmapped ABCD button: ${button}`);
            append(text(action.type), `${pointer}/actions/${index}/type`);
            append(button, `${pointer}/actions/${index}/button`, "\n");
            append(text(action.text), `${pointer}/actions/${index}/text`, "\n");
            strings(action.subtext).forEach((item, itemIndex) =>
                append(
                    item,
                    `${pointer}/actions/${index}/subtext/${itemIndex}`,
                    "\n",
                ),
            );
            if (!name) return null;
            const schema = slots.get(name)!;
            append(name, schema.pointer, "\n", "ontology.json", "key");
            schema.parameters.forEach((slot, index) =>
                append(
                    slot,
                    `${schema.pointer}/${index}`,
                    "\n",
                    "ontology.json",
                ),
            );
            return name;
        });
        return {
            id: flow.id,
            subflow: flow.subflow,
            text: retained,
            allowedActions: allowedActions.filter(
                (name): name is string => name !== null,
            ),
            mappings,
        };
    });
}

export type DevelopmentCase = {
    id: string;
    flowId: string;
    input: { history: Array<{ speaker: string; text: string }> };
    gold: { nextstep: string; action: string | null; values: string[] };
};

export function developmentCases(
    dataset: unknown,
    perFlow = 2,
): DevelopmentCase[] {
    if (!Number.isSafeInteger(perFlow) || perFlow < 1 || perFlow > 20)
        throw new Error(
            "ABCD development case count must be between 1 and 20 per flow",
        );
    const dev = object(dataset, "archive").dev;
    if (!Array.isArray(dev)) throw new Error("ABCD dev split is required");
    const cases: DevelopmentCase[] = [];
    for (const flow of developmentFlows) {
        for (const value of dev) {
            const dialogue = object(value, "development dialogue");
            const scenario = object(dialogue.scenario, "development scenario");
            if (scenario.subflow !== flow.subflow) continue;
            if (!Array.isArray(dialogue.delexed))
                throw new Error("ABCD delexed turns are required");
            const turns = dialogue.delexed.map((turn) => object(turn, "turn"));
            const eligible = turns
                .map((turn, index) => {
                    if (!Array.isArray(turn.targets))
                        throw new Error("ABCD turn targets are required");
                    return { turn, index, targets: turn.targets };
                })
                .filter(
                    ({ targets, index }) =>
                        index > 0 &&
                        ["take_action", "end_conversation"].includes(
                            String(targets[1]),
                        ),
                );
            const remaining =
                perFlow -
                cases.filter((entry) => entry.flowId === flow.id).length;
            for (const entry of eligible.slice(0, remaining)) {
                const action = entry.targets[2];
                if (action !== null && typeof action !== "string")
                    throw new Error("Invalid ABCD gold action");
                cases.push({
                    id: `${flow.id}-${String(dialogue.convo_id)}-${entry.index}`,
                    flowId: flow.id,
                    input: {
                        history: turns.slice(0, entry.index).map((turn) => ({
                            speaker: text(turn.speaker),
                            text: text(turn.text),
                        })),
                    },
                    gold: {
                        nextstep: text(entry.targets[1]),
                        action,
                        values: strings(entry.targets[3]),
                    },
                });
            }
            if (
                cases.filter((entry) => entry.flowId === flow.id).length >=
                perFlow
            )
                break;
        }
        if (cases.filter((entry) => entry.flowId === flow.id).length < perFlow)
            throw new Error(
                `Insufficient pinned development cases for ${flow.id}`,
            );
    }
    return cases;
}

export async function loadAbcd(
    directory: string,
    allowDownload: boolean,
    flows: readonly AbcdFlow[] = developmentFlows,
): Promise<{
    documents: GuidelineDocument[];
    cases: DevelopmentCase[];
    actionVocabulary: string[];
}> {
    await mkdir(directory, { recursive: true });
    const bytes = new Map<string, Buffer>();
    for (const entry of abcdPin.files) {
        const filename = path.join(directory, entry.file);
        let buffer: Buffer;
        try {
            buffer = await readFile(filename);
        } catch (error) {
            if (
                !(
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                )
            )
                throw error;
            if (!allowDownload)
                throw new Error(
                    `Approved ABCD download is required: ${entry.file}`,
                );
            const response = await fetch(
                `https://raw.githubusercontent.com/asappresearch/abcd/${abcdPin.commit}/${entry.upstream}`,
                { signal: AbortSignal.timeout(120000) },
            );
            if (!response.ok)
                throw new Error(
                    `ABCD download failed (${response.status}): ${entry.file}`,
                );
            buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 40000000)
                throw new Error("ABCD artifact exceeds download-size bound");
            if (
                createHash("sha256").update(buffer).digest("hex") !==
                entry.sha256
            )
                throw new Error(
                    `ABCD downloaded artifact hash mismatch: ${entry.file}`,
                );
            await writeFile(filename, buffer, { flag: "wx" });
        }
        if (createHash("sha256").update(buffer).digest("hex") !== entry.sha256)
            throw new Error(
                `ABCD pinned artifact hash mismatch: ${entry.file}`,
            );
        bytes.set(entry.file, buffer);
    }
    const guidelines: unknown = JSON.parse(
        bytes.get("guidelines.json")!.toString("utf8"),
    );
    const ontology: unknown = JSON.parse(
        bytes.get("ontology.json")!.toString("utf8"),
    );
    const dataset: unknown = JSON.parse(
        gunzipSync(bytes.get("abcd_v1.1.json.gz")!, {
            maxOutputLength: 500000000,
        }).toString("utf8"),
    );
    return {
        documents: constructAbcdGuidelines(guidelines, ontology, flows),
        cases: developmentCases(dataset),
        actionVocabulary: [...ontologyActionSchemas(ontology).keys()].sort(),
    };
}

export type ActionPrediction = {
    nextstep: string;
    action: string | null;
    values: string[];
};
export function parsePrediction(value: unknown): ActionPrediction {
    const answer = object(value, "prediction");
    if (
        Object.keys(answer).sort().join(",") !== "action,nextstep,values" ||
        !["take_action", "retrieve_utterance", "end_conversation"].includes(
            String(answer.nextstep),
        ) ||
        (answer.action !== null && typeof answer.action !== "string")
    )
        throw new Error("Invalid next-action prediction shape");
    return {
        nextstep: text(answer.nextstep),
        action: answer.action,
        values: strings(answer.values),
    };
}
export function scorePrediction(
    gold: ActionPrediction,
    predicted: ActionPrediction,
    sourceActions: string[],
) {
    return {
        nextstep: predicted.nextstep === gold.nextstep,
        action: predicted.action === gold.action,
        values:
            JSON.stringify(predicted.values) === JSON.stringify(gold.values),
        sourceActionMembership:
            predicted.nextstep === "take_action"
                ? predicted.action !== null &&
                  sourceActions.includes(predicted.action)
                : null,
    };
}
