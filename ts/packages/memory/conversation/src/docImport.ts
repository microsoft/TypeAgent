// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getFileName, HtmlTag, htmlToHtmlTags, readAllText } from "typeagent";
import {
    DocMemory,
    DocMemorySettings,
    DocPart,
    DocPartMeta,
} from "./docMemory.js";
import {
    conversation as kpLib,
    splitLargeTextIntoChunks,
} from "knowledge-processor";
import * as kp from "knowpro";
import { parseVttTranscript } from "./transcript.js";
import { filePathToUrlString } from "memory-storage";
import path from "path";
import { getHtml } from "aiclient";
import { Result, success } from "typechat";

/**
 * Import a text document as DocMemory
 * You must call buildIndex before you can query the memory
 *
 * Uses file extensions to determine how to import.
 *  default: treat as text
 *  .html => parse html
 *  .vtt => parse vtt transcript
 * @param docFilePath
 * @param maxCharsPerChunk
 * @param docName
 * @param settings
 * @returns
 */
export async function importTextFile(
    docFilePath: string,
    maxCharsPerChunk: number,
    docName?: string,
    settings?: DocMemorySettings,
): Promise<DocMemory> {
    const docText = await readAllText(docFilePath);
    docName ??= getFileName(docFilePath);
    const ext = path.extname(docFilePath);

    const sourceUrl = filePathToUrlString(docFilePath);
    let parts: DocPart[];
    switch (ext) {
        default:
            parts = docPartsFromText(docText, maxCharsPerChunk, sourceUrl);
            break;
        case ".html":
        case ".htm":
            parts = docPartsFromHtml(docText, maxCharsPerChunk, sourceUrl);
            break;
        case ".vtt":
            parts = docPartsFromVtt(docText, sourceUrl);
            if (parts.length > 0) {
                parts = mergeDocParts(
                    parts,
                    parts[0].metadata,
                    maxCharsPerChunk,
                );
            }
            break;
    }
    return new DocMemory(docName, parts, settings);
}

/**
 * Import a web page as DocMemory
 * You must call buildIndex before you can query the memory
 * @param url
 * @param maxCharsPerChunk
 * @param settings
 * @returns
 */
export async function importWebPage(
    url: string,
    maxCharsPerChunk: number,
    settings?: DocMemorySettings,
): Promise<Result<DocMemory>> {
    const htmlResult = await getHtml(url);
    if (!htmlResult.success) {
        return htmlResult;
    }
    const parts = docPartsFromHtml(htmlResult.data, maxCharsPerChunk, url);
    const docMemory = new DocMemory(url, parts, settings);
    return success(docMemory);
}
/**
 * Import the given text as separate blocks
 * @param documentText
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartsFromText(
    documentText: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart[] {
    const blocks: DocPart[] = [];
    for (const chunk of splitLargeTextIntoChunks(
        documentText,
        maxCharsPerChunk,
        false,
    )) {
        const block = new DocPart(chunk, new DocPartMeta(sourceUrl));
        blocks.push(block);
    }
    return blocks;
}

/**
 * Import the text as a single DocBlock with multiple chunks
 * @param documentText
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartFromText(
    documentText: string,
    maxCharsPerChunk: number,
    sourceUrl?: string,
): DocPart {
    const textChunks = [
        ...splitLargeTextIntoChunks(documentText, maxCharsPerChunk, false),
    ];
    return new DocPart(textChunks, new DocPartMeta(sourceUrl));
}

/**
 * Just grab text from the given html.
 * You can write a more complex parser that also annotates blocks as headings etc.
 * @param html
 * @param maxCharsPerChunk
 * @param sourceUrl
 * @returns
 */
export function docPartsFromHtml(
    html: string,
    maxCharsPerChunk: number,
    sourceUrl: string,
): DocPart[] {
    /*
    const htmlText = htmlToText(html);
    return docPartsFromText(htmlText, maxCharsPerChunk, sourceUrl);
    */
    const importer = new HtmlImporter(maxCharsPerChunk);
    return importer.import(html);
}

/**
 * Parse a VTT document as a set of document parts
 * @param transcriptText
 * @returns
 */
export function docPartsFromVtt(
    transcriptText: string,
    sourceUrl?: string,
): DocPart[] {
    const [parts, _] = parseVttTranscript<DocPart>(
        transcriptText,
        new Date(),
        (speaker: string) => new DocPart([], new DocPartMeta(sourceUrl)),
    );
    return parts;
}

/**
 * Combine small DocParts into larger ones
 * @param parts
 * @param metadata
 * @param maxCharsPerChunk
 * @returns
 */
