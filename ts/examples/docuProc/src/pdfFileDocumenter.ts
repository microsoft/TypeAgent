// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import {
    createJsonTranslator,
    PromptSection,
    MultimodalPromptContent,
    TypeChatJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import { Blob, Chunk } from "./pdfChunker.js";
import fs from "fs";

export interface PdfFileDocumenter {
    document(fileName: string, chunks: Chunk[]): Promise<PdfFileDocumentation>;
}

export function createPdfDocumenter(model: ChatModel): PdfFileDocumenter {
    const pdfDocTranslator = createPdfFileDocTranslator(model);
    const base64ImageCache: Record<string, string> = {};

    return {
        document,
    };

    function getImagePromptSection(
        imgChunkId: string,
        imgBlob: Blob,
    ): MultimodalPromptContent[] {
        const content: MultimodalPromptContent[] = [];
        if (imgBlob && imgBlob.img_path) {
            const base64 = getBase64IfNeeded(imgBlob.img_path);
            content.push({
                type: "text",
                text: `Base64 encoded Image:\n`,
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

    async function document(
        fileName: string,
        chunks: Chunk[],
    ): Promise<PdfFileDocumentation> {
        // Organize chunks by page
        const pageChunksMap: Record<
            string,
            { pageRootChunk: Chunk; pageChunks: Chunk[] }
        > = {};

        for (const chunk of chunks) {
            if (!chunk.parentId) {
                pageChunksMap[chunk.pageid] = {
                    pageRootChunk: chunk,
                    pageChunks: [],
                };
            }
        }
        // Associate child chunks with pages
        for (const chunk of chunks) {
            if (chunk.parentId && pageChunksMap[chunk.pageid]) {
                pageChunksMap[chunk.pageid].pageChunks.push(chunk);
            }
        }

        let maxPagesToProcess = 3;
        // Process each page
        let pageCount = 0;
        for (const pageid in pageChunksMap) {
            let content: MultimodalPromptContent[] = [];
            pageCount++;
            const { pageRootChunk, pageChunks } = pageChunksMap[pageid];

            // Build the prompt text for this page
            content.push({
                type: "text",
                text: `***: Document chunks of Page (Id: ${pageRootChunk.id}, Page: ${pageRootChunk.pageid}):\n`,
            });

            // Summarize each child chunk
            for (const chunk of pageChunks) {
                const chunkIdentifier = chunk.id;
                content.push({
                    type: "text",
                    text: `Summarize chunk id:(${chunkIdentifier})\n`,
                });
                for (const blob of chunk.blobs) {
                    if (blob.blob_type === "text") {
                        content.push({
                            type: "text",
                            text:
                                `Summarize text paragraph:\n` +
                                `${blob.content}`,
                        });
                    } else if (blob.blob_type === "image_label") {
                        content.push({
                            type: "text",
                            text: `Summarize image and labels content:\n`,
                        });

                        let chunk_labels = "";
                        if (Array.isArray(blob.content)) {
                            chunk_labels += `Label: ${blob.content.join("\n")}\n`; // Join array elements with newlines
                        } else {
                            chunk_labels += `Label: ${blob.content}\n`; // Directly append if it's a string
                        }

                        content.push({
                            type: "text",
                            text: `Associated label(s):\n` + `${chunk_labels}`,
                        });

                        // Embed the images references in the prompt
                        if (blob.image_chunk_ref) {
                            content.push({
                                type: "text",
                                text: `Associated image(s):\n`,
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
                                        const imagePromptSection =
                                            getImagePromptSection(
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
                            text: `Summarize the image:\n`,
                        });

                        const imagePromptSection = getImagePromptSection(
                            chunkIdentifier,
                            blob,
                        );
                        content.push(...imagePromptSection);
                    }
                }
            }

            // Append request to summarize entire page based on the chunks above
            content.push({
                type: "text",
                text: `Summarize the entire page (${pageRootChunk.pageid}) based on the chunks above. Page root chunk id:(${pageRootChunk.id}).\n
                Create the summary based on the text and image contents of chunks of the page above. Extract the summary, keywords, tags and document information which
                should be a union of the documnent info(s) of other child chunks\n`,
            });

            // Build request for the LLM
            const request = `
Summarize the given document chunks based on text, images content and associated images. Every chunks has a unique id.
Provide documentation for every chunk. For text, provide a concise summary of the main points.
For images, infer purpose based on the context and describe the contents of the image, with cohesive explantion.
Also fill in: section name, keywords, tags, synonyms, and document information of the chunk if available. 
The document information should be extracted from the chunk. Every chunk should be documented.
For each chunk, the summary should contain most five sentences that covers the main points.
Also document the root chunk which is for page. The root chunk doesn't have any content and no parentId.`;

            let promptSections: PromptSection[] = [
                { role: "user", content: content },
            ];

            const result = await pdfDocTranslator.translate(
                request,
                promptSections,
            );
            if (result.success) {
                const fileDocs: PdfFileDocumentation = result.data;
                const chunkDocs = fileDocs.chunkDocs ?? [];

                const pageDoc = chunkDocs.find(
                    (doc) => doc.chunkid === pageRootChunk.id,
                );
                if (pageDoc !== undefined) {
                    pageRootChunk.chunkDoc = pageDoc;
                }

                for (const chunk of pageChunks) {
                    chunk.fileName = fileName;
                    const chunkDoc = chunkDocs.find(
                        (doc) => doc.chunkid === chunk.id,
                    );
                    if (chunkDoc) {
                        chunk.chunkDoc = chunkDoc;
                    }
                }
            } else {
                console.error(
                    `Error in documenter: ${result.message} for pageId: ${pageid}`,
                );
            }

            if (pageCount >= maxPagesToProcess) {
                break;
            }
        }

        return {
            chunkDocs: chunks.map((c) => c.chunkDoc),
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
