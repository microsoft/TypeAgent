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
import path from "path";

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
        const baseName = path.basename(fileName);
        const extName = path.extname(fileName);
        const codeName = baseName.slice(0, -extName.length || undefined);
        const rootChunk: Chunk = {
            chunkId: generate_id(),
            treeName: "file",
            codeName,
            blobs: [],
            parentId: "",
            children: [],
            fileName,
        };
        const chunks: Chunk[] = [rootChunk];
        const sourceFile: ts.SourceFile = await tsCode.loadSourceFile(fileName);

        // TODO: Also do nested functions, and classes, and interfaces, and modules.
        // TODO: For nested things, remove their text from the parent.
        function getFunctionsAndClasses(): (
            | ts.FunctionDeclaration
            | ts.ClassDeclaration
        )[] {
            return tsCode.getStatements(
                sourceFile,
                (s) => ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s),
            );
        }

        const things = getFunctionsAndClasses();
        for (const thing of things) {
            const treeName = ts.SyntaxKind[thing.kind];
            const codeName = tsCode.getStatementName(thing) ?? "";
            // console.log(`  ${treeName}: ${codeName}`);
            try {
                // console.log(
                //     "--------------------------------------------------------",
                // );
                // console.log(`Name: ${thing.name?.escapedText}`);
                // console.log(
                //     `Parameters: ${thing.parameters.map((p) => p.name?.getFullText(sourceFile))}`,
                // );
                // console.log(`Return type: ${thing.type?.getText(sourceFile)}`);

                const chunk: Chunk = {
                    chunkId: generate_id(),
                    treeName,
                    codeName,
                    blobs: makeBlobs(
                        sourceFile,
                        thing.getFullStart(),
                        thing.getEnd(),
                    ),
                    parentId: rootChunk.chunkId,
                    children: [],
                    fileName,
                };
                chunks.push(chunk);
            } catch (e: any) {
                results.push({
                    error: `${thing.name?.escapedText}: ${e.message}`,
                    filename: fileName,
                });
            }
        }
        // console.log("========================================================");
        const chunkedFile: ChunkedFile = {
            fileName,
            chunks,
        };
        results.push(chunkedFile);
    }

    return results;
}

function makeBlobs(
    sourceFile: ts.SourceFile,
    startPos: number,
    endPos: number,
): Blob[] {
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
    // Trim trailing empty lines.
    while (lines && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    // console.log(lines.slice(0, 3), "...", lines.slice(-3));
    if (!lines.length) {
        return [];
    }
    const blob: Blob = {
        start: startLoc.line, // 0-based
        lines,
    };
    return [blob];
}

// This is actually sample input for the chunker. :-)
export class Testing {
    public static async main() {
        const fileNames = [
            "./packages/agents/spelunker/src/typescriptChunker.ts",
            "./packages/agents/spelunker/src/spelunkerSchema.ts",
            "./packages/agents/spelunker/src/makeSummarizeSchema.ts",
            "./packages/codeProcessor/src/tsCode.ts",
            "./packages/agents/spelunker/src/pythonChunker.ts",
        ];
        const results = await chunkifyTypeScriptFiles(fileNames);
        console.log(JSON.stringify(results, null, 2));
    }
}
