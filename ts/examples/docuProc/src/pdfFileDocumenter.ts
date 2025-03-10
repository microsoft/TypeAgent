// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, PromptSection, MultimodalPromptContent, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import { Blob, Chunk } from "./pdfChunker.js";
import fs from "fs";

export interface PdfFileDocumenter {
    document(chunks: Chunk[]): Promise<PdfFileDocumentation>;
}

export function createPdfDocumenter(model: ChatModel): PdfFileDocumenter {
    const pdfDocTranslator = createPdfFileDocTranslator(model);
    const base64ImageCache: Record<string, string> = {};

    return {
        document,
    };

    async function getImagePromptSection(imgChunkId: string, imgBlob : Blob): Promise<MultimodalPromptContent[]> {
        const content: MultimodalPromptContent[] = [];
        if (imgBlob && imgBlob.img_path) {
            const base64 = getBase64IfNeeded(
                imgBlob.img_path,
            );
            content.push({
                type: "text",
                text: `Base64 encoded Image imgBlob.img_name:\n`,
            });
            content.push({
                type: "image_url",
                image_url: {
                    url: base64,
                    detail: "high",
                },
            });

        }
        return content;
    }

    function convertImageToBase64(imagePath: string): string {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            return `data:image/png;base64,${imageBuffer.toString("base64")}`;
        } catch (error) {
            console.error(`Error converting image to base64: ${error}`);
            return "";
        }
    }

    function getBase64IfNeeded(imagePath: string): string {
        if (base64ImageCache[imagePath]) {
            return base64ImageCache[imagePath];
        }
        const base64 = convertImageToBase64(imagePath);
        base64ImageCache[imagePath] = base64;
        return base64;
    }

    async function document(chunks: Chunk[]): Promise<PdfFileDocumentation> {
        // Organize chunks by page
        const pageChunksMap: Record<
            string,
            { pageChunk: Chunk; chunks: Chunk[] }
        > = {};

        for (const chunk of chunks) {
            if (!chunk.parentId) {
                pageChunksMap[chunk.pageid] = { pageChunk: chunk, chunks: [] };
            }
        }
        // Associate child chunks with pages
        for (const chunk of chunks) {
            if (chunk.parentId && pageChunksMap[chunk.pageid]) {
                pageChunksMap[chunk.pageid].chunks.push(chunk);
            }
        }

        let maxPagesToProcess = 3;
        // Process each page
        let pageCount = 0;
        for (const pageid in pageChunksMap) {
            let content:MultimodalPromptContent[] = [];
            pageCount++;
            const { pageChunk, chunks } = pageChunksMap[pageid];

            // Build the prompt text for this page
            content.push({
                type: "text",
                text: `***: Document Page (Id: ${pageChunk.id}, Page: ${pageChunk.pageid}):\n`,
            });
            
            // For each block/child chunk
            for (const chunk of chunks) {
                const chunkIdentifier = chunk.id;
                for (const blob of chunk.blobs) {
                    if (blob.blob_type === "text") {
                        // Text processing
                        content.push({
                            type: "text",
                            text: `Summarize text of chunk id:(${chunkIdentifier})\n` + `${blob.content}`,
                        });
                    } else if (blob.blob_type === "image_label") {
                        content.push({
                            type: "text",
                            text: `Summarize image and labels content for Chunk Id: ${chunk.id}, Page: ${chunk.pageid}\n`,
                        });

                        let chunk_labels = "";
                        if (Array.isArray(blob.content)) {
                            chunk_labels += `Label: ${blob.content.join("\n")}\n`; // Join array elements with newlines
                        } else {
                            chunk_labels += `Label: ${blob.content}\n`; // Directly append if it's a string
                        }

                        content.push({
                            type: "text",
                            text: `Associated labels of chunk id:(${chunkIdentifier})\n` + `${chunk_labels}`,
                        });
                        
                        // Embed the images references in the prompt
                        if (blob.image_chunk_ref) {
                            content.push({
                                type: "text",
                                text: `Summarize images of chunk id:(${chunkIdentifier})\n`,
                            });
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
                                    if (imageBlob) {
                                        const imagePromptSection = await getImagePromptSection(
                                            imgChunkId,
                                            imageBlob,
                                        );
                                        content.push(...imagePromptSection);
                                    }
                                }
                            }
                        }
                    } else if (blob.blob_type === "image" && blob.img_path) {
                        content.push({
                            type: "text",
                            text: `Summarize the image contents of chunk id:(${chunkIdentifier})\n`,
                        });
                        getImagePromptSection(chunkIdentifier, blob).then((imagePromptSection) => {
                            content.push(...imagePromptSection);
                        });
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

            let promptSections: PromptSection[] = 
                            [
                                { role: "user", content: content }
                            ];
    
            const result = await pdfDocTranslator.translate(request, promptSections);
            if (result.success) {
                const fileDocs: PdfFileDocumentation = result.data;
                const chunkDocs = fileDocs.chunkDocs ?? [];

                const pageAndBlocks = [pageChunk, ...chunks];

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
