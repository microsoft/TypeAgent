// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";

/**
 * The built-in server families and extension map follow OpenCode's MIT-licensed
 * LSP registry at anomalyco/opencode@743f6410. Process installation is
 * intentionally not copied: benchmark sessions may only use already-provisioned
 * executables or explicit command overrides.
 */

export interface LanguageServerCommand {
    command: string;
    args: string[];
    env?: Record<string, string> | undefined;
}

export interface LanguageServerDefinition {
    id: string;
    extensions: readonly string[];
    command: LanguageServerCommand;
    rootMarkerGroups?: readonly (readonly string[])[] | undefined;
    excludeRootMarkers?: readonly string[] | undefined;
    requireRoot?: boolean | undefined;
    initialization?: Record<string, unknown> | undefined;
    configuration?: Record<string, unknown> | undefined;
}

export interface LanguageServerFiles {
    get(relativePath: string): string | undefined;
    has(relativePath: string): boolean;
    paths(): readonly string[];
}

export interface LanguageServerOptions {
    servers: readonly LanguageServerDefinition[];
    requestTimeoutMs?: number | undefined;
}

export interface LanguageServerCandidate {
    server: LanguageServerDefinition;
    /** Repository-relative POSIX directory; an empty string is the root. */
    root: string;
}

export interface DefaultLanguageServerCommands {
    python: LanguageServerCommand;
    typescript: LanguageServerCommand;
}

const nodeRoots = [
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
];
const pythonRoots = [
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
];

