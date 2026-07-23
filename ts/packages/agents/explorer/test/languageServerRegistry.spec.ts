// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import {
    createDefaultLanguageServers,
    languageIdForPath,
    resolveLanguageServerCandidates,
    type LanguageServerFiles,
} from "../src/script/languageServerRegistry.js";

describe("language server registry", () => {
    it("covers every built-in OpenCode language server family", () => {
        const ids = new Set(
            createDefaultLanguageServers({
                python: { command: "/tools/pylsp", args: [] },
                typescript: { command: "/tools/tsls", args: ["--stdio"] },
            }).map((server) => server.id),
        );

        expect(ids).toEqual(
            new Set([
                "astro",
                "bash",
                "biome",
                "clangd",
                "clojure-lsp",
                "csharp",
                "dart",
                "deno",
                "dockerfile",
                "elixir-ls",
                "eslint",
                "fsharp",
                "gleam",
                "gopls",
                "haskell-language-server",
                "jdtls",
                "julials",
                "kotlin-ls",
                "lua-ls",
                "nixd",
                "ocaml-lsp",
                "oxlint",
                "php-intelephense",
                "prisma",
                "pylsp",
                "pyright",
                "razor",
                "ruby-lsp",
                "rust",
                "sourcekit-lsp",
                "svelte",
                "terraform",
                "texlab",
                "tinymist",
                "ty",
                "typescript",
                "vue",
                "yaml-ls",
                "zls",
            ]),
        );
    });

    it("maps representative and compound extensions to LSP language IDs", () => {
        expect(languageIdForPath("src/main.tsx")).toBe("typescriptreact");
        expect(languageIdForPath("templates/show.html.erb")).toBe("erb");
        expect(languageIdForPath("Dockerfile")).toBe("dockerfile");
        expect(languageIdForPath("src/lib.rs")).toBe("rust");
        expect(languageIdForPath("unknown.repro")).toBe("plaintext");
    });

    it("selects servers lazily by extension and nearest project root", () => {
        const servers = createDefaultLanguageServers({
            python: { command: "/tools/pylsp", args: [] },
            typescript: { command: "/tools/tsls", args: ["--stdio"] },
        });
        const nodeFiles = files([
            "workspace/package.json",
            "workspace/pnpm-lock.yaml",
            "workspace/src/main.ts",
        ]);
        const node = resolveLanguageServerCandidates(
            "workspace/src/main.ts",
            nodeFiles,
            servers,
        );
        expect(node[0]).toMatchObject({
            root: "workspace",
            server: { id: "typescript" },
        });

        const denoFiles = files([
            "workspace/deno.json",
            "workspace/src/main.ts",
        ]);
        const deno = resolveLanguageServerCandidates(
            "workspace/src/main.ts",
            denoFiles,
            servers,
        );
        expect(deno.map((candidate) => candidate.server.id)).toContain("deno");
        expect(deno.map((candidate) => candidate.server.id)).not.toContain(
            "typescript",
        );
        expect(deno[0]?.root).toBe("workspace");
    });

    it("honors root-marker precedence for multi-module languages", () => {
        const servers = createDefaultLanguageServers({
            python: { command: "/tools/pylsp", args: [] },
            typescript: { command: "/tools/tsls", args: ["--stdio"] },
        });
        const candidates = resolveLanguageServerCandidates(
            "repo/module/main.go",
            files([
                "repo/go.work",
                "repo/module/go.mod",
                "repo/module/main.go",
            ]),
            servers,
        );

        expect(candidates[0]).toMatchObject({
            root: "repo",
            server: { id: "gopls" },
        });
    });
});

function files(paths: string[]): LanguageServerFiles {
    const available = new Set(paths);
    return {
        get: () => undefined,
        has: (relativePath) => available.has(relativePath),
        paths: () => [...available],
    };
}
