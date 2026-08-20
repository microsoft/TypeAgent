// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmarksRoot = path.resolve(here, "../../../..");
const droidCallRoot = path.resolve(here, "../DroidCall");
const sealToolsRoot = path.resolve(here, "../Seal-Tools");
const fullRunRoot = path.resolve(
    benchmarksRoot,
    "output/droidcall/multi-action-1000",
);
const dependentProbeRoot = path.resolve(
    here,
    "evidence/droidcall-dependent-10",
);
const evidenceRoot = path.resolve(here, "evidence");

function percent(numerator, denominator) {
    return denominator === 0 ? 0 : (100 * numerator) / denominator;
}

function round(value, digits = 2) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

async function readJson(file) {
    return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonl(file) {
    return (await readFile(file, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function sha256(file) {
    return createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
}

function modelName(result) {
    const names = [
        ...new Set(
            (result.rows ?? [])
                .map((row) => row.model)
                .filter((name) => typeof name === "string"),
        ),
    ];
    if (names.length !== 1) {
        throw new Error(
            `Expected one row model in result, found ${names.length}`,
        );
    }
    return names[0];
}

function runId(file) {
    return path.basename(file, ".json").replace(/^results-/u, "");
}

function adjustedDroidCallScore(result) {
    return result.droidCallAdjusted ?? result.droidCallOfficial;
}

function shapeSummary(result, fragment) {
    const entry = result.byShape.find(({ key }) => key.includes(fragment));
    if (entry === undefined) {
        throw new Error(`Missing shape '${fragment}'`);
    }
    return entry.summary;
}

function range(values) {
    return {
        min: Math.min(...values),
        max: Math.max(...values),
        spread: Math.max(...values) - Math.min(...values),
    };
}

function actionSet(row) {
    return row.expectedActions
        .map((action) => action.actionName)
        .sort()
        .join(" + ");
}

function stringLeaves(value, output = []) {
    if (typeof value === "string") {
        output.push(value);
    } else if (Array.isArray(value)) {
        for (const item of value) stringLeaves(item, output);
    } else if (value !== null && typeof value === "object") {
        for (const item of Object.values(value)) stringLeaves(item, output);
    }
    return output;
}

function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim();
}

function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
                ([key, item]) =>
                    `${JSON.stringify(key)}:${canonicalJson(item)}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function canonicalActionSet(actions) {
    return `[${actions.map(canonicalJson).sort().join(",")}]`;
}

function hasNonVerbatimGoldString(utteranceText, actions) {
    const utterance = normalizeText(utteranceText);
    return actions.some((action) =>
        stringLeaves(action.parameters).some((value) => {
            const normalized = normalizeText(value);
            return normalized !== "" && !utterance.includes(normalized);
        }),
    );
}

async function loadRunResults(root) {
    let names;
    try {
        names = await readdir(root);
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }
    return Promise.all(
        names
            .filter((name) => /^results-.*\.json$/u.test(name))
            .sort()
            .map(async (name) => {
                const file = path.join(root, name);
                return {
                    file,
                    hash: await sha256(file),
                    data: await readJson(file),
                };
            }),
    );
}

function analyzeFullRun(loaded) {
    if (loaded.length === 0) return undefined;
    const models = loaded.map(({ file, hash, data }) => {
        const name = modelName(data);
        const summary = data.typeAgentSupplemental;
        const arrays = shapeSummary(data, "array=yes");
        const noArrays = shapeSummary(data, "array=no;resultRef=no");
        const zeroParameters = shapeSummary(data, "params=zero");
        const diagnosticCount = Object.values(summary.diagnostics).reduce(
            (sum, count) => sum + count,
            0,
        );
        return {
            runId: runId(file),
            model: name,
            source: path.relative(benchmarksRoot, file),
            sha256: hash,
            released: data.droidCallReleased,
            paperDescribed: data.droidCallPaperDescribed,
            adjusted: adjustedDroidCallScore(data),
            typeAgent: summary,
            slices: {
                arrayParameters: arrays,
                nonArrayParameters: noArrays,
                zeroParameters,
            },
            wrongValueDiagnosticShare: percent(
                summary.diagnostics.wrongValue,
                diagnosticCount,
            ),
        };
    });

    const passByCase = new Map();
    for (const { data } of loaded) {
        for (const row of data.rows) {
            const existing = passByCase.get(row.caseId) ?? [];
            existing.push(row.score.passed === true);
            passByCase.set(row.caseId, existing);
        }
    }
    const cases = [...passByCase.values()];
    const allFail = cases.filter((passes) =>
        passes.every((pass) => !pass),
    ).length;
    const allPass = cases.filter((passes) => passes.every(Boolean)).length;
    const anyPass = cases.filter((passes) => passes.some(Boolean)).length;

    const candidatesByCase = new Map();
    for (const { data } of loaded) {
        for (const row of data.rows) {
            const signature = canonicalActionSet(row.chosenActions);
            const candidates = candidatesByCase.get(row.caseId) ?? new Map();
            const candidate = candidates.get(signature) ?? {
                votes: 0,
                passed: row.score.passed === true,
            };
            candidate.votes++;
            candidates.set(signature, candidate);
            candidatesByCase.set(row.caseId, candidates);
        }
    }
    let uniquePluralityPasses = 0;
    let pluralityTies = 0;
    let tiedPluralityAllPass = 0;
    let tiedPluralityAnyPass = 0;
    for (const candidates of candidatesByCase.values()) {
        const ranked = [...candidates.values()].sort(
            (left, right) => right.votes - left.votes,
        );
        const leaders = ranked.filter(
            (candidate) => candidate.votes === ranked[0].votes,
        );
        if (leaders.length > 1) {
            pluralityTies++;
            if (leaders.every((candidate) => candidate.passed)) {
                tiedPluralityAllPass++;
            }
            if (leaders.some((candidate) => candidate.passed)) {
                tiedPluralityAnyPass++;
            }
        } else if (leaders[0].passed) {
            uniquePluralityPasses++;
        }
    }

    const zeroParameterActionSets = new Map();
    const actionFamilies = new Map();
    const actionFamilyGrounding = new Map();
    for (const { data } of loaded) {
        for (const row of data.rows) {
            const expectedByActionName = new Map();
            for (const action of row.expectedActions) {
                const group = expectedByActionName.get(action.actionName) ?? [];
                group.push(action);
                expectedByActionName.set(action.actionName, group);
            }
            for (const [actionName, expectedActions] of expectedByActionName) {
                const family = actionFamilies.get(actionName) ?? {
                    evaluations: 0,
                    passes: 0,
                    caseIds: new Set(),
                };
                family.evaluations++;
                if (row.score.passed) family.passes++;
                family.caseIds.add(row.caseId);
                actionFamilies.set(actionName, family);

                const grounding = actionFamilyGrounding.get(actionName) ?? {
                    nonVerbatim: {
                        evaluations: 0,
                        passes: 0,
                        caseIds: new Set(),
                    },
                    verbatim: { evaluations: 0, passes: 0, caseIds: new Set() },
                };
                const bucket = hasNonVerbatimGoldString(
                    row.utterance,
                    expectedActions,
                )
                    ? grounding.nonVerbatim
                    : grounding.verbatim;
                bucket.evaluations++;
                if (row.score.passed) bucket.passes++;
                bucket.caseIds.add(row.caseId);
                actionFamilyGrounding.set(actionName, grounding);
            }
            if (row.shape.parameterCount !== "zero") continue;
            const key = actionSet(row);
            const current = zeroParameterActionSets.get(key) ?? {
                evaluations: 0,
                failuresAcrossModels: 0,
                caseIds: new Set(),
            };
            current.evaluations++;
            if (!row.score.passed) current.failuresAcrossModels++;
            current.caseIds.add(row.caseId);
            zeroParameterActionSets.set(key, current);
        }
    }

    const nonVerbatimByModel = loaded.map(({ file, data }) => {
        const buckets = {
            hasNonVerbatimGoldString: { rows: 0, passes: 0 },
            allGoldStringsVerbatim: { rows: 0, passes: 0 },
        };
        for (const row of data.rows) {
            const bucket = hasNonVerbatimGoldString(
                row.utterance,
                row.expectedActions,
            )
                ? buckets.hasNonVerbatimGoldString
                : buckets.allGoldStringsVerbatim;
            bucket.rows++;
            if (row.score.passed) bucket.passes++;
        }
        return {
            runId: runId(file),
            model: modelName(data),
            ...Object.fromEntries(
                Object.entries(buckets).map(([key, bucket]) => [
                    key,
                    {
                        ...bucket,
                        passRate: bucket.passes / bucket.rows,
                    },
                ]),
            ),
        };
    });

    const passRates = models.map(({ typeAgent }) => typeAgent.passRate);
    const exactRates = models.map(({ adjusted }) => adjusted.accuracy);
    const softRates = models.map(({ adjusted }) => adjusted.softAccuracy);
    const toolScores = models.map(({ typeAgent }) => typeAgent.toolScore);
    const parameterScores = models.map(({ typeAgent }) => typeAgent.paramScore);
    const arrayRates = models.map(
        ({ slices }) => slices.arrayParameters.passRate,
    );
    const nonArrayRates = models.map(
        ({ slices }) => slices.nonArrayParameters.passRate,
    );
    const wrongValueShares = models.map(
        ({ wrongValueDiagnosticShare }) => wrongValueDiagnosticShare,
    );
    const distinctModels = new Set(models.map(({ model }) => model)).size;
    const duplicateActionNameCases = loaded[0].data.rows.filter((row) => {
        const names = row.expectedActions.map((action) => action.actionName);
        return new Set(names).size !== names.length;
    }).length;

    return {
        run: {
            rows: cases.length,
            configurations: models.length,
            distinctModels,
            selection: "independent multi-action DroidCall rows",
        },
        modelResults: models,
        ranges: {
            typeAgentPassRate: range(passRates),
            adjustedExactAccuracy: range(exactRates),
            adjustedSoftAccuracy: range(softRates),
            toolScore: range(toolScores),
            parameterScore: range(parameterScores),
            arrayParameterPassRate: range(arrayRates),
            nonArrayParameterPassRate: range(nonArrayRates),
            wrongValueDiagnosticSharePercent: range(wrongValueShares),
        },
        crossModelConsensus: {
            cases: cases.length,
            passAllModels: allPass,
            failAllModels: allFail,
            passAtLeastOneModel: anyPass,
            disagreeAcrossModels: cases.length - allPass - allFail,
            oraclePassRate: anyPass / cases.length,
            pluralityVoteTies: pluralityTies,
            pluralityVotePasses: {
                lowerBound: uniquePluralityPasses + tiedPluralityAllPass,
                upperBound: uniquePluralityPasses + tiedPluralityAnyPass,
            },
            pluralityVotePassRate: {
                lowerBound:
                    (uniquePluralityPasses + tiedPluralityAllPass) /
                    cases.length,
                upperBound:
                    (uniquePluralityPasses + tiedPluralityAnyPass) /
                    cases.length,
            },
            casesWithDuplicateExpectedActionNames: duplicateActionNameCases,
        },
        nonVerbatimGoldStrings: nonVerbatimByModel,
        zeroParameterActionSets: [...zeroParameterActionSets.entries()]
            .map(([actions, counts]) => ({
                actions,
                sourceRows: counts.caseIds.size,
                evaluations: counts.evaluations,
                failuresAcrossModels: counts.failuresAcrossModels,
                failureRate: counts.failuresAcrossModels / counts.evaluations,
            }))
            .sort((a, b) => b.failuresAcrossModels - a.failuresAcrossModels)
            .slice(0, 12),
        rowsByActionFamily: [...actionFamilies.entries()]
            .map(([action, counts]) => ({
                action,
                sourceRows: counts.caseIds.size,
                rowEvaluations: counts.evaluations,
                rowPasses: counts.passes,
                rowPassRate: counts.passes / counts.evaluations,
            }))
            .sort((a, b) => b.sourceRows - a.sourceRows),
        rowsByActionFamilyGrounding: [...actionFamilyGrounding.entries()]
            .map(([action, groups]) => ({
                action,
                nonVerbatim: {
                    sourceRows: groups.nonVerbatim.caseIds.size,
                    rowEvaluations: groups.nonVerbatim.evaluations,
                    rowPassRate:
                        groups.nonVerbatim.passes /
                        groups.nonVerbatim.evaluations,
                },
                verbatim: {
                    sourceRows: groups.verbatim.caseIds.size,
                    rowEvaluations: groups.verbatim.evaluations,
                    rowPassRate:
                        groups.verbatim.passes / groups.verbatim.evaluations,
                },
            }))
            .filter(
                ({ nonVerbatim, verbatim }) =>
                    nonVerbatim.sourceRows >= 10 && verbatim.sourceRows >= 10,
            )
            .map((entry) => ({
                ...entry,
                rowPassRateGap:
                    entry.verbatim.rowPassRate - entry.nonVerbatim.rowPassRate,
            }))
            .sort((a, b) => b.rowPassRateGap - a.rowPassRateGap),
    };
}

function hasSealResultReference(row) {
    return /API_call_\d+/u.test(JSON.stringify(row.expectedActions));
}

function hasSealWholeValueResultReference(row) {
    return row.expectedActions.some((action) =>
        stringLeaves(action.parameters).some((value) =>
            /^API_call_\d+$/u.test(value),
        ),
    );
}

async function analyzeCoverage() {
    const droidAnalysisFile = path.join(droidCallRoot, "analysis.json");
    const droidRowsFile = path.join(
        droidCallRoot,
        "droid-call-multi-action.jsonl",
    );
    const sealRowsFile = path.join(
        sealToolsRoot,
        "seal-tools-validation.jsonl",
    );
    const [droidAnalysis, droidRows, sealRows] = await Promise.all([
        readJson(droidAnalysisFile),
        readJsonl(droidRowsFile),
        readJsonl(sealRowsFile),
    ]);
    const droidDependent = droidRows.filter(
        (row) => row.dimensions.dependency === "sequential",
    ).length;
    const sealMulti = sealRows.filter(
        (row) => row.expectedActions.length > 1,
    ).length;
    const sealDependent = sealRows.filter(hasSealResultReference).length;
    const sealWholeValueDependent = sealRows.filter(
        hasSealWholeValueResultReference,
    ).length;
    const sealStrict = sealRows.filter((row) => row.order === "strict").length;
    const combinedMulti = droidRows.length + sealMulti;
    const combinedDependent = droidDependent + sealDependent;
    return {
        sources: [
            {
                file: path.relative(benchmarksRoot, droidAnalysisFile),
                sha256: await sha256(droidAnalysisFile),
            },
            {
                file: path.relative(benchmarksRoot, droidRowsFile),
                sha256: await sha256(droidRowsFile),
            },
            {
                file: path.relative(benchmarksRoot, sealRowsFile),
                sha256: await sha256(sealRowsFile),
            },
        ],
        droidCall: {
            allRows: droidAnalysis.splits.full.rows,
            multiActionRows: droidRows.length,
            dependentRows: droidDependent,
            dependentShareOfAllRowsPercent: round(
                percent(droidDependent, droidAnalysis.splits.full.rows),
            ),
            dependentShareOfMultiActionRowsPercent: round(
                percent(droidDependent, droidRows.length),
            ),
        },
        sealTools: {
            allRows: sealRows.length,
            multiActionRows: sealMulti,
            resultReferenceRows: sealDependent,
            wholeValueResultReferenceRows: sealWholeValueDependent,
            embeddedOnlyResultReferenceRows:
                sealDependent - sealWholeValueDependent,
            strictOrderRows: sealStrict,
            dependentShareOfAllRowsPercent: round(
                percent(sealDependent, sealRows.length),
            ),
            dependentShareOfMultiActionRowsPercent: round(
                percent(sealDependent, sealMulti),
            ),
        },
        combined: {
            multiActionRows: combinedMulti,
            dependentRows: combinedDependent,
            dependentShareOfMultiActionRowsPercent: round(
                percent(combinedDependent, combinedMulti),
            ),
        },
    };
}

function analyzeDependentProbe(loaded) {
    if (loaded.length === 0) return undefined;
    return loaded.map(({ file, hash, data }) => {
        const rowsWithPendingRequest = data.rows.filter((row) =>
            row.chosenActions.some(
                (action) => action.actionName === "pendingRequestAction",
            ),
        ).length;
        const rowsWithTypedResultReference = data.rows.filter((row) =>
            JSON.stringify(row.rawChosenActions).includes('"$result"'),
        ).length;
        return {
            runId: runId(file),
            model: modelName(data),
            source: path.relative(benchmarksRoot, file),
            sha256: hash,
            rows: adjustedDroidCallScore(data).counts.rows,
            released: data.droidCallReleased,
            paperDescribed: data.droidCallPaperDescribed,
            adjusted: adjustedDroidCallScore(data),
            caseSensitive: data.droidCallCaseSensitive,
            caseInsensitive: data.droidCallCaseInsensitive,
            typeAgentFilter: data.typeAgentFilter,
            structuralSignals: {
                rowsWithPendingRequest,
                rowsWithTypedResultReference,
                translationErrorRows: data.rows.filter(
                    (row) => row.error != null,
                ).length,
            },
        };
    });
}

async function main() {
    const [coverage, fullRun, dependentProbe] = await Promise.all([
        analyzeCoverage(),
        loadRunResults(fullRunRoot),
        loadRunResults(dependentProbeRoot),
    ]);
    const report = {
        coverage,
        fullRun: analyzeFullRun(fullRun),
        dependentProbe: analyzeDependentProbe(dependentProbe),
    };
    await mkdir(evidenceRoot, { recursive: true });
    const output = path.join(evidenceRoot, "cross-dataset-analysis.json");
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(path.relative(process.cwd(), output));
}

await main();