export function mergeDocParts(
    parts: DocPart[],
    metadata: DocPartMeta,
    maxCharsPerChunk: number,
): DocPart[] {
    const allChunks = parts.flatMap((p) => p.textChunks);
    const mergedChunks: DocPart[] = [];
    // This will merge all small chunks into larger chunks as needed.. but not exceed
    // maxCharsPerChunk
    for (const chunk of splitLargeTextIntoChunks(
        allChunks,
        maxCharsPerChunk,
        true,
    )) {
        mergedChunks.push(new DocPart(chunk, metadata));
    }
    return mergedChunks;
}

class HtmlImporter {
    private _currentKnowledge: kpLib.KnowledgeResponse | undefined;
    private _currentText: string;
    private _parts: DocPart[];

    constructor(public maxCharsPerChunk: number) {
        this._currentText = "";
        this._parts = [];
    }

    public import(html: string) {
        if (this._parts.length > 0) {
            this._parts = [];
        }
        const htmlTags = htmlToHtmlTags(html);
        for (const htmlTag of htmlTags) {
            const text = this.textFromTag(htmlTag);
            this.appendText(text);
            const entity = this.entityFromTag(htmlTag);
            if (entity) {
                this.getKnowledge().entities.push(entity);
            }
        }
        this.endPart();
        return this._parts;
    }

    private beginPart(): void {
        this._currentText = "";
        this._currentKnowledge = undefined;
    }

    private endPart(): void {
        if (this._currentText.length > 0) {
            const part = new DocPart(this._currentText);
            part.knowledge = this._currentKnowledge;
            this._parts.push(part);
        }
    }

    private appendText(text: string) {
        if (this._currentText.length + text.length > this.maxCharsPerChunk) {
            this.endPart();
            this.beginPart();
        }
        if (this._currentText.length > 0) {
            this._currentText += " ";
        }
        this._currentText += text;
    }

    private textFromTag(htmlTag: HtmlTag): string {
        let text = htmlTag.text ?? "";
        switch (htmlTag.tag) {
            default:
                break;
            case "em":
                text = `_${text}_`;
                break;
            case "h1":
                text = this.textForHeading(htmlTag, 1);
                break;
            case "h2":
                text = this.textForHeading(htmlTag, 2);
                break;
            case "h3":
                text = this.textForHeading(htmlTag, 3);
                break;
            case "h4":
                text = this.textForHeading(htmlTag, 4);
                break;
            case "h5":
                text = this.textForHeading(htmlTag, 5);
                break;
            case "h6":
                text = this.textForHeading(htmlTag, 6);
                break;
            case "ol":
            case "ul":
                text += "\n";
                break;
            case "li":
                text = "- " + text + "\n";
                break;
            case "div":
                if (text) {
                    text += "\n";
                }
                break;
            case "p":
            case "section":
            case "blockquote":
            case "figure":
            case "header":
            case "footer":
            case "article":
                text += "\n\n";
                break;
            case "code":
                text = `\`\`\`\n${text}\n\`\`\`\n`;
                break;
            case "th":
            case "tr":
                text = `\n|${text}`;
            case "td":
                text = `${text}|`;
                break;
        }
        return text;
    }

    private entityFromTag(htmlTag: HtmlTag): kpLib.ConcreteEntity | undefined {
        let entity: kpLib.ConcreteEntity | undefined;

        switch (htmlTag.tag) {
            default:
                break;
            case "h1":
                entity = this.entityForHeading(1);
                break;
            case "h2":
                entity = this.entityForHeading(2);
                break;
            case "h3":
                entity = this.entityForHeading(3);
                break;
            case "h4":
                entity = this.entityForHeading(4);
                break;
            case "h5":
                entity = this.entityForHeading(5);
                break;
            case "h6":
                entity = this.entityForHeading(6);
                break;
        }
        if (entity) {
            this.addFacets(htmlTag, entity);
        }
        return entity;
    }

    private addFacets(htmlTag: HtmlTag, entity: kpLib.ConcreteEntity) {
        if (htmlTag.attr) {
            entity.facets ??= [];
            for (let name in htmlTag.attr) {
                name = name.toLowerCase();
                if (
                    name.startsWith("class") ||
                    name.startsWith("data-") ||
                    name.startsWith("id") ||
                    name.startsWith("tab")
                ) {
                    continue;
                }
                entity.facets.push({
                    name,
                    value: htmlTag.attr[name],
                });
            }
        }
    }

    private textForHeading(htmlTag: HtmlTag, level: number): string {
        if (!htmlTag.text) {
            return "";
        }
        const headingPrefix = "#".repeat(level);
        return `${headingPrefix} ${htmlTag.text}\n`;
    }

    private entityForHeading(level: number): kpLib.ConcreteEntity {
        return {
            name: `Heading ${level}`,
            type: ["heading"],
            facets: [{ name: "level", value: level }],
        };
    }

    private getKnowledge() {
        if (!this._currentKnowledge) {
            this._currentKnowledge = kp.createKnowledgeResponse();
        }
        return this._currentKnowledge;
    }
}
