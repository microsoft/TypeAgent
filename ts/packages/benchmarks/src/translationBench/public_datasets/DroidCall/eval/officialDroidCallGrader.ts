// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonNumber } from "../../pythonLiteral.js";

const SCORER_REVISION = "3f7ba458bee480a86c602edff6cc7ec9cfd555db";
const NUMBER_LEXEME = "__pythonNumber";

export type DroidCallContractName =
    | "paper-described"
    | "released"
    | "typeagent-adjusted";
export type DroidCallMatchType = "strict" | "semantic" | "ignore";

export type DroidCallArgumentSpec = {
    required?: boolean;
    default?: unknown;
    match_type?: DroidCallMatchType;
};
export type DroidCallTool = {
    name: string;
    arguments: Record<string, DroidCallArgumentSpec>;
};
export interface DroidCallOfficialRow {
    response: readonly { name: string; arguments: Record<string, unknown> }[];
    answers: readonly { name: string; arguments: Record<string, unknown> }[];
}
export type DroidCallSemanticScorer = (left: string, right: string) => number;

export interface DroidCallContractScore {
    softAccuracy: number;
    accuracy: number;
    counts: Record<
        | "rows"
        | "perfectRows"
        | "correctArguments"
        | "totalArguments"
        | "functionCalls",
        number
    >;
    contract: {
        name: DroidCallContractName;
        scorerRevision: string;
        semanticScorer: "token-overlap" | "caller-supplied";
        semanticThreshold: number;
        softAccuracyAggregation: "function-call-mean" | "sample-mean";
        overrides: DroidCallOverride[];
    };
}

type DroidCallOverride = {
    tool: "ACTION_OPEN_DOCUMENT";
    argument: "mime_types";
    comparison: "presence-only";
};
type ValueRecord = Record<string, unknown>;
function isRecord(value: unknown): value is ValueRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFieldNone(value: unknown): boolean {
    return (
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim().toLowerCase() === "none")
    );
}
type NumericValue = number | bigint;
function numberValue(value: unknown): NumericValue | undefined {
    if (typeof value === "number") return value;
    const source =
        value instanceof PythonNumber
            ? value.lexeme
            : isRecord(value) && Object.keys(value).length === 1
              ? value[NUMBER_LEXEME]
              : undefined;
    if (typeof source !== "string") return undefined;
    return /^[+-]?\d+$/.test(source) ? BigInt(source) : Number(source);
}
function numbersEqual(left: NumericValue, right: NumericValue): boolean {
    if (typeof left === "bigint" && typeof right === "number") {
        return Number.isSafeInteger(right) && BigInt(right) === left;
    }
    if (typeof left === "number" && typeof right === "bigint") {
        return Number.isSafeInteger(left) && BigInt(left) === right;
    }
    return left === right;
}

function tokenOverlap(left: string, right: string): number {
    const tokens = (value: string) =>
        new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const a = tokens(left);
    const b = tokens(right);
    const union = new Set([...a, ...b]).size;
    return union === 0
        ? left.trim() === right.trim()
            ? 1
            : 0
        : [...a].filter((token) => b.has(token)).length / union;
}

function compare(
    left: unknown,
    right: unknown,
    matchType: DroidCallMatchType,
    threshold: number,
    semanticScorer: DroidCallSemanticScorer,
): boolean {
    if (matchType === "ignore") return true;
    if (isFieldNone(left) && isFieldNone(right)) return true;
    const leftNumber = numberValue(left);
    const rightNumber = numberValue(right);
    if (leftNumber !== undefined || rightNumber !== undefined) {
        return (
            leftNumber !== undefined &&
            rightNumber !== undefined &&
            numbersEqual(leftNumber, rightNumber)
        );
    }
    const same = (a: unknown, b: unknown): boolean =>
        compare(a, b, matchType, threshold, semanticScorer);
    if (isRecord(left) && isRecord(right)) {
        const keys = Object.keys(left);
        return (
            keys.length === Object.keys(right).length &&
            keys.every((key) => key in right && same(left[key], right[key]))
        );
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((item) =>
                right.some((candidate) => same(item, candidate)),
            ) &&
            right.every((item) =>
                left.some((candidate) => same(item, candidate)),
            )
        );
    }
    if (typeof left !== "string" || typeof right !== "string")
        return left === right;
    if (matchType === "strict") {
        return left.trim().toLowerCase() === right.trim().toLowerCase();
    }
    if (isFieldNone(left) || isFieldNone(right)) return false;
    return semanticScorer(left, right) > threshold;
}

