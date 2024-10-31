import * as fs from "fs";
import chalk from "chalk";

import { similarity, SimilarityType } from "typeagent";

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

function calculatePrecisionRecall(data: any[], threshold: number = 0.8) {
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
                score: similarity(
                    action.embedding,
                    requestEmbedding,
                    SimilarityType.Cosine,
                ),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3); // Get top 3 matches

        const topMatch = matches[0];
        const TP =
            topMatch &&
            topMatch.actionName === actualActionName &&
            topMatch.score >= threshold
                ? 1
                : 0;
        const FP = 1 - TP;
        const FN = topMatch && topMatch.score < threshold ? 1 : 0;

        const precision = TP / (TP + FP);
        const recall = TP / (TP + FN);

        return { request, actualActionName, precision, recall, matches };
    });

    return results;
}

function printDetailedMarkdownTable(results: any[]) {
    console.log(
        chalk.bold("\n## Precision and Recall with Global Request Matches\n"),
    );
    console.log(
        "| Request                            | Actual Action            | Precision | Recall | Top Matches (Similarity)                                        |",
    );
    console.log(
        "|------------------------------------|--------------------------|-----------|--------|-----------------------------------------------------------------|",
    );

    results.forEach((result: any) => {
        const { request, actualActionName, precision, recall, matches } =
            result;

        const topMatches = matches
            .map(
                (match: any) =>
                    `${match.actionName} (${match.score.toFixed(2)})`,
            )
            .join(", ");

        console.log(
            `| ${chalk.cyan(request.padEnd(34))} | ${chalk.yellow(actualActionName.padEnd(24))} | ${chalk.green(precision.toFixed(2))}    | ${chalk.blue(recall.toFixed(2))}   | ${chalk.white(topMatches)} |`,
        );
    });

    console.log();
}

export function processPrecisionRecall(
    filePath: string,
    threshold: number = 0.8,
) {
    const data = loadActionData(filePath);
    const results = calculatePrecisionRecall(data, threshold);
    printDetailedMarkdownTable(results);
}
