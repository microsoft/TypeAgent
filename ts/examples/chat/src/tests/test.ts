// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import chalk from "chalk";
import { bing, getBlob, openai } from "aiclient";
import {
    NormalizedEmbedding,
    generateNotes,
    dateTime,
    dotProduct,
    euclideanLength,
    normalizeInPlace,
    writeBlobFile,
    generateNotesForWebPage,
    createSemanticList,
    collections,
} from "typeagent";
import * as path from "path";
import { getData } from "typechat";
//import { testStringTables } from "./testSql.js";
//import { runKnowledgeTests } from "./knowledgeTests.js";

export function func1(x: number, y: number, op: string): number {
    switch (op) {
        default:
            throw Error(`Unknown operator: ${op}`);
        case "+":
            return x + y;
        case "-":
            return x - y;
        case "*":
            return x * y;
        case "/":
            return x / y;
        case "^":
            return x ^ y;
        case "%":
            return x % y;
    }
}

function generateRandomEmbedding(length: number): NormalizedEmbedding {
    const embedding = new Float32Array(length);
    for (let i = 0; i < length; ++i) {
        embedding[i] = Math.random();
    }
    normalizeInPlace(embedding);
    return embedding;
}

// Test embeddings written to file with a wrapper object
export async function testEmbedding() {
    const filePath = "/data/test/foo.txt";
    const e1 = generateRandomEmbedding(1536);
    console.log(euclideanLength(e1));
    let json = dateTime.stringifyTimestamped(e1);
    await fs.promises.writeFile(filePath, json);
    json = await fs.promises.readFile(filePath, "utf-8");
    const j2: dateTime.Timestamped<NormalizedEmbedding> =
        dateTime.parseTimestamped(json);

    let score = dotProduct(e1, j2.value);
    console.log(score);
}

// Test raw embedding buffer
export async function testEmbedding2() {
    const filePath = "/data/test/foo.dat";
    const e1 = generateRandomEmbedding(1536);
    await fs.promises.writeFile(filePath, e1);
    const e2Buf = await fs.promises.readFile(filePath);
    const e2 = new Float32Array(e2Buf.buffer);
    dotProduct(e1, e2);
}

export async function testEmbeddingModel() {
    const model = openai.createEmbeddingModel();
    const result = await model.generateEmbedding("lunch meeting");
    console.log(result.success);

    const strings = [
        "lunch meeting",
        "pick up groceries",
        "The quick brown fox",
        "Who is a good dog?",
        "I am so very hungry for pizza",
    ];
    for (const str of strings) {
        const e = await model.generateEmbedding(str);
        if (e.success) {
            console.log("Success");
        }
    }

    const list = createSemanticList<string>(model, undefined, (value) => value);
    for (const str of strings) {
        await list.push(str);
    }

    const match = await list.nearestNeighbor("pizza");
    console.log(match);
}

export function generateMessageLines(count: number): string[] {
    let lines: string[] = [];
    for (let i = 0; i < count; ++i) {
        lines.push("message_" + i.toString());
    }
    return lines;
}

export async function summarize() {
    const text = await fs.promises.readFile("C:/data/longText.txt", {
        encoding: "utf-8",
    });
    console.log(chalk.greenBright(`Total:${text.length}\n`));
    const result = await generateNotes(
        text,
        2048,
        openai.createChatModel(),
        (chunk, text) => {
            console.log(chalk.greenBright(`${text.length} of ${chunk.length}`));
            console.log("Output\n\n" + text + "\n");
        },
    );
    console.log(result);
}

export async function testBingSummary() {
    const model = openai.createChatModel();
    const results = await bing.searchWeb("Sherlock Holmes", 3);
    for (const result of results) {
        let chunkNumber = 0;
        const summary = await generateNotesForWebPage(
            model,
            result.url,
            1024 * 16,
            () => {
                ++chunkNumber;
                console.log(`Chunk:${chunkNumber}`);
            },
        );
        console.log(summary);
    }
}

export async function testBingImageSearch() {
    const dirPath = "/data/test";
    if (!fs.existsSync(dirPath)) {
        await fs.promises.mkdir(dirPath);
    }
    const results = await bing.searchImages("Sherlock Holmes", 3);
    for (const result of results) {
        console.log(result.contentUrl);
        const imageData = getData(await getBlob(result.contentUrl));
        const url = new URL(result.contentUrl);
        const filepath = path.join(dirPath, path.basename(url.pathname));
        await writeBlobFile(filepath, imageData);
    }
}

export function testCircularArray() {
    const buffer = new collections.CircularArray<number>(4);
    for (let i = 0; i < 10; ++i) {
        buffer.push(i);
    }
    for (let i = 0; i < buffer.length; ++i) {
        console.log(buffer.get(i));
    }
    console.log(buffer.length);
    console.log([...buffer]);
}

export async function runTestCases(): Promise<void> {
    testCircularArray();
    await testEmbedding();
    await testEmbeddingModel();
    await testBingSummary();
    await testBingImageSearch();
    // await testFetch();
}

export async function runTests(): Promise<void> {
    //await testStringTables();
    //await runTestCases();
    // await runKnowledgeTests();
}
