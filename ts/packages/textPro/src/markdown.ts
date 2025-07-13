// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as md from "marked";
import { htmlToMd } from "./htmlProcessing.js";

export function loadMarkdown(text: string): md.TokensList {
    return md.lexer(text);
}

export function loadMarkdownFromHtml(
    html: string,
    rootTag?: string,
): md.TokensList {
    const markdown = htmlToMd(html, rootTag);
    return loadMarkdown(markdown);
}
