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
        chunks.push(...recursivelyChunkify(sourceFile, rootChunk));
        const chunkedFile: ChunkedFile = {
            fileName,
            chunks,
        };
        results.push(chunkedFile);

        function recursivelyChunkify(
            parentNode: ts.Node,
            parentChunk: Chunk,
        ): Chunk[] {
            const chunks: Chunk[] = [];
            for (const childNode of parentNode.getChildren(sourceFile)) {
                if (
                    ts.isInterfaceDeclaration(childNode) ||
                    ts.isTypeAliasDeclaration(childNode) ||
                    ts.isFunctionDeclaration(childNode) ||
                    ts.isClassDeclaration(childNode)
                ) {
                    // console.log(
                    //     ts.SyntaxKind[childNode.kind],
                    //     tsCode.getStatementName(childNode),
                    // );
                    const chunk: Chunk = {
                        chunkId: generate_id(),
                        treeName: ts.SyntaxKind[childNode.kind],
                        codeName: tsCode.getStatementName(childNode) ?? "",
                        blobs: makeBlobs(
                            sourceFile,
                            childNode.getFullStart(),
                            childNode.getEnd(),
                        ),
                        parentId: parentChunk.chunkId,
                        children: [],
                        fileName,
                    };
                    // TODO: Remove chunk.blobs from parentChunk.blobs.
                    chunks.push(chunk);
                    recursivelyChunkify(childNode, chunk);
                } else {
                    recursivelyChunkify(childNode, parentChunk);
                }
            }
            return chunks;
        }
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
