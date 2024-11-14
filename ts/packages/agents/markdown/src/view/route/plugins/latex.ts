// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
// @ts-ignore
import markdownItTexmath from "markdown-it-texmath";
import katex from "katex";

export function LatexPlugin(md: MarkdownIt) {
    md.use(markdownItTexmath, {
        engine: katex,
        delimiters: ["dollars", "gitlab"],
        katexOptions: {
            macros: {
                "\\RR": "\\mathbb{R}",
            },
        },
    });
}
