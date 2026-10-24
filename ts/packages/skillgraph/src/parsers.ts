// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import { Language, Parser, type Node } from "web-tree-sitter";

// Tree-sitter grammars: the same parsers bash-language-server and editors use.
// Loaded once (WASM, no native build) so shell and script parsing stay sync.
//
//   "gh pr view 1 | jq ." ──bash──▶ (program (pipeline (command …) (command …)))

const require = createRequire(import.meta.url);

export type Grammar =
    | "bash"
    | "powershell"
    | "python"
    | "javascript"
    | "typescript";

/** npm package and WASM file per grammar. */
const WASM: Record<Grammar, string> = {
    bash: "tree-sitter-bash/tree-sitter-bash.wasm",
    powershell: "tree-sitter-powershell/tree-sitter-powershell.wasm",
    python: "tree-sitter-python/tree-sitter-python.wasm",
    javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
    typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
};

await Parser.init();
const parsers = new Map<Grammar, Parser>();
for (const [name, file] of Object.entries(WASM) as [Grammar, string][]) {
    const parser = new Parser();
    parser.setLanguage(await Language.load(require.resolve(file)));
    parsers.set(name, parser);
}

/** Parse `text`; the caller reads the tree synchronously, then it is freed. */
export function parse<T>(
    grammar: Grammar,
    text: string,
    read: (root: Node) => T,
): T {
    const tree = parsers.get(grammar)!.parse(text);
    try {
        return read(tree!.rootNode);
    } finally {
        tree?.delete();
    }
}

/** Source text of a string literal node without its quotes. */
export function unquote(node: Node): string {
    const t = node.text;
    return /^(['"`]).*\1$/s.test(t) ? t.slice(1, -1) : t;
}

export type { Node };
