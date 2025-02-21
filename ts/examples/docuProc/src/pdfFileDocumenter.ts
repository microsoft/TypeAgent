// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import { Chunk } from "./pdfChunker.js";
import fs from "fs";


// Document an entire file and assign comments to chunks.

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
            return `data:image/png;base64,${imageBuffer.toString('base64')}`;
        } catch (error) {
            console.error(`Error converting image to base64: ${error}`);
            return "";
        }
    }

    async function document(chunks: Chunk[]): Promise<PdfFileDocumentation> {
        const pageChunksMap: Record<string, { pageChunk: Chunk; blocks: Chunk[] }> = {};
        
        // Organize chunks by page
        for (const chunk of chunks) {
            if (!chunk.parentId) {
                pageChunksMap[chunk.pageid] = { pageChunk: chunk, blocks: [] };
            }
        }

        // Associate blocks with their corresponding page
        for (const chunk of chunks) {
            if (chunk.parentId && pageChunksMap[chunk.pageid]) {
                pageChunksMap[chunk.pageid].blocks.push(chunk);
            }
        }

        for (const pageid in pageChunksMap) {
            const { pageChunk, blocks } = pageChunksMap[pageid];
            let text = `***: Document the following Page (Id: ${pageChunk.id}, Page: ${pageChunk.pageid}):\n`;
            
            let pageImageBase64 = "";
            const pageImageBlob = pageChunk.blobs.find(blob => blob.blob_type === "page_image" && blob.img_path);
            if (pageImageBlob) {
                pageImageBase64 = convertImageToBase64(pageImageBlob.img_path!);
                text += `Page Image: ${pageImageBase64}\n`;
            }
            
            for (const block of blocks) {
                const blockIdentifier = `Chunk Id: ${block.id}, Page: ${block.pageid}`;
                for (const blob of block.blobs) {
                    if (blob.blob_type === "text") {
                        text += `Text Content (${blockIdentifier}):\n`;
                        text += `[$Start:{blob.start+1}]: ${blob.content}\n`;
                    } else if (blob.blob_type === "table") {
                        text += `Table Data (${blockIdentifier}):\n`;
                        text += `CSV Path: ${blob.content}\n`;
                    } else if (blob.blob_type === "image") {
                        text += `Image (${blockIdentifier}):\n`;
                        text += `Image Path: ${blob.img_path}\n`;
                    }
                }
            }
            
            const request =
                "Summarize the given document sections based on the extracted content and page image.\n" +
                "For text, provide a concise summary of the main points.\n" +
                //"For tables, describe their contents and significance.\n" +
                "For images, infer their purpose based on the context. For page level image summarze for the entire page.\n" +
                "Include a high-level summary of the entire page based on the extracted image and paragraph level text.\n" +
                "Also fill in the lists of keywords, tags, synonyms, and dependencies.\n";
            
            const result = await pdfDocTranslator.translate(request, text);
            
            if (result.success) {
                const fileDocs: PdfFileDocumentation = result.data;
                const chunkDocs = fileDocs.chunkDocs ?? [];
                 
                let iDoc = 0;
                for (const chunk of chunks) {
                    if (chunk.parentId === "" && !chunk.parentId || chunk.children.length === 0) {
                        chunk.docs = chunkDocs[iDoc++];
                    }
                    else {
                        for (const blobid of chunk.children) {
                            const blob = chunk.children.find(cid => cid === blobid);
                            if (blob !== undefined) {
                                chunk.docs = chunkDocs[iDoc++];
                            }
                        }
                    }
                }
                
            } else {
            }
        }
        return { chunkDocs: chunks.map(chunk => chunk.docs) } as PdfFileDocumentation;
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