function settings(contract: DroidCallContractName) {
    if (contract === "paper-described") {
        return {
            semanticThreshold: 0.75,
            aggregation: "function-call-mean" as const,
            mimePresenceOnly: false,
        };
    }
    if (contract === "released" || contract === "typeagent-adjusted") {
        return {
            semanticThreshold: 0.85,
            aggregation: "sample-mean" as const,
            mimePresenceOnly: contract === "typeagent-adjusted",
        };
    }
    throw new Error(`Unknown DroidCall scoring contract: ${contract}`);
}

export function scoreDroidCallContract(
    rows: readonly DroidCallOfficialRow[],
    apis: readonly DroidCallTool[],
    contract: DroidCallContractName,
    semanticScorer: DroidCallSemanticScorer = tokenOverlap,
): DroidCallContractScore {
    const config = settings(contract);
    const apiByName = new Map(apis.map((api) => [api.name, api]));
    let rowSoftTotal = 0;
    let callSoftTotal = 0;
    let callCount = 0;
    let perfectRows = 0;
    let correctArguments = 0;
    let totalArguments = 0;

    for (const row of rows) {
        const responseByName = new Map(
            row.response.map((response) => [response.name, response]),
        );
        let rowCorrect = 0;
        let rowTotal = 0;
        let rowFailed = false;
        for (const answer of row.answers) {
            const api = apiByName.get(answer.name);
            if (api === undefined)
                throw new Error(`Unknown API '${answer.name}'`);
            const response = responseByName.get(answer.name);
            let callCorrect = 0;
            let callTotal = 0;
            if (response === undefined) {
                rowFailed = true;
                callTotal = Object.keys(api.arguments).length;
                rowTotal += callTotal;
                callCount++;
                continue;
            }
            for (const [name, spec] of Object.entries(api.arguments)) {
                const answerHas = name in answer.arguments;
                const responseHas = name in response.arguments;
                if (
                    config.mimePresenceOnly &&
                    api.name === "ACTION_OPEN_DOCUMENT" &&
                    name === "mime_types"
                ) {
                    if (answerHas && responseHas) {
                        rowCorrect++;
                        callCorrect++;
                    }
                    rowTotal++;
                    callTotal++;
                    continue;
                }
                if (!answerHas && !responseHas) {
                    rowCorrect++;
                    callCorrect++;
                    rowTotal++;
                    callTotal++;
                    continue;
                }
                if (spec.required === true && !answerHas) {
                    rowTotal++;
                    callTotal++;
                    continue;
                }
                if (
                    compare(
                        answerHas
                            ? answer.arguments[name]
                            : (spec.default ?? null),
                        responseHas
                            ? response.arguments[name]
                            : (spec.default ?? null),
                        spec.match_type ?? "strict",
                        config.semanticThreshold,
                        semanticScorer,
                    )
                ) {
                    rowCorrect++;
                    callCorrect++;
                }
                rowTotal++;
                callTotal++;
            }
            callSoftTotal += callTotal === 0 ? 1 : callCorrect / callTotal;
            callCount++;
        }
        const rowScore = rowFailed
            ? 0
            : rowTotal === 0
              ? 1
              : rowCorrect / rowTotal;
        rowSoftTotal += rowScore;
        if (Math.abs(rowScore - 1) < 1e-6) perfectRows++;
        correctArguments += rowCorrect;
        totalArguments += rowTotal;
    }
    const rowCount = rows.length;
    return {
        softAccuracy:
            config.aggregation === "function-call-mean" && callCount > 0
                ? callSoftTotal / callCount
                : rowCount > 0
                  ? rowSoftTotal / rowCount
                  : 0,
        accuracy: rowCount > 0 ? perfectRows / rowCount : 0,
        counts: {
            rows: rowCount,
            perfectRows,
            correctArguments,
            totalArguments,
            functionCalls: callCount,
        },
        contract: {
            name: contract,
            scorerRevision: SCORER_REVISION,
            semanticScorer:
                semanticScorer === tokenOverlap
                    ? "token-overlap"
                    : "caller-supplied",
            semanticThreshold: config.semanticThreshold,
            softAccuracyAggregation: config.aggregation,
            overrides: config.mimePresenceOnly
                ? [
                      {
                          tool: "ACTION_OPEN_DOCUMENT",
                          argument: "mime_types",
                          comparison: "presence-only",
                      },
                  ]
                : [],
        },
    };
}

export class DroidCallContractGrader {
    public constructor(
        _legacyScriptPath?: string,
        private readonly semanticScorer: DroidCallSemanticScorer = tokenOverlap,
    ) {}

    public async score(
        rows: readonly DroidCallOfficialRow[],
        apis: readonly DroidCallTool[],
        contract: DroidCallContractName,
    ): Promise<DroidCallContractScore> {
        return scoreDroidCallContract(
            rows,
            apis,
            contract,
            this.semanticScorer,
        );
    }

    public async close(): Promise<void> {}
}
