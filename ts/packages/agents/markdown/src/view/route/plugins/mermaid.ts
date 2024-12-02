// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";

export function MermaidPlugin(md: MarkdownIt) {
    const mermaidRender = (tokens: any[], idx: number) => {
        const token = tokens[idx];
        return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>`;
    };

    md.block.ruler.before(
        "fence",
        "mermaid",
        (state, startLine, endLine, silent) => {
            const start = state.bMarks[startLine] + state.tShift[startLine];
            const max = state.eMarks[startLine];
            const marker = state.src.charCodeAt(start);

            if (marker !== 0x60 /* ` */) {
                return false;
            }

            const fenceLine = state.src.slice(start, max);
            if (!fenceLine.trim().startsWith("```mermaid")) {
                return false;
            }

            let nextLine = startLine;
            while (nextLine < endLine) {
                nextLine++;
                const endPos = state.bMarks[nextLine] + state.tShift[nextLine];
                if (
                    state.src
                        .slice(endPos, state.eMarks[nextLine])
                        .trim()
                        .endsWith("```")
                ) {
                    state.line = nextLine + 1;

                    state.tokens.push({
                        type: "mermaid",
                        content: state.getLines(
                            startLine + 1,
                            nextLine,
                            state.blkIndent,
                            true,
                        ),
                        block: true,
                        level: state.level,
                        tag: "",
                        attrs: null,
                        map: null,
                        nesting: 0,
                        children: null,
                        markup: "",
                        info: "",
                        meta: undefined,
                        hidden: false,
                        attrIndex: function (name: string): number {
                            throw new Error("Function not implemented.");
                        },
                        attrPush: function (attrData: [string, string]): void {
                            throw new Error("Function not implemented.");
                        },
                        attrSet: function (name: string, value: string): void {
                            throw new Error("Function not implemented.");
                        },
                        attrGet: function (name: string): string | null {
                            throw new Error("Function not implemented.");
                        },
                        attrJoin: function (name: string, value: string): void {
                            throw new Error("Function not implemented.");
                        },
                    });
                    return true;
                }
            }
            return false;
        },
        { alt: [] },
    );

    md.renderer.rules.mermaid = mermaidRender;
}
