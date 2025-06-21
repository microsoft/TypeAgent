// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as cheerio from "cheerio";

/**
 * Extract all text from the given html.
 * @param html raw html
 * @param nodeQuery A JQuery like list of node types to extract text from. By default, p, div and span
 * @returns text
 */
export function htmlToText(html: string, nodeQuery?: string): string {
    //nodeQuery ??= "*:not(iframe, script, style, noscript)"; // "body, p, div, span, li, tr, td, h1, h2, h3, h4, h5, h6, a";
    nodeQuery ??=
        "a, p, div, span, em, strong, li, tr, td, h1, h2, h3, h4, h5, h6, article, section, header, footer";
    const $ = cheerio.load(html);
    const query = $(nodeQuery);
    return query
        .contents()
        .filter(function () {
            return (
                this.nodeType === 3 ||
                (this.nodeType === 1 && this.name === "a")
            );
        })
        .map(function () {
            return $(this).text().trim();
        })
        .filter(function () {
            return this.length > 0;
        })
        .get()
        .join(" ");
}

export type HtmlTag = {
    tag: string;
    attr?:
        | {
              [name: string]: string;
          }
        | undefined;
    text?: string | undefined;
};

export function htmlToHtmlTags(html: string): HtmlTag[] {
    const $ = cheerio.load(html);
    const nodeQuery =
        "a, p, div, span, em, strong, li, tr, th, td, h1, h2, h3, h4, h5, h6, article, section, header, footer, annotation, blockquote, code, figure";
    const htmlTags: HtmlTag[] = [];
    $(nodeQuery).each((_, el) => {
        const element = $(el);
        const tag = element[0].tagName;
        let text = getText($, element);
        //const text = $(element).text().trim();
        htmlTags.push({
            tag,
            attr: element[0].attribs,
            text: text || undefined,
        });
    });
    return htmlTags;
}

function getText(
    $: cheerio.CheerioAPI,
    element: cheerio.Cheerio<cheerio.Element>,
): string | undefined {
    let text = "";
    element.contents().each((_, child) => {
        if (child.type === "text") {
            text += $(child).text().trim();
        }
    });
    return text;
}
