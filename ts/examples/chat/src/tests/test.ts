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
    collections,
    readAllText,
    dotProductSimple,
    createSemanticMap,
    generateEmbedding,
    asyncArray,
} from "typeagent";
import * as path from "path";
import { getData } from "typechat";
import { StopWatch } from "interactive-app";
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
    const stopWatch = new StopWatch();
    const model = openai.createEmbeddingModel();

    stopWatch.start();
    let result = await model.generateEmbedding("lunch meeting");
    stopWatch.stop();
    console.log(result.success);
    console.log(stopWatch.elapsedMs);

    for (let i = 0; i < 3; ++i) {
        const medText = await readAllText("/data/test/medText.txt");
        stopWatch.start();
        result = await model.generateEmbedding(medText);
        stopWatch.stop();
        console.log(result.success);
        console.log(stopWatch.elapsedMs);
    }

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
}

export async function testEmbeddingBasic() {
    const model = openai.createEmbeddingModel();

    const strings = ["object", "instrument", "person", "food", "pizza"];
    for (const str of strings) {
        const e = await model.generateEmbedding(str);
        if (e.success) {
            console.log("Success");
        }
    }
}

export async function testSemanticMap() {
    const strings = [
        "lunch meeting",
        "pick up groceries",
        "The quick brown fox",
        "Who is a good dog?",
        "I am so very hungry for pizza",
    ];
    const model = openai.createEmbeddingModel();
    const sm = await createSemanticMap<number>(model);
    for (let i = 0; i < strings.length; ++i) {
        await sm.set(strings[i], i);
    }
    let match = await sm.getNearest("Toto is a good dog");
    console.log(match);

    match = await sm.getNearest("pepperoni and margarhita");
    console.log(match);

    match = await sm.getNearest("we should meet up for lunch");
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
    const text = await fs.promises.readFile("C:/data/test/longText.txt", {
        encoding: "utf-8",
    });
    console.log(chalk.greenBright(`Total:${text.length}\n`));
    const result = await generateNotes(
        text,
        2048,
        openai.createChatModelDefault("chatTests"),
        (chunk, text) => {
            console.log(chalk.greenBright(`${text.length} of ${chunk.length}`));
            console.log("Output\n\n" + text + "\n");
        },
    );
    console.log(result);
}

export async function testBingSummary() {
    const model = openai.createChatModelDefault("chatTests");
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

export function testDotPerf() {
    const x = generateRandomEmbedding(1536);
    const y = generateRandomEmbedding(1536);
    const count = 1000;

    if (dotProduct(x, y) !== dotProductSimple(x, y)) {
        console.log("Bug");
        return;
    }
    let sum = 0;
    console.log("==dot==");
    console.time("dot");
    for (let i = 0; i < count; ++i) {
        sum += dotProduct(x, y);
    }
    console.timeEnd("dot");
    console.log(sum);

    sum = 0;
    console.log("==dotSimple==");
    console.time("dotSimple");
    for (let i = 0; i < count; ++i) {
        sum += dotProductSimple(x, y);
    }
    console.timeEnd("dotSimple");
    console.log(sum);
}

export function testDotPerf2(size: number) {
    const x = generateRandomEmbedding(size);
    let vectors: NormalizedEmbedding[] = [];
    for (let i = 0; i <= 1000; ++i) {
        vectors.push(generateRandomEmbedding(size));
    }

    let len = vectors.length;
    console.log(`RUNNING ${len} vectors`);
    console.log("==dot==");
    console.time("dot");
    let sum = 0;
    for (let i = 0; i < len; ++i) {
        sum += dotProduct(x, vectors[i]);
    }
    console.timeEnd("dot");
    console.log(sum);
    console.log("==dotSimple==");

    sum = 0;
    console.time("dotSimple");
    for (let i = 0; i < len; ++i) {
        sum += dotProductSimple(x, vectors[i]);
    }
    console.timeEnd("dotSimple");
    console.log(sum);
}

export type DataType = string | number;

export function testTypes<TKey extends DataType, TValue extends DataType>() {
    if (typeof (undefined as any as TKey) === "string") {
        console.log("key string");
    } else {
        console.log("key number");
    }

    if (typeof (undefined as any as TValue) === "string") {
        console.log("value string");
    } else {
        console.log("value number");
    }
}

export async function testPerf() {
    testDotPerf();
    testDotPerf2(1536);
}

export async function loadTestEmbeddings() {
    const text = "The quick brown fox did something something";
    const model = openai.createEmbeddingModel();
    const texts: string[] = new Array(10000);
    texts.fill(text);
    await asyncArray.forEachAsync(texts, 4, async (t, i) => {
        const stopWatch = new StopWatch();
        stopWatch.start();
        await generateEmbedding(model, t);
        stopWatch.stop();
        console.log(`${i} / ${stopWatch.elapsedString()}`);
    });
}

export async function runTests(): Promise<void> {
    //await loadTestEmbeddings();
    //await testSemanticMap();
    //await testEmbeddingModel();
    //await runTestCases();
    // await runKnowledgeTests();
    //await testPerf();
    //testTypes<number, string>();
}
