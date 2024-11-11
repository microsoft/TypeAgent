// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { CodeBlock, CodeDocumenter } from "code-processor";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { CodeDocumentation } from "./codeDocSchema.js";
import { Chunk } from "./pythonChunker.js";

// For various reasons we want to index chunks separately,
// but we want to produce their documentation in the context of the whole file.
// FileDocumenter.document(chunks) produces documentation comments
// and then assigns each comment to the appropriate chunk.
// createFaleCodeDocumenter() returns a CodeDocumenter that retrieves
// the pre-computed comments from the chunk's 'docs' field.

// Fake code documenter to pass to createCodeIndex.

// Document an entire file and assign comments to chunks.

export interface FileDocumenter {
    document(chunks: Chunk[]): Promise<CodeDocumentation>;
}

export function createFileDocumenter(model: ChatModel): FileDocumenter {
    const fileDocTranslator = createFileDocTranslator(model);
    return {
        document,
    };

    async function document(chunks: Chunk[]): Promise<CodeDocumentation> {
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
            "Also fill in the lists of keywords, topics, goals, and dependencies.\n";
        const result = await fileDocTranslator.translate(request, text);

        // Now assign each comment to its chunk.
        if (result.success) {
            const codeDocs: CodeDocumentation = result.data;
            // Assign each comment to its chunk.
            for (const chunk of chunks) {
                for (const comment of codeDocs.comments ?? []) {
                    for (const blob of chunk.blobs) {
                        // Reminder: blob.start is 0-based, comment.lineNumber is 1-based.
                        if (
                            !blob.breadcrumb &&
                            blob.start < comment.lineNumber &&
                            comment.lineNumber <= blob.start + blob.lines.length
                        ) {
                            const comments = chunk?.docs?.comments ?? [];
                            comments.push(comment);
                            chunk.docs = { comments };
                        }
                    }
                }
            }
            return codeDocs;
        } else {
            throw new Error(result.message);
        }
    }
}

function createFileDocTranslator(
    model: ChatModel,
): TypeChatJsonTranslator<CodeDocumentation> {
    const typeName = "CodeDocumentation";
    const schema = loadSchema(["codeDocSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<CodeDocumentation>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<CodeDocumentation>(
        model,
        validator,
    );
    return translator;
}

export interface CodeBlockWithDocs extends CodeBlock {
    docs: CodeDocumentation;
}

export function createFakeCodeDocumenter(): CodeDocumenter {
    return {
        document,
    };

    async function document(
        code: CodeBlock | CodeBlockWithDocs,
    ): Promise<CodeDocumentation> {
        if ("docs" in code && code.docs) {
            return code.docs;
        }
        return {};
    }
}
