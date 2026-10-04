// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-python";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-ini";

const aliases: Record<string, string> = {
    html: "markup",
    xml: "markup",
    svg: "markup",
    js: "javascript",
    ts: "typescript",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    ps: "powershell",
    ps1: "powershell",
    yml: "yaml",
    py: "python",
    cs: "csharp",
    toml: "ini",
};

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Returns Prism token markup for a known language, or escaped plain text.
export function highlightCode(code: string, language: string): string {
    const name = language.trim().toLowerCase();
    const key = aliases[name] ?? name;
    const grammar = Object.prototype.hasOwnProperty.call(Prism.languages, key)
        ? Prism.languages[key]
        : undefined;
    if (!grammar) return escapeHtml(code);
    try {
        return Prism.highlight(code, grammar, key);
    } catch {
        return escapeHtml(code);
    }
}
