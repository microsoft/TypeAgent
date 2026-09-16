#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const droidCallDir = path.resolve(scriptDir, "../../..");
const packageRoot = path.resolve(droidCallDir, "../../../..");

function option(name, fallback) {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
}

const resultsDir = path.resolve(option("--results-dir", scriptDir));
const output = path.resolve(
    option(
        "--output",
        path.join(resultsDir, "typeagent-droidcall-translation-eval.tex"),
    ),
);

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
    const text = fs.readFileSync(file, "utf8").trim();
    return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

function requireFile(file) {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
    return file;
}

const tex = (value) =>
    String(value ?? "")
        .replace(/\\/g, "\\textbackslash{}")
        .replace(/([&%$#_{}])/g, "\\$1")
        .replace(/~/g, "\\textasciitilde{}")
        .replace(/\^/g, "\\textasciicircum{}")
        .replace(/[–—]/g, "-")
        .replace(/[“”]/g, '"')
        .replace(/’/g, "'");
const shortJson = (value, max = 120) => {
    const text = value === undefined ? "<omitted>" : JSON.stringify(value);
    return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
const shortText = (value, max = 105) => {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
const listing = (value) =>
    JSON.stringify(value, null, 2)
        .replace(/[–—]/g, "-")
        .replace(/[“”]/g, '"')
        .replace(/’/g, "'");
const breakableTex = (value) =>
    tex(value)
        .replaceAll("\\{", "\\{\\allowbreak{}")
        .replaceAll("\\}", "\\allowbreak{}\\}")
        .replaceAll("[", "[\\allowbreak{}")
        .replaceAll("]", "\\allowbreak{}]")
        .replaceAll("\\_", "\\_\\allowbreak{}")
        .replaceAll(",", ",\\allowbreak{}")
        .replaceAll("/", "/\\allowbreak{}")
        .replaceAll(":", ":\\allowbreak{}");
const code = (value) => `\\code{${String(value)}}`;
const digest = (value) =>
    `\\texttt{${String(value)
        .match(/.{1,8}/g)
        .join("\\allowbreak{}")}}`;
const pct = (value) => `${(100 * Number(value)).toFixed(1)}\\%`;
const pct2 = (value) => `${(100 * Number(value)).toFixed(2)}\\%`;
const integer = (value) => Number(value).toLocaleString("en-US");
const slug = (model) => model.replace(/[^A-Za-z0-9_.-]/g, "_");
const modelLabel = (model) => tex(model.replace(/^azure\//, ""));

const analysis = readJson(
    requireFile(path.join(droidCallDir, "analysis.json")),
);
const dataset = readJsonl(
    requireFile(path.join(droidCallDir, "droid-call-multi-action.jsonl")),
);
const apiCatalog = readJsonl(
    requireFile(path.join(droidCallDir, "raw", "annotated_api.jsonl")),
);
const summary = readJson(requireFile(path.join(resultsDir, "summary.json")));
const models = Object.keys(summary.byModel);
if (models.length === 0) throw new Error("summary.json contains no models");

const results = models.map((model) => {
    const result = readJson(
        requireFile(path.join(resultsDir, `results-${slug(model)}.json`)),
    );
    const summarized = summary.byModel[model];
    const paper =
        summarized.droidCallPaperDescribed ?? result.droidCallPaperDescribed;
    const released = summarized.droidCallReleased ?? result.droidCallReleased;
    const adjusted = summarized.droidCallAdjusted ?? result.droidCallAdjusted;
    if (
        paper === undefined ||
        released === undefined ||
        adjusted === undefined
    ) {
        throw new Error(
            `DroidCall contract scores are incomplete for ${model}`,
        );
    }
    return { model, result, summarized, paper, released, adjusted };
});

const rowCount = results[0].result.rows.length;
if (results.some(({ result }) => result.rows.length !== rowCount)) {
    throw new Error("Result files do not contain the same number of rows");
}
const caseIds = results[0].result.rows.map((row) => row.caseId);
for (const { model, result } of results) {
    if (
        JSON.stringify(result.rows.map((row) => row.caseId)) !==
        JSON.stringify(caseIds)
    ) {
        throw new Error(`${model} did not evaluate the same ordered case set`);
    }
}

const selectedRows = new Map(dataset.map((row) => [row.id, row]));
const runRows = caseIds.map((id) => {
    const row = selectedRows.get(id);
    if (row === undefined) throw new Error(`Unknown DroidCall case '${id}'`);
    return row;
});
const strictRows = runRows.filter((row) => row.order === "strict").length;
if (strictRows !== 0) {
    throw new Error(
        `Expected a non-nested run, found ${strictRows} strict rows`,
    );
}
const independentRows = rowCount - strictRows;
const expectedCalls = runRows.reduce(
    (total, row) => total + row.expectedActions.length,
    0,
);

const catalogByName = new Map(apiCatalog.map((api) => [api.name, api]));

function isNone(value) {
    return (
        value === null ||
        (typeof value === "string" && value.trim().toLowerCase() === "none")
    );
}

function compareOfficialValue(left, right, matchType = "strict") {
    if (matchType === "ignore") return { match: true, unresolved: false };
    if (isNone(left) && isNone(right)) {
        return { match: true, unresolved: false };
    }
    if (
        typeof left !== typeof right ||
        Array.isArray(left) !== Array.isArray(right)
    ) {
        return { match: false, unresolved: false };
    }
    if (Array.isArray(left)) {
        if (left.length !== right.length) {
            return { match: false, unresolved: false };
        }
        let unresolved = false;
        const bothWays =
            left.every((a) =>
                right.some((b) => {
                    const compared = compareOfficialValue(a, b, matchType);
                    unresolved ||= compared.unresolved;
                    return compared.match;
                }),
            ) &&
            right.every((b) =>
                left.some((a) => {
                    const compared = compareOfficialValue(a, b, matchType);
                    unresolved ||= compared.unresolved;
                    return compared.match;
                }),
            );
        return { match: bothWays, unresolved };
    }
    if (left !== null && typeof left === "object") {
        const leftEntries = Object.entries(left);
        const rightEntries = Object.entries(right);
        if (leftEntries.length !== rightEntries.length) {
            return { match: false, unresolved: false };
        }
        let unresolved = false;
        const match = leftEntries.every(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
            const compared = compareOfficialValue(value, right[key], matchType);
            unresolved ||= compared.unresolved;
            return compared.match;
        });
        return { match, unresolved };
    }
    if (typeof left === "string") {
        const exact = left.trim().toLowerCase() === right.trim().toLowerCase();
        return {
            match: exact,
            unresolved: matchType === "semantic" && !exact,
        };
    }
    return { match: left === right, unresolved: false };
}

function scoreOfficialRow(row, sourceRow) {
    const predictions = row.rawChosenActions ?? row.chosenActions ?? [];
    const responseMap = new Map(
        predictions.map((action) => [action.actionName, action]),
    );
    let correct = 0;
    let total = 0;
    let unresolvedSemantic = false;
    const failures = [];
    for (const answer of sourceRow.droidCallGoldActions) {
        const api = catalogByName.get(answer.name);
        if (api === undefined) continue;
        const response = responseMap.get(answer.name);
        if (response === undefined) {
            const count = Object.keys(api.arguments).length;
            total += count;
            failures.push(`missing ${answer.name} (${count} catalog fields)`);
            continue;
        }
        const responseArgs =
            response.parameters !== null &&
            typeof response.parameters === "object" &&
            !Array.isArray(response.parameters)
                ? response.parameters
                : {};
        for (const [name, spec] of Object.entries(api.arguments)) {
            const answerHas = Object.prototype.hasOwnProperty.call(
                answer.arguments,
                name,
            );
            const responseHas = Object.prototype.hasOwnProperty.call(
                responseArgs,
                name,
            );
            total++;
            if (
                answer.name === "ACTION_OPEN_DOCUMENT" &&
                name === "mime_types"
            ) {
                if (answerHas && responseHas) {
                    correct++;
                } else {
                    failures.push(
                        `${answer.name}.${name}: required field omitted`,
                    );
                }
                continue;
            }
            if (!answerHas && !responseHas) {
                correct++;
                continue;
            }
            if (spec.required === true && !answerHas) {
                failures.push(`${answer.name}.${name}: missing from gold`);
                continue;
            }
            const expected = answerHas ? answer.arguments[name] : spec.default;
            const actual = responseHas ? responseArgs[name] : spec.default;
            const compared = compareOfficialValue(
                expected,
                actual,
                spec.match_type ?? "strict",
            );
            unresolvedSemantic ||= compared.unresolved;
            if (compared.match) {
                correct++;
            } else {
                failures.push(
                    `${answer.name}.${name}: ${shortJson(expected, 48)} -> ${shortJson(actual, 48)}`,
                );
            }
        }
    }
    return {
        score: total === 0 ? 1 : correct / total,
        correct,
        total,
        unresolvedSemantic,
        cause: failures.slice(0, 2).join("; "),
    };
}

function failureExamples(item) {
    const scored = item.result.rows
        .map((row) => {
            const sourceRow = selectedRows.get(row.caseId);
            if (sourceRow === undefined) return undefined;
            return { row, ...scoreOfficialRow(row, sourceRow) };
        })
        .filter(
            (entry) =>
                entry !== undefined &&
                entry.score < 1 &&
                !entry.unresolvedSemantic &&
                entry.cause !== "",
        );
    const low = [...scored].sort((a, b) => a.score - b.score).slice(0, 3);
    const lowIds = new Set(low.map((entry) => entry.row.caseId));
    const near = [...scored]
        .filter((entry) => !lowIds.has(entry.row.caseId))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    if (low.length !== 3 || near.length !== 3) {
        throw new Error(`Not enough failure examples for ${item.model}`);
    }
    return { low, near };
}
let unknownGoldArguments = 0;
let missingRequiredArguments = 0;

for (const row of dataset) {
    row.droidCallGoldActions.forEach((action) => {
        const api = catalogByName.get(action.name);
        const args = action.arguments ?? {};
        if (api === undefined) return;
        for (const [name, value] of Object.entries(args)) {
            const definition = api.arguments[name];
            if (definition === undefined) {
                unknownGoldArguments++;
                continue;
            }
            void value;
        }
        for (const [name, definition] of Object.entries(api.arguments)) {
            if (definition.required === true && !(name in args)) {
                missingRequiredArguments++;
            }
        }
    });
}

const paperContract = results[0].paper.contract;
const releasedContract = results[0].released.contract;
const adjustedContract = results[0].adjusted.contract;
if (
    paperContract === undefined ||
    releasedContract === undefined ||
    adjustedContract === undefined
) {
    throw new Error("DroidCall scorer contract metadata is missing");
}

const officialDiagnosticRows = results
    .map(({ model, result, summarized, paper, released, adjusted }) => {
        const diagnostic =
            summarized.droidCallCaseInsensitive ??
            result.droidCallCaseInsensitive;
        return `${modelLabel(model)} & ${pct2(paper.softAccuracy)} & ${pct(paper.accuracy)} & ${pct2(released.softAccuracy)} & ${pct(released.accuracy)} & ${pct2(adjusted.softAccuracy)} & ${pct(adjusted.accuracy)} & ${pct2(diagnostic.tool.f1)} & ${pct2(diagnostic.parameter.f1)} \\\\`;
    })
    .join("\n");

const supplementalRows = results
    .map(({ model, result, summarized }) => {
        const supplemental =
            summarized.typeAgentSupplemental ?? result.typeAgentSupplemental;
        return `${modelLabel(model)} & ${pct(supplemental.passRate)} & ${pct(supplemental.exactPassRate)} & ${pct(supplemental.schemaValidRate)} & ${pct2(supplemental.toolScore)} & ${pct2(supplemental.paramScore)} & ${result.summary.errors} \\\\`;
    })
    .join("\n");

const exampleId = "droidcall-train-1002";
const example = selectedRows.get(exampleId);
if (example === undefined || !caseIds.includes(exampleId)) {
    throw new Error(`Example row ${exampleId} is not in this run`);
}
const exampleSchemaName = exampleId.replace(/[^A-Za-z0-9_]/g, "_");
const exampleSource = {
    query: example.utterance,
    tools: example.tools.map((tool) => tool.function),
    answers: example.droidCallGoldActions.map(({ name, arguments: args }) => ({
        name,
        arguments: args,
    })),
};
const exampleTypeAgent = {
    schema: {
        schemaName: exampleSchemaName,
        description: `DroidCall candidate tools for ${exampleId}`,
        tools: example.tools,
    },
    case: {
        id: exampleId,
        activeSchemas: [exampleSchemaName],
        utterance: example.utterance,
        expectedActions: example.expectedActions.map((action) => ({
            ...action,
            schemaName: exampleSchemaName,
        })),
        order: example.order,
    },
};

const failureSets = new Map(
    results.map((item) => [item.model, failureExamples(item)]),
);
const failureRows = (kind) =>
    results
        .flatMap((item) =>
            failureSets.get(item.model)[kind].map((entry) => {
                const expected = JSON.stringify(entry.row.expectedActions);
                const actual = JSON.stringify(
                    entry.row.rawChosenActions ?? entry.row.chosenActions ?? [],
                );
                return String.raw`\multicolumn{2}{l}{\textbf{${modelLabel(item.model)}}\quad ${tex(entry.row.caseId)}\quad \textbf{Row soft:} ${entry.correct}/${entry.total} (${pct(entry.score)})} \\*
\textbf{Request} & ${breakableTex(entry.row.utterance)} \\*
\textbf{Expected} & {\ttfamily ${breakableTex(expected)}} \\*
\textbf{Actual} & {\ttfamily ${breakableTex(actual)}} \\*
\textbf{Mismatch} & ${breakableTex(entry.cause)} \\
\midrule`;
            }),
        )
        .join("\n");

const scoreExample = results[0];
const scorePaper = scoreExample.paper;
const scoreReleased = scoreExample.released;
const scoreAdjusted = scoreExample.adjusted;
const scoreDiagnostic =
    scoreExample.summarized.droidCallCaseInsensitive ??
    scoreExample.result.droidCallCaseInsensitive;
const scoreSupplemental =
    scoreExample.summarized.typeAgentSupplemental ??
    scoreExample.result.typeAgentSupplemental;
const scoreRowExample = failureSets.get(scoreExample.model).near[0];

const bestSoft = results.reduce((best, item) =>
    item.adjusted.softAccuracy > best.adjusted.softAccuracy ? item : best,
);
const bestExact = results.reduce((best, item) =>
    item.adjusted.accuracy > best.adjusted.accuracy ? item : best,
);
const totalPromptTokens = results.reduce(
    (total, { result }) => total + (result.summary.usage.promptTokens ?? 0),
    0,
);
const totalCompletionTokens = results.reduce(
    (total, { result }) => total + (result.summary.usage.completionTokens ?? 0),
    0,
);
const totalErrors = results.reduce(
    (total, { result }) => total + result.summary.errors,
    0,
);
const runKind =
    rowCount === dataset.length
        ? "complete multi-action corpus"
        : `${integer(rowCount)}-row multi-action slice`;
const date = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
}).format(new Date());

const source = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{graphicx}
\usepackage{longtable}
\usepackage{pdflscape}
\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{listings}
\setlength{\emergencystretch}{3em}
\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue,pdftitle={TypeAgent DroidCall Translation Evaluation},pdfauthor={Microsoft TypeAgent}}
\newcommand{\tocsub}[1]{\subsection*{#1}\addcontentsline{toc}{subsection}{#1}}
\newcommand{\code}[1]{\texttt{\detokenize{#1}}}
\lstset{basicstyle=\ttfamily\footnotesize,breaklines=true,columns=fullflexible,frame=single}
\title{TypeAgent DroidCall Translation Evaluation}
\author{${tex(runKind)} across ${models.length} model configurations}
\date{${tex(date)}}

\begin{document}
\maketitle
\setcounter{tocdepth}{2}
\tableofcontents
\bigskip

\section{Summary}
This evaluation covers ${integer(rowCount)} of the ${integer(dataset.length)} converted multi-action DroidCall rows. It produced ${integer(rowCount * models.length)} translations across ${models.length} model configurations. ${modelLabel(bestSoft.model)} had the highest adjusted soft accuracy at \textbf{${pct(bestSoft.adjusted.softAccuracy)}}. ${modelLabel(bestExact.model)} had the highest adjusted exact accuracy at \textbf{${pct(bestExact.adjusted.accuracy)}}.

The paper, released scorer, and TypeAgent adjustment are separate columns. The current run is not comparable with the paper's reported model results because it uses a different split, row filter, prompt, tool set, and output protocol.

\section{Dataset}
DroidCall has ${integer(analysis.splits.full.rows)} rows. This run selects ${integer(rowCount)} rows that contain at least two actions and no nested or dependent result references. The selected rows contain ${integer(expectedCalls)} gold calls. This is a fixed 1,000-row slice of the ${integer(analysis.splits.full.buckets.multiCallWithoutNested.rows)} eligible non-nested multi-action rows.

Source: \href{https://huggingface.co/datasets/mllmTeam/DroidCall}{mllmTeam/DroidCall}, revision ${digest(analysis.source.revision)}.

\section{Example row and TypeAgent mapping}
The example below is part of the evaluated slice. Its two APIs are included in full.

\tocsub{DroidCall source row}
\begin{lstlisting}
${listing(exampleSource)}
\end{lstlisting}

\tocsub{TypeAgent benchmark form}
The converter changes each DroidCall argument definition into a closed JSON Schema. It also assigns one schema to the row, activates that schema for the request, and rewrites each gold call as an expected TypeAgent action. Since neither action depends on the other's result, order is \code{any}.

\begin{lstlisting}
${listing(exampleTypeAgent)}
\end{lstlisting}

\section{Scoring contracts}
The paper says to average parameter accuracy across function calls and sets the BERTScore threshold to ${paperContract.semanticThreshold}. The released \code{result_checker.py} at commit ${digest(releasedContract.scorerRevision)} instead averages one combined parameter score per sample and uses a threshold of ${releasedContract.semanticThreshold}. It trims and lowercases strings, applies catalog defaults, permits jointly omitted optional arguments, compares lists without order, collapses repeated tool names to the last prediction, and ignores extra predicted tools. BERTScore is pinned to ${tex(releasedContract.bertScore)} and Transformers to ${tex(releasedContract.transformers)}.

The paper does not specify repeated calls, defaults, lists, malformed output, or extra predictions. The paper-described column uses the released behavior for those cases, then applies the paper's threshold and function-call mean. It is a literal interpretation of the text, not an exact reproduction of unpublished evaluation logic.

TypeAgent adds one override. For \code{ACTION_OPEN_DOCUMENT.mime_types}, the grader checks that the field exists in both gold and predicted arguments but does not compare its contents. For example, \code{["application/pdf","application/msword","text/plain"]} and \code{["*/*"]} both request a document picker and therefore match. Omitting \code{mime_types} still fails. All other fields use the upstream comparison.

The paper evaluates 200 test rows with DroidCall's prompt and a fake retriever that returns all gold tools plus random distractors up to four candidates. This run evaluates ${integer(rowCount)} training rows with TypeAgent prompts and 2.292 candidate tools per row on average. It also contains 67 rows with repeated gold tool names. No score in this report should be presented as a reproduction of the paper's Table 2.

\tocsub{How each score is calculated}
The examples use ${modelLabel(scoreExample.model)} so each percentage can be tied to a saved count.

\begin{description}
\item[Paper-described soft accuracy.] Each gold function call scores its correct catalog arguments divided by its catalog arguments. The benchmark averages ${integer(scorePaper.counts.functionCalls)} call scores. For this model the result is ${pct2(scorePaper.softAccuracy)}.
\item[Released soft accuracy.] Each sample combines all catalog arguments across its gold calls. The benchmark averages ${integer(scoreReleased.counts.rows)} sample scores. For this model the result is ${pct2(scoreReleased.softAccuracy)}.
\item[Adjusted soft accuracy.] This repeats released scoring with the MIME presence rule. For this model the result is ${pct2(scoreAdjusted.softAccuracy)}. For example, ${tex(scoreRowExample.row.caseId)} matches ${scoreRowExample.correct} of ${scoreRowExample.total} checked arguments, so its adjusted row score is ${pct(scoreRowExample.score)}.
\item[Exact accuracy.] A sample passes when its combined parameter score is 100\%. The released contract passes ${integer(scoreReleased.counts.perfectRows)} of ${integer(scoreReleased.counts.rows)} rows, or ${pct(scoreReleased.accuracy)}. The adjusted contract passes ${integer(scoreAdjusted.counts.perfectRows)}, or ${pct(scoreAdjusted.accuracy)}.
\item[Format accuracy.] ${integer(scoreDiagnostic.counts.formatted)} of ${integer(scoreDiagnostic.counts.rows)} responses parse into the expected action format: ${pct(scoreDiagnostic.formatAccuracy)}.
\item[Tool precision, recall, and F1.] Precision is ${integer(scoreDiagnostic.counts.correctTools)}/${integer(scoreDiagnostic.counts.predictedTools)}=${pct2(scoreDiagnostic.tool.precision)}. Recall is ${integer(scoreDiagnostic.counts.correctTools)}/${integer(scoreDiagnostic.counts.goldTools)}=${pct2(scoreDiagnostic.tool.recall)}. Their harmonic mean is ${pct2(scoreDiagnostic.tool.f1)}.
\item[Parameter precision, recall, and F1.] Values are compared after trimming strings and ignoring case. Precision is ${integer(scoreDiagnostic.counts.correctParameters)}/${integer(scoreDiagnostic.counts.predictedParameters)}=${pct2(scoreDiagnostic.parameter.precision)}. Recall is ${integer(scoreDiagnostic.counts.correctParameters)}/${integer(scoreDiagnostic.counts.goldParameters)}=${pct2(scoreDiagnostic.parameter.recall)}. Their harmonic mean is ${pct2(scoreDiagnostic.parameter.f1)}.
\item[TypeAgent pass.] ${integer(scoreSupplemental.passedCases)}/${integer(scoreSupplemental.totalCases)} rows match all expected routes and normalized parameters: ${pct(scoreSupplemental.passRate)}. Optional defaults do not have to appear explicitly.
\item[TypeAgent exact pass.] ${integer(scoreSupplemental.exactPassedCases)}/${integer(scoreSupplemental.totalCases)} rows match the complete action and parameter objects: ${pct(scoreSupplemental.exactPassRate)}.
\item[Schema valid.] ${integer(scoreSupplemental.schemaValidCases)}/${integer(scoreSupplemental.totalCases)} translations pass schema validation: ${pct(scoreSupplemental.schemaValidRate)}.
\item[TypeAgent tool and parameter scores.] The tool score is ${integer(scoreSupplemental.routed)}/${integer(scoreSupplemental.expectedCount)}=${pct2(scoreSupplemental.toolScore)}. Among routed actions, ${integer(scoreSupplemental.paramMatches)}/${integer(scoreSupplemental.routed)} match normalized parameters, giving ${pct2(scoreSupplemental.paramScore)}.
\end{description}

All string comparisons in this report are case insensitive. The adjusted grader also trims strings, treats lists as unordered, applies catalog defaults, and uses BERTScore for semantic fields. The audit found a few source defects: ${integer(unknownGoldArguments)} gold arguments are absent from the API catalog and ${integer(missingRequiredArguments)} gold calls omit a required catalog argument. The pinned upstream scorer inherits them.

\section{Results}
\tocsub{DroidCall contracts and diagnostics}
\begin{center}\scriptsize
\resizebox{\linewidth}{!}{%
\begin{tabular}{lrrrrrrrr}
\toprule
Model & Paper soft & Paper exact & Released soft & Released exact & Adjusted soft & Adjusted exact & Tool F1 & Param F1 \\
\midrule
${officialDiagnosticRows}
\bottomrule
\end{tabular}
}
\end{center}

Paper-described, released, and adjusted scores use the contracts above. Tool and parameter F1 are Seal-compatible diagnostics over the same ${integer(rowCount)} rows. Their string comparison trims whitespace and ignores case.

\tocsub{TypeAgent supplemental scores}
\begin{center}\scriptsize
\begin{tabular}{lrrrrrr}
\toprule
Model & Pass & Exact pass & Schema valid & Tool score & Param score & Errors \\
\midrule
${supplementalRows}
\bottomrule
\end{tabular}
\end{center}

TypeAgent pass uses ${integer(independentRows)} independent rows. These supplemental scores use TypeAgent's contract and are not directly comparable with adjusted DroidCall soft or exact accuracy. The run recorded ${integer(totalErrors)} translation errors, ${integer(totalPromptTokens)} prompt tokens, and ${integer(totalCompletionTokens)} completion tokens.

\begin{landscape}
\section{Soft-accuracy failure examples}
These are the three lowest fully deterministic row scores for each model. Semantic mismatches that require BERTScore are excluded so every fraction below can be reproduced from the printed expected and predicted values.

\begingroup
\tiny
\setlength{\tabcolsep}{3pt}
\renewcommand{\arraystretch}{0.88}
\begin{longtable}{p{0.10\linewidth}p{0.86\linewidth}}
\toprule
Field & Value \\
\midrule
\endfirsthead
\toprule
Field & Value \\
\midrule
\endhead
${failureRows("low")}
\end{longtable}
\endgroup
\end{landscape}

\begin{landscape}
\section{Exact-accuracy failure examples}
Exact accuracy is binary. Any row below 100\% fails, even when one catalog argument is wrong. These are three near misses per model, separate from the low-score examples above.

\begingroup
\tiny
\setlength{\tabcolsep}{3pt}
\renewcommand{\arraystretch}{0.88}
\begin{longtable}{p{0.10\linewidth}p{0.86\linewidth}}
\toprule
Field & Value \\
\midrule
\endfirsthead
\toprule
Field & Value \\
\midrule
\endhead
${failureRows("near")}
\end{longtable}
\endgroup
\end{landscape}

\section{Interpretation}
Use the released columns when comparing scorer implementations. Use the adjusted columns only for the TypeAgent product interpretation of document-picker MIME filters. The paper-described columns implement the formula and threshold printed in the paper, but this 1,000-row training slice does not reproduce the paper's evaluation setup.

This report describes the ${integer(rowCount)}-row non-nested run in ${code(path.relative(packageRoot, resultsDir))}.

\end{document}
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, source);
console.log(output);
