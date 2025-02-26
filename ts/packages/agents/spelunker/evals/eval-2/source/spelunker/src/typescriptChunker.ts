// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";

import ts from "typescript";

import { tsCode } from "code-processor";

import {
    Blob,
    Chunk,
    ChunkId,
    ChunkedFile,
    ChunkerErrorItem,
} from "./chunkSchema.js";
import { console_log } from "./logging.js";

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
    // console_log("========================================================");
    const results: (ChunkedFile | ChunkerErrorItem)[] = [];
    for (const fileName of fileNames) {
        // console_log(fileName);
        const sourceFile: ts.SourceFile = await tsCode.loadSourceFile(fileName);

        const baseName = path.basename(fileName);
        const extName = path.extname(fileName);
        const codeName = baseName.slice(0, -extName.length || undefined);
        const blob: Blob = {
            start: 0,
            lines: sourceFile.text.match(/.*(?:\r?\n|$)/g) || [],
        };
        while (blob.lines.length && !blob.lines[0].trim()) {
            blob.lines.shift();
            blob.start++;
        }
        const blobs: Blob[] = [blob];
        const lineNo = blobs.length ? blobs[0].start + 1 : 1;
        const rootChunk: Chunk = {
            chunkId: generate_id(),
            treeName: "file",
            codeName,
            blobs,
            parentId: "",
            children: [],
            fileName,
            lineNo,
        };
        const chunks: Chunk[] = [rootChunk];
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
                    // ts.isTypeAliasDeclaration(childNode) || // These are too small and numerous
                    ts.isFunctionDeclaration(childNode) ||
                    ts.isClassDeclaration(childNode)
                ) {
                    // console_log(
                    //     ts.SyntaxKind[childNode.kind],
                    //     tsCode.getStatementName(childNode),
                    // );
                    const treeName = ts.SyntaxKind[childNode.kind];
                    const codeName = tsCode.getStatementName(childNode) ?? "";
                    const blobs = makeBlobs(
                        sourceFile,
                        childNode.getFullStart(),
                        childNode.getEnd(),
                    );
                    const lineNo = blobs.length ? blobs[0].start + 1 : 1;
                    const childChunk: Chunk = {
                        chunkId: generate_id(),
                        treeName,
                        codeName,
                        blobs,
                        parentId: parentChunk.chunkId,
                        children: [],
                        fileName,
                        lineNo,
                    };
                    spliceBlobs(parentChunk, childChunk);
                    chunks.push(childChunk);
                    chunks.push(...recursivelyChunkify(childNode, childChunk));
                } else {
                    chunks.push(...recursivelyChunkify(childNode, parentChunk));
                }
            }
            return chunks;
        }
    }

    return results;
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function spliceBlobs(parentChunk: Chunk, childChunk: Chunk): void {
    const parentBlobs = parentChunk.blobs;
    const childBlobs = childChunk.blobs;
    assert(parentBlobs.length > 0, "Parent chunk must have at least one blob");
    assert(childBlobs.length === 1, "Child chunk must have exactly one blob");
    const parentBlob = parentBlobs[parentBlobs.length - 1];
    const childBlob = childBlobs[0];
    assert(
        childBlob.start >= parentBlob.start,
        "Child blob must start after parent blob",
    );
    assert(
        childBlob.start + childBlob.lines.length <=
            parentBlob.start + parentBlob.lines.length,
        "Child blob must end before parent blob",
    );

    const linesBefore = parentBlob.lines.slice(
        0,
        childBlob.start - parentBlob.start,
    );
    const startBefore = parentBlob.start;
    while (linesBefore.length && !linesBefore[linesBefore.length - 1].trim()) {
        linesBefore.pop();
    }

    let startAfter = childBlob.start + childBlob.lines.length;
    const linesAfter = parentBlob.lines.slice(startAfter - parentBlob.start);
    while (linesAfter.length && !linesAfter[0].trim()) {
        linesAfter.shift();
        startAfter++;
    }

    const blobs: Blob[] = [];
    if (linesBefore.length) {
        blobs.push({ start: startBefore, lines: linesBefore });
    }
    const sig: string = signature(childChunk);
    // console_log("signature", sig);
    if (sig) {
        blobs.push({
            start: childBlob.start,
            lines: [sig],
            breadcrumb: childChunk.chunkId,
        });
    }
    if (linesAfter.length) {
        blobs.push({ start: startAfter, lines: linesAfter });
    }
    parentChunk.blobs.splice(-1, 1, ...blobs);
}

function signature(chunk: Chunk): string {
    const firstLine = chunk.blobs[0]?.lines[0] ?? "";
    const indent = firstLine.match(/^(\s*)/)?.[0] || "";

    switch (chunk.treeName) {
        case "InterfaceDeclaration":
            return `${indent}interface ${chunk.codeName} ...`;
        case "TypeAliasDeclaration":
            return `${indent}type ${chunk.codeName} ...`;
        case "FunctionDeclaration":
            return `${indent}function ${chunk.codeName} ...`;
        case "ClassDeclaration":
            return `${indent}class ${chunk.codeName} ...`;
    }
    return "";
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
    if (startLoc.character) {
        // Adjust start: if in the middle of a line, move to start of next line.
        // This is still a heuristic that will fail e.g. with `; function ...`.
        // But we don't want to support that; a more likely scenario is:
        // ```
        // type A = ...; // comment
        // function ...
        // ```
        // Here getFullStart() points to the start of the comment on A,
        // but we must start at the function.
        startPos = lineStarts[startLoc.line + 1];
        startLoc = sourceFile.getLineAndCharacterOfPosition(startPos);
    }
    // console_log(
    //     `Start and end: ${startPos}=${startLoc.line + 1}:${startLoc.character}, ` +
    //         `${endPos}=${endLoc.line + 1}:${endLoc.character}`,
    // );
    while (!text.slice(startPos, lineStarts[startLoc.line + 1]).trim()) {
        startPos = lineStarts[startLoc.line + 1];
        startLoc = sourceFile.getLineAndCharacterOfPosition(startPos);
    }
    // console_log(
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
    // console_log(lines.slice(0, 3), "...", lines.slice(-3));
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
            "./packages/agents/spelunker/src/summarizerSchema.ts",
            "./packages/codeProcessor/src/tsCode.ts",
            "./packages/agents/spelunker/src/pythonChunker.ts",
        ];
        const results = await chunkifyTypeScriptFiles(fileNames);
        console_log(JSON.stringify(results, null, 2));
    }
}
