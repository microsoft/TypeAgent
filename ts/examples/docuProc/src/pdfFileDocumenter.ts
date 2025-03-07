// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import { Chunk } from "./pdfChunker.js";
import fs from "fs";

export interface PdfFileDocumenter {
    document(chunks: Chunk[]): Promise<PdfFileDocumentation>;
}

export function createPdfDocumenter(model: ChatModel): PdfFileDocumenter {
    const pdfDocTranslator = createPdfFileDocTranslator(model);
    return {
        document,
    };

    function convertImageToBase64(imagePath: string): string {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            return `data:image/png;base64,${imageBuffer.toString("base64")}`;
        } catch (error) {
            console.error(`Error converting image to base64: ${error}`);
            return "";
        }
    }

    async function document(chunks: Chunk[]): Promise<PdfFileDocumentation> {
        const base64ImageCache: Record<string, string> = {};
        function getBase64IfNeeded(imagePath: string): string {
            if (base64ImageCache[imagePath]) {
                return base64ImageCache[imagePath];
            }
            const base64 = convertImageToBase64(imagePath);
            base64ImageCache[imagePath] = base64;
            return base64;
        }

        // Organize chunks by page
        const pageChunksMap: Record<
            string,
            { pageChunk: Chunk; blocks: Chunk[] }
        > = {};
        for (const chunk of chunks) {
            if (!chunk.parentId) {
                pageChunksMap[chunk.pageid] = { pageChunk: chunk, blocks: [] };
            }
        }

        // Associate child chunks with pages
        for (const chunk of chunks) {
            if (chunk.parentId && pageChunksMap[chunk.pageid]) {
                pageChunksMap[chunk.pageid].blocks.push(chunk);
            }
        }

        let maxPagesToProcess = 3;

        // Process each page
        let pageCount = 0;
        for (const pageid in pageChunksMap) {
            pageCount++;
            const { pageChunk, blocks } = pageChunksMap[pageid];

            // Build the prompt text for this page
            let text = `***: Document Page (Id: ${pageChunk.id}, Page: ${pageChunk.pageid}):\n`;

            // For each block/child chunk
            for (const block of blocks) {
                const blockIdentifier = `Chunk Id: ${block.id}, Page: ${block.pageid}`;

                // Check each blob
                for (const blob of block.blobs) {
                    if (blob.blob_type === "text") {
                        // Text processing
                        text += `Text Content (${blockIdentifier}):\n`;
                        text += `[Start:${blob.start + 1}]: ${blob.content}\n`;
                    } else if (blob.blob_type === "image_label") {
                        // Image label logic
                        text += `Image Label (${blockIdentifier}):\n`;
                        text += `Label: ${blob.content}\n`;

                        // If references images, embed them
                        if (blob.image_chunk_ref) {
                            for (const imgChunkId of blob.image_chunk_ref) {
                                const imgChunk = chunks.find(
                                    (ch) => ch.id === imgChunkId,
                                );
                                if (imgChunk) {
                                    // We expect exactly one 'image' blob inside that chunk
                                    const imageBlob = imgChunk.blobs.find(
                                        (b) =>
                                            b.blob_type === "image" &&
                                            b.img_path,
                                    );
                                    if (imageBlob && imageBlob.img_path) {
                                        // Check cache
                                        const base64 = getBase64IfNeeded(
                                            imageBlob.img_path,
                                        );
                                        text += `Associated Image (Chunk ${imgChunkId}): ${base64}\n`;
                                    }
                                }
                            }
                        }
                    } else if (blob.blob_type === "image" && blob.img_path) {
                        // Image chunk that might not be referenced by an image_label
                        text += `Image (${blockIdentifier}):\n`;
                        const base64 = getBase64IfNeeded(blob.img_path);
                        text += `Base64 encoded image: ${base64}\n`;
                    }
                }
            }

            // Build request for the LLM
            const request = `
                Summarize the given document sections based on text, images content and associated images.
                For text, provide a concise summary of the main points.
                For images, infer purpose based on the context.
                Also fill in lists: keywords, tags, synonyms, and dependencies.
            `;

            // Send to LLM
            const result = await pdfDocTranslator.translate(request, text);
            if (result.success) {
                const fileDocs: PdfFileDocumentation = result.data;
                const chunkDocs = fileDocs.chunkDocs ?? [];

                const pageAndBlocks = [pageChunk, ...blocks];

                let iDoc = 0;
                for (const c of pageAndBlocks) {
                    if (iDoc >= chunkDocs.length) break;
                    if (
                        (c.parentId === "" && !c.parentId) ||
                        (c.children && c.children.length === 0)
                    ) {
                        c.docs = chunkDocs[iDoc++];
                    } else if (c.children && c.children.length > 0) {
                        // assign docs to its children
                        for (const childId of c.children) {
                            if (iDoc >= chunkDocs.length) break;
                            const childChunk = pageAndBlocks.find(
                                (blk) => blk.id === childId,
                            );
                            if (childChunk) {
                                childChunk.docs = chunkDocs[iDoc++];
                            }
                        }
                    }
                }
            } else {
                // handle error if needed
            }

            if (pageCount >= maxPagesToProcess) {
                break; // Limit processing to a certain number of pages
            }
        }

        return {
            chunkDocs: chunks.map((c) => c.docs),
        } as PdfFileDocumentation;
    }
}

function createPdfFileDocTranslator(
    model: ChatModel,
): TypeChatJsonTranslator<PdfFileDocumentation> {
    const typeName = "PdfFileDocumentation";
    const schema = loadSchema(["pdfDocChunkSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<PdfFileDocumentation>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<PdfFileDocumentation>(
        model,
        validator,
    );
    return translator;
}