export function createDefaultLanguageServers(
    commands: DefaultLanguageServerCommands,
): LanguageServerDefinition[] {
    return [
        server(
            "deno",
            tsExtensions,
            "deno",
            ["lsp"],
            [["deno.json", "deno.jsonc"]],
            {
                requireRoot: true,
            },
        ),
        {
            ...server(
                "typescript",
                tsExtensions,
                commands.typescript.command,
                commands.typescript.args,
                [nodeRoots],
            ),
            command: commands.typescript,
            excludeRootMarkers: ["deno.json", "deno.jsonc"],
        },
        server(
            "vue",
            [".vue"],
            "vue-language-server",
            ["--stdio"],
            [nodeRoots],
        ),
        server(
            "eslint",
            [...tsExtensions, ".vue"],
            "vscode-eslint-language-server",
            ["--stdio"],
            [nodeRoots],
        ),
        server(
            "oxlint",
            [...tsExtensions, ".vue", ".astro", ".svelte"],
            "oxlint",
            ["--lsp"],
            [[".oxlintrc.json", "package.json", ...nodeRoots]],
        ),
        server(
            "biome",
            [
                ...tsExtensions,
                ".json",
                ".jsonc",
                ".vue",
                ".astro",
                ".svelte",
                ".css",
                ".graphql",
                ".gql",
                ".html",
            ],
            "biome",
            ["lsp-proxy", "--stdio"],
            [["biome.json", "biome.jsonc", ...nodeRoots]],
        ),
        server(
            "gopls",
            [".go"],
            "gopls",
            [],
            [["go.work"], ["go.mod", "go.sum"]],
        ),
        server(
            "ruby-lsp",
            [".rb", ".rake", ".gemspec", ".ru"],
            "rubocop",
            ["--lsp"],
            [["Gemfile"]],
        ),
        {
            ...server(
                "pylsp",
                [".py", ".pyi"],
                commands.python.command,
                commands.python.args,
                [pythonRoots],
            ),
            command: commands.python,
            configuration: {
                pylsp: {
                    plugins: {
                        autopep8: { enabled: false },
                        black: { enabled: false },
                        flake8: { enabled: false },
                        mccabe: { enabled: false },
                        pycodestyle: { enabled: false },
                        pyflakes: { enabled: false },
                        pylint: { enabled: false },
                        yapf: { enabled: false },
                    },
                },
            },
        },
        server("ty", [".py", ".pyi"], "ty", ["server"], [pythonRoots]),
        server(
            "pyright",
            [".py", ".pyi"],
            "pyright-langserver",
            ["--stdio"],
            [pythonRoots],
        ),
        server(
            "elixir-ls",
            [".ex", ".exs"],
            "elixir-ls",
            [],
            [["mix.exs", "mix.lock"]],
        ),
        server("zls", [".zig", ".zon"], "zls", [], [["build.zig"]]),
        server(
            "csharp",
            [".cs", ".csx"],
            "roslyn-language-server",
            ["--stdio", "--autoLoadProjects"],
            [dotnetRoots],
        ),
        server(
            "razor",
            [".razor", ".cshtml"],
            "roslyn-language-server",
            ["--stdio", "--autoLoadProjects"],
            [dotnetRoots],
        ),
        server(
            "fsharp",
            [".fs", ".fsi", ".fsx", ".fsscript"],
            "fsautocomplete",
            [],
            [["*.slnx", "*.sln", "*.fsproj", "global.json"]],
        ),
        server(
            "sourcekit-lsp",
            [".swift", ".m", ".mm"],
            "sourcekit-lsp",
            [],
            [["Package.swift", "*.xcodeproj", "*.xcworkspace"]],
        ),
        server(
            "rust",
            [".rs"],
            "rust-analyzer",
            [],
            [["Cargo.toml", "Cargo.lock"]],
            { requireRoot: true },
        ),
        server(
            "clangd",
            [
                ".c",
                ".cpp",
                ".cc",
                ".cxx",
                ".c++",
                ".h",
                ".hpp",
                ".hh",
                ".hxx",
                ".h++",
            ],
            "clangd",
            ["--background-index", "--clang-tidy"],
            [["compile_commands.json", "compile_flags.txt", ".clangd"]],
        ),
        server("svelte", [".svelte"], "svelteserver", ["--stdio"], [nodeRoots]),
        server("astro", [".astro"], "astro-ls", ["--stdio"], [nodeRoots]),
        server("jdtls", [".java"], "jdtls", [], [javaRootPriority], {
            requireRoot: true,
        }),
        server(
            "kotlin-ls",
            [".kt", ".kts"],
            "kotlin-lsp",
            ["--stdio"],
            [kotlinRoots],
            { requireRoot: true },
        ),
        server(
            "yaml-ls",
            [".yaml", ".yml"],
            "yaml-language-server",
            ["--stdio"],
            [nodeRoots],
        ),
        server(
            "lua-ls",
            [".lua"],
            "lua-language-server",
            [],
            [
                [
                    ".luarc.json",
                    ".luarc.jsonc",
                    ".luacheckrc",
                    ".stylua.toml",
                    "stylua.toml",
                    "selene.toml",
                    "selene.yml",
                ],
            ],
        ),
        server(
            "php-intelephense",
            [".php"],
            "intelephense",
            ["--stdio"],
            [["composer.json", "composer.lock", ".php-version"]],
            {
                initialization: { telemetry: { enabled: false } },
            },
        ),
        server(
            "prisma",
            [".prisma"],
            "prisma",
            ["language-server"],
            [["schema.prisma"]],
        ),
        server(
            "dart",
            [".dart"],
            "dart",
            ["language-server", "--lsp"],
            [["pubspec.yaml", "analysis_options.yaml"]],
        ),
        server(
            "ocaml-lsp",
            [".ml", ".mli"],
            "ocamllsp",
            [],
            [["dune-project", "dune-workspace", ".merlin", "opam"]],
        ),
        server(
            "bash",
            [".sh", ".bash", ".zsh", ".ksh"],
            "bash-language-server",
            ["start"],
        ),
        server(
            "terraform",
            [".tf", ".tfvars"],
            "terraform-ls",
            ["serve"],
            [[".terraform.lock.hcl", "terraform.tfstate", "*.tf"]],
        ),
        server(
            "texlab",
            [".tex", ".bib"],
            "texlab",
            [],
            [[".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]],
        ),
        server(
            "dockerfile",
            [".dockerfile", "Dockerfile"],
            "docker-langserver",
            ["--stdio"],
        ),
        server("gleam", [".gleam"], "gleam", ["lsp"], [["gleam.toml"]]),
        server(
            "clojure-lsp",
            [".clj", ".cljs", ".cljc", ".edn"],
            "clojure-lsp",
            ["listen"],
            [
                [
                    "deps.edn",
                    "project.clj",
                    "shadow-cljs.edn",
                    "bb.edn",
                    "build.boot",
                ],
            ],
        ),
        server("nixd", [".nix"], "nixd", [], [["flake.nix"]]),
        server("tinymist", [".typ", ".typc"], "tinymist", [], [["typst.toml"]]),
        server(
            "haskell-language-server",
            [".hs", ".lhs"],
            "haskell-language-server-wrapper",
            ["--lsp"],
            [["stack.yaml", "cabal.project", "hie.yaml", "*.cabal"]],
        ),
        server(
            "julials",
            [".jl"],
            "julia",
            [
                "--startup-file=no",
                "--history-file=no",
                "-e",
                "using LanguageServer; runserver()",
            ],
            [["Project.toml", "Manifest.toml", "*.jl"]],
        ),
    ];
}

export function languageIdForPath(relativePath: string): string {
    const name = path.posix.basename(relativePath).toLowerCase();
    const exact = languageIds[name];
    if (exact) {
        return exact;
    }
    const suffix = Object.keys(languageIds)
        .filter((entry) => entry.startsWith("."))
        .sort((left, right) => right.length - left.length)
        .find((entry) => name.endsWith(entry));
    return suffix ? languageIds[suffix] : "plaintext";
}

export function resolveLanguageServerCandidates(
    relativePath: string,
    files: LanguageServerFiles,
    servers: readonly LanguageServerDefinition[],
): LanguageServerCandidate[] {
    const normalized = normalizeRelativePath(relativePath);
    const paths = files.paths();
    return servers.flatMap((serverDefinition) => {
        if (!matchesExtension(normalized, serverDefinition.extensions)) {
            return [];
        }
        if (
            serverDefinition.excludeRootMarkers &&
            findNearestRoot(
                normalized,
                paths,
                serverDefinition.excludeRootMarkers,
            ) !== undefined
        ) {
            return [];
        }
        const groups = serverDefinition.rootMarkerGroups ?? [];
        let root: string | undefined;
        for (const markers of groups) {
            root = findNearestRoot(normalized, paths, markers);
            if (root !== undefined) {
                break;
            }
        }
        if (root === undefined) {
            if (serverDefinition.requireRoot) {
                return [];
            }
            root = "";
        }
        return [{ server: serverDefinition, root }];
    });
}

function server(
    id: string,
    extensions: readonly string[],
    command: string,
    args: string[],
    rootMarkerGroups?: readonly (readonly string[])[],
    options: Pick<
        LanguageServerDefinition,
        "requireRoot" | "initialization" | "configuration"
    > = {},
): LanguageServerDefinition {
    return {
        id,
        extensions,
        command: { command, args },
        ...(rootMarkerGroups ? { rootMarkerGroups } : {}),
        ...options,
    };
}

function matchesExtension(
    relativePath: string,
    extensions: readonly string[],
): boolean {
    const name = path.posix.basename(relativePath);
    const lower = name.toLowerCase();
    return extensions.some((extension) =>
        extension.startsWith(".")
            ? lower.endsWith(extension.toLowerCase())
            : name === extension,
    );
}

function findNearestRoot(
    relativePath: string,
    files: readonly string[],
    markers: readonly string[],
): string | undefined {
    let directory = path.posix.dirname(relativePath);
    if (directory === ".") {
        directory = "";
    }
    while (true) {
        const prefix = directory ? `${directory}/` : "";
        if (
            files.some((file) => {
                if (path.posix.dirname(file) !== (directory || ".")) {
                    return false;
                }
                const name = file.slice(prefix.length);
                return markers.some((marker) => matchesMarker(name, marker));
            })
        ) {
            return directory;
        }
        if (!directory) {
            return undefined;
        }
        const parent = path.posix.dirname(directory);
        directory = parent === "." ? "" : parent;
    }
}

function matchesMarker(name: string, marker: string): boolean {
    const expression = marker
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*");
    return new RegExp(`^${expression}$`).test(name);
}

function normalizeRelativePath(value: string): string {
    return path.posix.normalize(value).replace(/^\.\//, "");
}

const tsExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
] as const;
const dotnetRoots = ["*.slnx", "*.sln", "*.csproj", "global.json"];
const javaRootPriority = [
    "settings.gradle",
    "settings.gradle.kts",
    "gradlew",
    "gradlew.bat",
    "build.gradle",
    "build.gradle.kts",
    "pom.xml",
    ".project",
    ".classpath",
];
const kotlinRoots = [
    "settings.gradle.kts",
    "settings.gradle",
    "gradlew",
    "gradlew.bat",
    "build.gradle.kts",
    "build.gradle",
    "pom.xml",
];

const languageIds: Record<string, string> = {
    ".abap": "abap",
    ".bat": "bat",
    ".bib": "bibtex",
    ".bibtex": "bibtex",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".cljc": "clojure",
    ".edn": "clojure",
    ".coffee": "coffeescript",
    ".c": "c",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".cc": "cpp",
    ".c++": "cpp",
    ".cs": "csharp",
    ".csx": "csharp",
    ".css": "css",
    ".d": "d",
    ".pas": "pascal",
    ".pascal": "pascal",
    ".diff": "diff",
    ".patch": "diff",
    ".dart": "dart",
    ".dockerfile": "dockerfile",
    dockerfile: "dockerfile",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".fs": "fsharp",
    ".fsi": "fsharp",
    ".fsx": "fsharp",
    ".fsscript": "fsharp",
    ".go": "go",
    ".groovy": "groovy",
    ".gleam": "gleam",
    ".hbs": "handlebars",
    ".handlebars": "handlebars",
    ".hs": "haskell",
    ".lhs": "haskell",
    ".html": "html",
    ".htm": "html",
    ".ini": "ini",
    ".java": "java",
    ".jl": "julia",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".json": "json",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".tex": "latex",
    ".latex": "latex",
    ".less": "less",
    ".lua": "lua",
    ".m": "objective-c",
    ".mm": "objective-cpp",
    ".pl": "perl",
    ".pm": "perl",
    ".pm6": "perl6",
    ".php": "php",
    ".ps1": "powershell",
    ".psm1": "powershell",
    ".pug": "jade",
    ".jade": "jade",
    ".py": "python",
    ".pyi": "python",
    ".r": "r",
    ".cshtml": "razor",
    ".razor": "razor",
    ".rb": "ruby",
    ".rake": "ruby",
    ".gemspec": "ruby",
    ".ru": "ruby",
    ".erb": "erb",
    ".html.erb": "erb",
    ".js.erb": "erb",
    ".css.erb": "erb",
    ".json.erb": "erb",
    ".rs": "rust",
    ".scss": "scss",
    ".sass": "sass",
    ".scala": "scala",
    ".sh": "shellscript",
    ".bash": "shellscript",
    ".zsh": "shellscript",
    ".ksh": "shellscript",
    ".sql": "sql",
    ".svelte": "svelte",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".mts": "typescript",
    ".cts": "typescript",
    ".mtsx": "typescriptreact",
    ".ctsx": "typescriptreact",
    ".xml": "xml",
    ".xsl": "xsl",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".vue": "vue",
    ".zig": "zig",
    ".zon": "zig",
    ".astro": "astro",
    ".ml": "ocaml",
    ".mli": "ocaml",
    ".tf": "terraform",
    ".tfvars": "terraform-vars",
    ".hcl": "hcl",
    ".nix": "nix",
    ".typ": "typst",
    ".typc": "typst",
};
