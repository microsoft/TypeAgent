// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs/promises";
import path from "path";

export interface ProcessedHTML {
    html: string;
    frameId: number;
    textLength: number;
    htmlLength: number;
}

export interface HTMLProcessingResult {
    processedHTML: ProcessedHTML[];
    cleanFilePath: string;
    relativeCleanPath: string;
    originalSize: number;
    processedSize: number;
}

interface HTMLFrame {
    frameId: number;
    content: string;
    text?: string;
}

/**
 * Deserialize the nested JSON structure from browser__getHTML
 * Input structure: [{ type: "text", text: "[{frameId, content, text}]" }]
 * Output: Clean HTML frames with content
 */
export function deserializeHTMLResult(fileContent: string): ProcessedHTML[] {
    try {
        // Parse outer JSON array
        const outerArray = JSON.parse(fileContent);

        if (!Array.isArray(outerArray) || outerArray.length === 0) {
            throw new Error("Invalid outer array structure");
        }

        // Extract the text field from first element
        const firstElement = outerArray[0];
        if (!firstElement || !firstElement.text) {
            throw new Error("Missing text field in JSON structure");
        }

        // Parse inner JSON array (this is an escaped JSON string)
        const frames: HTMLFrame[] = JSON.parse(firstElement.text);

        if (!Array.isArray(frames)) {
            throw new Error("Inner structure is not an array");
        }

        // Extract HTML content from each frame
        return frames.map((frame) => ({
            html: frame.content,
            frameId: frame.frameId,
            textLength: frame.text?.length || 0,
            htmlLength: frame.content.length,
        }));
    } catch (error) {
        throw new Error(
            `Failed to deserialize HTML result: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Process HTML tool result file
 * Reads JSON file, deserializes, extracts clean HTML, saves to output directory
 */
export async function processHTMLToolResult(
    filePath: string,
    outputDir: string,
    stepNumber: number,
): Promise<HTMLProcessingResult> {
    // Read original JSON file
    const fileContent = await fs.readFile(filePath, "utf-8");
    const originalSize = fileContent.length;

    // Deserialize to get clean HTML
    const processedHTML = deserializeHTMLResult(fileContent);

    // Combine all frames' HTML (usually just one frame, but support multiple)
    const combinedHTML = processedHTML.map((p) => p.html).join("\n\n");

    // Prettify HTML for better readability and token-based file reading
    // Add line breaks after major tags to make offset/limit work better
    const prettifiedHTML = prettifyHTML(combinedHTML);
    const processedSize = prettifiedHTML.length;

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Save clean HTML
    const filename = `step-${String(stepNumber).padStart(3, "0")}-page.html`;
    const cleanFilePath = path.join(outputDir, filename);
    await fs.writeFile(cleanFilePath, prettifiedHTML, "utf-8");

    return {
        processedHTML,
        cleanFilePath,
        relativeCleanPath: path.join("html", filename),
        originalSize,
        processedSize,
    };
}

/**
 * Detect if a tool result content contains a file path to an HTML result
 * Returns the file path if found, null otherwise
 */
export function extractHTMLFilePath(content: string): string | null {
    // Pattern matches: "Output has been saved to C:\path\to\file.txt"
    const patterns = [
        /saved to ([A-Z]:[^\s\n]+\.txt)/i, // Windows absolute path
        /saved to (\/[^\s\n]+\.txt)/i, // Unix absolute path
        /saved to ([A-Z]:\\[^\s\n]+\.txt)/i, // Windows with escaped backslash
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            // Normalize path (handle escaped backslashes)
            return match[1].replace(/\\\\/g, "\\");
        }
    }

    return null;
}

/**
 * Prettify HTML by adding line breaks after major tags
 * This makes the HTML more readable and allows Read tool's offset/limit to work
 * (they work on lines, so minified HTML on one line exceeds token limits)
 */
function prettifyHTML(html: string): string {
    // Add line breaks after major closing tags
    let prettified = html
        // Block-level elements
        .replace(
            /<\/(div|section|article|aside|nav|header|footer|main|form|table|ul|ol|li|tr|td|th|thead|tbody|tfoot|h[1-6]|p|blockquote|pre|figure|figcaption|address|hr)>/gi,
            "</$1>\n",
        )
        // Add breaks after opening tags for better structure
        .replace(/<(head|body|html)>/gi, "<$1>\n")
        .replace(/<\/(head|body|html)>/gi, "</$1>\n");

    return prettified;
}
