// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { PdfFileDocumentation } from "./pdfDocChunkSchema.js";
import { Chunk } from "./pdfChunker.js";

// For various reasons we want to index chunks separately,
// but we want to produce their documentation in the context of the whole file.
// FileDocumenter.document(chunks) produces documentation comments
// and then assigns each comment to the appropriate chunk.

// Document an entire file and assign comments to chunks.

export interface FileDocumenter {
    document(chunks: Chunk[]): Promise<PdfFileDocumentation>;
}

export function createFileDocumenter(model: ChatModel): FileDocumenter {
    const fileDocTranslator = createFileDocTranslator(model);
    return {
        document,
    };

    async function document(chunks: Chunk[]): Promise<PdfFileDocumentation> {
        let text = "";
        for (const chunk of chunks) {
            text += `***: Docmument the following ${chunk.treeName}:\n`;
            for (const blob of chunk.blobs) {
                for (let i = 0; i < blob.lines.length; i++) {
                    text += `[${blob.start + i + 1}]: ${blob.lines[i]}\n`;
                }
            }
        }
        const request =
            "Document the given Python code, its purpose, and any relevant details.\n" +
            "The code has (non-contiguous) line numbers, e.g.: `[1]: def foo():`\n" +
            "There are also marker lines, e.g.: `***: Document the following FuncDef`\n" +
            "Write a concise paragraph for EACH marker.\n" +
            "For example, the comment could be:\n" +
            "```\n" +
            "Method C.foo finds the most twisted anagram for a word.\n" +
            "It uses various heuristics to rank a word's twistedness'.\n" +
            "```\n" +
            "Also fill in the lists of keywords, tags, synonyms, and dependencies.\n";
        const result = await fileDocTranslator.translate(request, text);

        // Now assign each comment to its chunk.
        if (result.success) {
            const fileDocs: PdfFileDocumentation = result.data;
            // Assign each comment to its chunk.
            for (const chunkDoc of fileDocs.chunkDocs ?? []) {
                console.log(chunkDoc.name);
                for (const chunk of chunks) {
                    for (const blob of chunk.blobs) {

                        console.log(blob);
                        // Reminder: blob.start is 0-based, comment.lineNumber is 1-based.
                        /*if (
                            !blob.breadcrumb &&
                            blob.start < chunkDoc.lineNumber &&
                            chunkDoc.lineNumber <=
                                blob.start + blob.lines.length
                        ) {
                            const chunkDocs = chunk?.docs?.chunkDocs ?? [];
                            chunkDocs.push(chunkDoc);
                            chunk.docs = { chunkDocs };
                        }*/
                    }
                }
            }
            return fileDocs;
        } else {
            throw new Error(result.message);
        }
    }
}

function createFileDocTranslator(
    model: ChatModel,
): TypeChatJsonTranslator<PdfFileDocumentation> {
    const typeName = "FileDocumentation";
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
