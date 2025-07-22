// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import path from "node:path";
import fs from "node:fs";
import {
    getCacheFactory,
    convertTestDataToExplanationData,
    readExplanationTestData,
    getAllActionConfigProvider,
    createSchemaInfoProvider,
} from "agent-dispatcher/internal";
import {
    AgentCache,
    JSONAction,
    ParamValueType,
    RequestAction,
    getDefaultExplainerName,
    createActionProps,
    normalizeParamValue,
    normalizeParamString,
    fromJsonActions,
    toJsonActions,
    ExecutableAction,
} from "agent-cache";
import { glob } from "glob";
import { fileURLToPath } from "node:url";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";

const schemaInfoProvider = createSchemaInfoProvider(
    (await getAllActionConfigProvider(getDefaultAppAgentProviders(undefined)))
        .provider,
);

export async function getImportedCache(
    explainerName: string,
    merge: boolean = false,
) {
    const cache = getCacheFactory().create(explainerName, schemaInfoProvider, {
        mergeMatchSets: merge,
        cacheConflicts: true,
    });
    await cache.import(
        inputs
            .filter(([i]) => i.explainerName === explainerName)
            .map(([testData, fileName]) =>
                convertTestDataToExplanationData(testData, fileName),
            ),
        true,
    );
    return cache;
}

const explainer = getDefaultExplainerName();

const coreDataFiles = [`test/data/explanations/**/${explainer}/*.json`];
const extendedDataFiles = [`test/repo/explanations/**/${explainer}/*.json`];
const dataFiles =
    process.env.TEST_EXTENDED_DATA === "1"
        ? coreDataFiles.concat(extendedDataFiles)
        : coreDataFiles;

// Test result is impacted by the order of import (from conflicing transform).
// Sort by file name to make the test result deterministic.
const inputs = await Promise.all(
    (await glob(dataFiles)).sort().map(async (f) => {
        return [await readExplanationTestData(f), f] as const;
    }),
);

const testInput = inputs.flatMap(([f]) =>
    f.entries.map<[string, string, RequestAction, object, string[]]>((data) => [
        f.schemaName,
        f.explainerName,
        new RequestAction(data.request, fromJsonActions(data.action)),
        data.explanation,
        data.tags ?? [],
    ]),
);

const selectedTestInput = testInput.filter(([t, e]) => e === explainer);

function getTestName(fileName: string) {
    let ext = "";
    let baseName = fileName;
    while (true) {
        const nextExt = path.extname(baseName);
        if (nextExt === "") {
            return { baseName, ext };
        }
        ext = `${nextExt}${ext}`;
        baseName = path.basename(baseName, nextExt);
    }
}

function getTestInputPart(testFileName: string) {
    const fileName = fileURLToPath(testFileName);
    const { baseName, ext } = getTestName(fileName);
    const numberStr = /\d+$/.exec(baseName);
    if (numberStr === null) {
        return { testInputPart: selectedTestInput };
    }

    const index = parseInt(numberStr[0]);
    const prefix = baseName.slice(0, -numberStr[0].length);

    if (`${prefix}${index}` !== baseName) {
        throw new Error("Invalid part number");
    }

    const pattern = new RegExp(`^${prefix}(\\d+)${ext}$`);
    const testParts = fs
        .readdirSync(path.dirname(fileName))
        .map((file) => {
            return pattern.exec(file);
        })
        .filter((m) => m !== null) as RegExpExecArray[];
    const numParts = testParts.length;
    testParts.forEach((file) => {
        const index = parseInt(file[1]);
        if (index.toString() !== file[1]) {
            throw new Error(`Invalid part number in ${file[0]}`);
        }

        if (index < 1 || index > numParts) {
            throw new Error(`Invalid part number in ${file[0]}`);
        }
    });

    return {
        testInputPart: selectedTestInput.slice(
            Math.floor(((index - 1) * selectedTestInput.length) / numParts),
            Math.floor((index * selectedTestInput.length) / numParts),
        ),
        partString: ` (${index}/${numParts})`,
    };
}

function normalizeParams(obj: any) {
    for (const [name, value] of Object.entries(obj)) {
        if (typeof value === "string") {
            obj[name] = normalizeParamString(value);
        } else if (typeof value === "object") {
            normalizeParams(value);
        }
    }
}

function normalizeAction(action: JSONAction) {
    if (action.parameters !== undefined) {
        normalizeParams(action.parameters);
    }
}

function normalizeActions(actions: ExecutableAction[]) {
    const actionJSON = toJsonActions(actions);

    if (Array.isArray(actionJSON)) {
        actionJSON.forEach(normalizeAction);
    } else {
        normalizeAction(actionJSON);
    }
    return actionJSON;
}

function expandActions(
    actions: ExecutableAction[],
    conflictValues?: [string, ParamValueType[]][],
) {
    const actionJSON = normalizeActions(actions);
    if (conflictValues === undefined || conflictValues.length === 0) {
        return [actionJSON];
    }

    // REVIEW: for testing purpose, expand all conflict variations for now so we can round trip
    const expandedActions = [actionJSON];

    for (const [name, values] of conflictValues) {
        expandedActions.push(
            ...expandedActions.flatMap((e) =>
                values.map((v) =>
                    createActionProps(
                        [[name, normalizeParamValue(v)]],
                        undefined,
                        false,
                        e,
                    ),
                ),
            ),
        );
    }
    return expandedActions;
}

export function defineRoundtripTest(merge: boolean, testFileName: string) {
    const { testInputPart, partString } = getTestInputPart(testFileName);
    describe("construction cache", () => {
        // Make sure that construction store can match original request after import (and merging)
        describe(`import ${merge ? "merge " : ""}roundtrip${partString}`, () => {
            let cacheP: Promise<AgentCache> | undefined;
            const failedTag = merge
                ? "failedImportMergeRoundTripAction"
                : "failedImportRoundTripAction";
            it.each(testInputPart)(
                "[%s %s] '%s'",
                async (
                    schemaName,
                    explainerName,
                    requestAction,
                    explanation,
                    tags,
                ) => {
                    if (cacheP === undefined) {
                        cacheP = getImportedCache(explainer, merge);
                    }
                    const cache = await cacheP;
                    const matched = cache.constructionStore.match(
                        requestAction.request,
                        {
                            rejectReferences: false,
                            conflicts: true,
                        },
                    );
                    const matchedActions = matched.flatMap((m) =>
                        expandActions(m.match.actions, m.conflictValues),
                    );
                    const expectedActions = normalizeActions(
                        requestAction.actions,
                    );
                    if (!tags.includes(failedTag)) {
                        // Able to match roundtrip
                        expect(matched.length).not.toEqual(0);
                        expect(matched[0].wildcardCharCount).toEqual(0);
                        expect(matchedActions).toContainEqual(expectedActions);
                    } else {
                        // TODO: needs fix these
                        expect(matchedActions).not.toContainEqual(
                            expectedActions,
                        );
                    }
                },
            );
        });
    });
}
