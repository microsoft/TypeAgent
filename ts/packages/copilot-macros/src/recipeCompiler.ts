// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ts from "typescript";
import type { RecipeArtifact } from "./recipeContracts.js";
import { recipeRuntimeAbi } from "./recipeContracts.js";
import { recipeDigest } from "./recipeValidation.js";

const declarations = `
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface RecipeApi {
    readonly tools: { call(capabilityId: string, input: JsonValue): Promise<JsonValue> };
    readonly semantic: { call(functionId: string, input: JsonValue): Promise<JsonValue> };
}
`;

const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.None,
    strict: true,
    noEmitOnError: true,
    noImplicitAny: true,
    types: [],
    lib: ["lib.es2021.d.ts"],
    skipLibCheck: false,
    removeComments: true,
    newLine: ts.NewLineKind.LineFeed,
};

export const recipeCompilerIdentity = Object.freeze({
    name: "typescript",
    version: ts.version,
    optionsDigest: recipeDigest(
        JSON.stringify({ compilerOptions, declarations, policy: 1 }),
    ),
});

const checkedExecutables = new Map<string, string>();

function remember(sourceDigest: string, executableDigest: string): void {
    if (checkedExecutables.size >= 64)
        checkedExecutables.delete(checkedExecutables.keys().next().value!);
    checkedExecutables.set(sourceDigest, executableDigest);
}

export function verifyRecipeExecutable(artifact: RecipeArtifact): void {
    if (
        Object.entries(recipeCompilerIdentity).some(
            ([key, value]) =>
                artifact.executable.compiler[
                    key as keyof typeof recipeCompilerIdentity
                ] !== value,
        )
    )
        throw new Error("Recipe compiler identity mismatch.");
    const digest =
        checkedExecutables.get(artifact.source.digest) ??
        compileRecipeProgram(artifact.source.text).digest;
    if (digest !== artifact.executable.digest)
        throw new Error("Executable does not match checked compiler output.");
}

function checkedSource(source: string): string {
    if (Buffer.byteLength(source) > 256 * 1024)
        throw new Error("Recipe source exceeds the compiler limit.");
    const file = ts.createSourceFile(
        "recipe.ts",
        source,
        ts.ScriptTarget.ES2021,
        true,
    );
    const fn = file.statements[0];
    if (
        file.statements.length !== 1 ||
        !fn ||
        !ts.isFunctionDeclaration(fn) ||
        fn.name?.text !== "execute" ||
        !fn.body ||
        fn.asteriskToken ||
        fn.typeParameters?.length ||
        fn.parameters.length !== 2 ||
        fn.modifiers?.length !== 1 ||
        fn.modifiers[0].kind !== ts.SyntaxKind.AsyncKeyword
    )
        throw new Error(
            "Expected standalone async function execute(api, params).",
        );
    const forbidden = new Set([
        "process",
        "require",
        "module",
        "exports",
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "Deno",
        "Bun",
        "eval",
        "Function",
        "WebAssembly",
        "SharedArrayBuffer",
        "Atomics",
    ]);
    function inspect(node: ts.Node): void {
        if (
            ts.isImportDeclaration(node) ||
            ts.isImportEqualsDeclaration(node) ||
            ts.isExportDeclaration(node) ||
            ts.isModuleDeclaration(node) ||
            node.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node) && forbidden.has(node.text)) ||
            (ts.canHaveModifiers(node) &&
                ts
                    .getModifiers(node)
                    ?.some(
                        (modifier) =>
                            modifier.kind === ts.SyntaxKind.DeclareKeyword,
                    ))
        )
            throw new Error("Imports and ambient authority are not supported.");
        ts.forEachChild(node, inspect);
    }
    inspect(fn);
    let annotated = source;
    for (let i = 1; i >= 0; i--) {
        const parameter = fn.parameters[i];
        if (
            !ts.isIdentifier(parameter.name) ||
            parameter.name.text !== (i ? "params" : "api") ||
            parameter.dotDotDotToken ||
            parameter.questionToken ||
            parameter.initializer
        )
            throw new Error("Recipe parameters must be api and params.");
        if (!parameter.type) {
            const end = parameter.name.end;
            annotated =
                annotated.slice(0, end) +
                (i ? ": JsonValue" : ": RecipeApi") +
                annotated.slice(end);
        }
    }
    return `${declarations}\n${annotated}
const __recipeEntry: (api: RecipeApi, params: never) => Promise<JsonValue> = execute;
const __recipeParameter: JsonValue = null as unknown as Parameters<typeof execute>[1];
`;
}

export function compileRecipeProgram(
    source: string,
): RecipeArtifact["executable"] {
    const text = checkedSource(source);
    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSource = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
        name === "recipe.ts"
            ? ts.createSourceFile(name, text, languageVersion, true)
            : originalGetSource(name, languageVersion, onError, shouldCreate);
    let javascript: string | undefined;
    host.writeFile = (name, content) => {
        if (name.endsWith(".js")) javascript = content;
    };
    const program = ts.createProgram(["recipe.ts"], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length)
        throw new Error(
            diagnostics
                .map((diagnostic) =>
                    ts.flattenDiagnosticMessageText(
                        diagnostic.messageText,
                        "\n",
                    ),
                )
                .join("\n"),
        );
    const emitted = program.emit();
    if (emitted.emitSkipped || javascript === undefined)
        throw new Error("Recipe compiler did not emit JavaScript.");
    const executable: RecipeArtifact["executable"] = {
        language: "javascript",
        text: javascript,
        digest: recipeDigest(javascript),
        sourceDigest: recipeDigest(source),
        compiler: { ...recipeCompilerIdentity },
        runtimeAbi: recipeRuntimeAbi,
    };
    remember(executable.sourceDigest, executable.digest);
    return executable;
}
