// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ts from "typescript";

import { tsCode } from "code-processor";

import {
    Blob,
    Chunk,
    ChunkId,
    ChunkedFile,
    ChunkerErrorItem,
} from "./chunkSchema.js";

let last_ts = Date.now() * 1000;
export function generate_id(): ChunkId {
    let next_ts = Date.now() * 1000;
    if (next_ts <= last_ts) {
        next_ts = last_ts + 1;
    }
    last_ts = next_ts;
    return (next_ts * 0.000001).toFixed(6);
}

export async function chunkifyTypeScriptFiles(
    fileNames: string[],
): Promise<(ChunkedFile | ChunkerErrorItem)[]> {
    // console.log("========================================================");
    const results: (ChunkedFile | ChunkerErrorItem)[] = [];
    for (const fileName of fileNames) {
        // console.log(fileName);
        const chunks: Chunk[] = [];
        const chunkedFile: ChunkedFile = {
            fileName,
            chunks,
        };
        const sourceFile: ts.SourceFile = await tsCode.loadSourceFile(fileName);
        // TODO: Also do nested functions, and classes, and modules.
        // TODO: For nested things, remove their text from the parent.
        const functions: ts.FunctionDeclaration[] =
            tsCode.getFunctions(sourceFile); // TODO: Also get nested functions.
        for (const func of functions) {
            try {
                // console.log(
                //     "--------------------------------------------------------",
                // );
                // console.log(`Name: ${func.name?.escapedText}`);
                // console.log(
                //     `Parameters: ${func.parameters.map((p) => p.name?.getFullText(sourceFile))}`,
                // );
                // console.log(`Return type: ${func.type?.getText(sourceFile)}`);

                const chunk: Chunk = {
                    chunkId: generate_id(),
                    treeName: "function",
                    codeName: func.name?.escapedText ?? "",
                    blobs: [
                        makeBlob(
                            sourceFile,
                            func.getFullStart(),
                            func.getEnd(),
                        ),
                    ],
                    parentId: "",
                    children: [],
                    fileName,
                };
                chunks.push(chunk);
            } catch (e: any) {
                console.log(
                    `Error picking apart ${func.name}: ${fileName}: ${e.message}`,
                );
            }
        }
        // console.log("========================================================");
        results.push(chunkedFile);
    }

    return results;
}

function makeBlob(
    sourceFile: ts.SourceFile,
    startPos: number,
    endPos: number,
): Blob {
    const text = sourceFile.text;
    const lineStarts = sourceFile.getLineStarts(); // TODO: Move to caller?
    let startLoc = sourceFile.getLineAndCharacterOfPosition(startPos);
    const endLoc = sourceFile.getLineAndCharacterOfPosition(endPos);
    // console.log(
    //     `Start and end: ${startPos}=${startLoc.line + 1}:${startLoc.character}, ` +
    //         `${endPos}=${endLoc.line + 1}:${endLoc.character}`,
    // );
    while (!text.slice(startPos, lineStarts[startLoc.line + 1]).trim()) {
        startPos = lineStarts[startLoc.line + 1];
        startLoc = sourceFile.getLineAndCharacterOfPosition(startPos);
    }
    // console.log(
    //     `Updated start: ${startPos}=${startLoc.line + 1}:${startLoc.character}`,
    // );
    const lines: string[] = [];
    for (let i = startLoc.line; i <= endLoc.line; i++) {
        const line = text.slice(lineStarts[i], lineStarts[i + 1]);
        lines.push(line);
    }
    // console.log(lines.slice(0, 3), "...", lines.slice(-3));
    const blob: Blob = {
        start: startLoc.line, // 0-based
        lines,
    };
    return blob;
}
