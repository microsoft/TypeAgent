// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import chalk from "chalk";
import { similarity, SimilarityType } from "typeagent";

export interface StatsResult {
    request: string;
    actualActionName: string;
    precision?: number;
    recall?: number;
    rank: number;
    matches: { actionName: string; score: number }[];
    meanScore: number;
    medianScore: number;
    stdDevScore: number;
}

function loadActionData(filePath: string): any[] {
    const rawData = fs.readFileSync(filePath, "utf8").split("\n");
    let data: any[] = [];
    rawData.forEach((line, index) => {
        if (line.trim() !== "") {
            try {
                data.push(JSON.parse(line));
            } catch (error: any) {
                console.error(`Error parsing JSON on line ${index + 1}:`, line);
                console.error(`Error details: ${error.message}`);
            }
        }
    });
    return data.map((item: any) => ({
        ...item,
        embedding: new Float32Array(item.embedding),
        requests: item.requests.map((request: any) => ({
            ...request,
            embedding: new Float32Array(request.embedding),
        })),
    }));
}

function calcMean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcMedian(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcStdDeviation(values: number[]): number {
    const mean = calcMean(values);
    const squaredDiffs = values.map((value) => Math.pow(value - mean, 2));
    const avgSquaredDiff = calcMean(squaredDiffs);
    return Math.sqrt(avgSquaredDiff);
}

export function generateStats(data: any[], threshold: number = 0.7) {
    const allRequests = data.flatMap((action) =>
        action.requests.map((request: any) => ({
            request: request.request,
            embedding: request.embedding,
            actualActionName: action.actionName,
        })),
    );

    const results = allRequests.map((requestObj: any) => {
        const {
            request,
            embedding: requestEmbedding,
            actualActionName,
        } = requestObj;
        const matches = data
            .map((action) => ({
                actionName: action.actionName,
                typeName: action.typeName,
                score: parseFloat(
                    similarity(
                        action.embedding,
                        requestEmbedding,
                        SimilarityType.Cosine,
                    ).toFixed(2),
                ),
            }))
            .sort((a, b) => {
                if (b.score === a.score) {
                    if (b.actionName === actualActionName) return 1;
                    if (a.actionName === actualActionName) return -1;
                    return 0;
                }
                return b.score - a.score;
            })
            .slice(0, 10);

        const rank =
            matches.findIndex(
                (match) => match.actionName === actualActionName,
            ) + 1;
        const scores = matches.map((match) => match.score);
        const meanScore = calcMean(scores);
        const medianScore = calcMedian(scores);
        const stdDevScore = calcStdDeviation(scores);
        return {
            request,
            actualActionName,
            rank,
            matches,
            meanScore,
            medianScore,
            stdDevScore,
        };
    });

    return results;
}

export function printDetailedMarkdownTable(
    results: StatsResult[],
    statsfile: string,
    zerorankStatsFile?: string | undefined,
) {
    console.log(chalk.bold("\n## Results for User Request Matches\n"));
    console.log(
        "| Request                            | Actual Action            | Rank | Mean Score | Median Score | Std Dev | Top Matches (Similarity)                                        |",
    );
    console.log(
        "|------------------------------------|--------------------------|------|------------|--------------|---------|-----------------------------------------------------------------|",
    );

    let csvContent =
        "Request,Actual Action,Rank,Mean Score,Median Score,Std Dev,Top Matches\n";
    fs.writeFileSync(statsfile, csvContent);

    let csvZeroRankContent =
        "Request,Actual Action,Rank,Mean Score,Median Score,Std Dev,Top Matches\n";

    if (zerorankStatsFile !== undefined) {
        fs.writeFileSync(zerorankStatsFile, csvZeroRankContent);
    }

    results.forEach((result: StatsResult) => {
        const {
            request,
            actualActionName,
            rank,
            matches,
            meanScore,
            medianScore,
            stdDevScore,
        } = result;

        const topMatches = matches
            .map(
                (match: any) =>
                    `${match.actionName} (${match.score.toFixed(2)})`,
            )
            .join(", ");

        let res: string = `| ${chalk.cyan(request.padEnd(34))} | ${chalk.yellow(
            actualActionName.padEnd(24),
        )} | ${chalk.green(rank.toFixed(2))}    | ${chalk.magenta(meanScore.toFixed(2))}     | ${chalk.magenta(
            medianScore.toFixed(2),
        )}       | ${chalk.magenta(stdDevScore.toFixed(2))}  | ${chalk.white(
            topMatches,
        )} |`;

        if (rank > 0) {
            console.log(res);
            csvContent += `"${request}",${actualActionName},${rank.toFixed(2)},${meanScore.toFixed(2)},${medianScore.toFixed(2)},${stdDevScore.toFixed(2)},"${topMatches}"\n`;
        } else {
            csvZeroRankContent += `"${request}",${actualActionName},${rank.toFixed(2)},${meanScore.toFixed(2)},${medianScore.toFixed(2)},${stdDevScore.toFixed(2)},"${topMatches}"\n`;
            console.log(`${chalk.red("**")} + ${res}`);
        }
    });

    fs.writeFileSync(statsfile, csvContent);
    if (zerorankStatsFile !== undefined) {
        fs.writeFileSync(zerorankStatsFile, csvZeroRankContent);
    }
}

export function saveStatsToFile(stats: StatsResult[], filePath: string) {
    const output = stats.map((result) => ({
        request: result.request,
        actualActionName: result.actualActionName,
        precision: result.precision,
        recall: result.recall,
        topMatches: result.matches.map(
            (match) => `${match.actionName} (${match.score.toFixed(2)})`,
        ),
    }));

    const fileContent = JSON.stringify(output, null, 2);
    fs.writeFileSync(filePath, fileContent);
}

export function processActionSchemaAndReqData(
    actionreqEmbeddingsFile: string,
    threshold: number = 0.7,
    statsfile: string,
    zerorankStatsFile: string | undefined,
) {
    const data: any[] = loadActionData(actionreqEmbeddingsFile);
    const results: any[] = generateStats(data, threshold);
    printDetailedMarkdownTable(
        results,
        statsfile,
        zerorankStatsFile?.toString(),
    );
}
