// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function declarations(name) {
    const source = ts.createSourceFile(
        name,
        await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"),
        ts.ScriptTarget.Latest,
        true,
    );
    return source.statements.filter(ts.isTypeAliasDeclaration);
}

test("memory service contract contains ordinary Markdown imports, not PDF retention RPC", async () => {
    const types = await declarations("serviceTypes.ts");
    assert.equal(
        types.some((type) =>
            /^Pdf(?:Capture|Capability|Authorize)/.test(type.name.text),
        ),
        false,
    );
    const memory = types.find(
        (type) => type.name.text === "MemoryCenterInvokeFunctions",
    );
    assert.ok(memory && ts.isTypeLiteralNode(memory.type));
    const methods = memory.type.members;
    assert.equal(
        methods.some((method) => method.name.getText().startsWith("pdf")),
        false,
    );
    for (const name of [
        "memoryGetSource",
        "memoryGetSourceContent",
        "memoryForgetSource",
        "memoryListJobs",
    ]) {
        assert.ok(
            methods.some((method) => method.name.getText() === name),
            name,
        );
    }
    const operation = methods.find(
        (method) => method.name.getText() === "memoryImportDocument",
    );
    assert.ok(operation && ts.isMethodSignature(operation));
    const params = operation.parameters[0].type;
    assert.ok(params && ts.isTypeLiteralNode(params));
    assert.deepEqual(
        params.members.map((member) => [
            member.name.getText(),
            Boolean(member.questionToken),
        ]),
        [
            ["corpusId", false],
            ["title", false],
            ["markdown", false],
            ["canonicalUri", true],
            ["tags", true],
        ],
    );
});

test("browser control does not export retained PDF capture or open types", async () => {
    const types = await declarations("browserControl.ts");
    assert.equal(
        types.some((type) => type.name.text.startsWith("PdfBrowserControl")),
        false,
    );
});
