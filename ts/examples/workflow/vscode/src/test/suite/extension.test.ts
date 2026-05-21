// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Smoke tests for the workflow extension running inside a real
 * VS Code instance. These cover activation and command registration -
 * deeper feature behavior is exercised by the LSP unit/integration
 * tests in the workflow-lsp package, which do not require a display.
 *
 * The "Language features" suite below exercises the full LSP
 * client-server-client protocol round-trip using real file:// documents.
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Workflow extension", () => {
    test("activates and registers commands", async () => {
        // The extension id is publisher.name - see package.json.
        const ext = vscode.extensions.getExtension("typeagent.workflow-vscode");
        assert.ok(ext, "extension should be discoverable");
        await ext!.activate();

        const cmds = await vscode.commands.getCommands(true);
        for (const c of [
            "workflow.previewIR",
            "workflow.previewGraph",
            "workflow.showServerOutput",
        ]) {
            assert.ok(cmds.includes(c), `command ${c} should be registered`);
        }
    });

    test("recognizes .wf documents as language 'workflow'", async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: "workflow",
            content: 'workflow w(): string { return "hi"; }\n',
        });
        assert.strictEqual(doc.languageId, "workflow");
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait until the LSP publishes diagnostics for the given URI, or until
 * the timeout expires (returns the current diagnostics either way).
 */
async function waitForDiagnostics(
    uri: vscode.Uri,
    timeoutMs = 10000,
): Promise<vscode.Diagnostic[]> {
    return new Promise((resolve) => {
        let done = false;
        const listener = vscode.languages.onDidChangeDiagnostics((e) => {
            if (!done && e.uris.some((u) => u.toString() === uri.toString())) {
                done = true;
                listener.dispose();
                resolve(vscode.languages.getDiagnostics(uri));
            }
        });
        setTimeout(() => {
            if (!done) {
                done = true;
                listener.dispose();
                resolve(vscode.languages.getDiagnostics(uri));
            }
        }, timeoutMs);
    });
}

// ---------------------------------------------------------------------------
// Snippet structure test (no VS Code display needed - just reads the JSON).
// Covers manual test 3c (snippet prefix and body shape).
// ---------------------------------------------------------------------------

suite("Snippet structure", () => {
    test("workflow snippet has correct prefix and tab stops", () => {
        // __dirname = dist/test/suite; go up three levels to the extension root.
        const snipPath = path.resolve(
            __dirname,
            "../../..",
            "snippets/workflow.code-snippets",
        );
        const raw = fs.readFileSync(snipPath, "utf-8");
        // The file is JSONC (trailing commas). Strip them before parsing.
        const json = raw.replace(/,(\s*[}\]])/g, "$1");
        const snippets = JSON.parse(json) as Record<
            string,
            { prefix: string; body: string[] }
        >;
        const wf = Object.values(snippets).find((s) => s.prefix === "workflow");
        assert.ok(wf, "a snippet with prefix 'workflow' should exist");
        const body = wf.body.join("\n");
        // Tab stops use ${n:placeholder} syntax, not bare $n.
        assert.ok(
            body.includes("${1:"),
            "body should contain tab stop ${1:...}",
        );
        assert.ok(
            body.includes("workflow"),
            "body should contain the 'workflow' keyword",
        );
    });
});

// ---------------------------------------------------------------------------
// Language features suite - exercises the full LSP round-trip.
// Covers manual tests: 1a (diagnostics), 1c (format), 1d (symbols),
// 2a (hover), 2b (go-to-def), 2c (find-refs), 2d (completions),
// 3a (sig help), 4a (rename).
// ---------------------------------------------------------------------------

// Source for the valid fixture document.
// Line 0: workflow w(a: string, b: string): string {
// Line 1:     const x = a;
// Line 2:     return string.join([x, b], ",");
// Line 3: }
const VALID_SRC =
    "workflow w(a: string, b: string): string {\n" +
    "    const x = a;\n" +
    '    return string.join([x, b], ",");\n' +
    "}\n";

const INVALID_SRC = "workflow broken(\n";

suite("Language features", () => {
    let tmpDir: string;
    let validUri: vscode.Uri;
    let invalidUri: vscode.Uri;

    suiteSetup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-e2e-"));
        const validFile = path.join(tmpDir, "valid.wf");
        const invalidFile = path.join(tmpDir, "invalid.wf");
        fs.writeFileSync(validFile, VALID_SRC, "utf-8");
        fs.writeFileSync(invalidFile, INVALID_SRC, "utf-8");
        validUri = vscode.Uri.file(validFile);
        invalidUri = vscode.Uri.file(invalidFile);

        // Open and show the valid document so the language client registers
        // it. Wait for the first diagnostics event to confirm the server is
        // processing documents before the individual tests run.
        const validDoc = await vscode.workspace.openTextDocument(validUri);
        await vscode.window.showTextDocument(validDoc);
        await waitForDiagnostics(validUri);
    });

    suiteTeardown(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    // --- 1a: diagnostics ---------------------------------------------------

    test("1a: valid workflow file produces no diagnostics", () => {
        const diags = vscode.languages.getDiagnostics(validUri);
        assert.strictEqual(
            diags.length,
            0,
            `expected 0 diagnostics, got: ${diags.map((d) => d.message).join("; ")}`,
        );
    });

    test("1a: syntactically broken file produces at least one diagnostic", async () => {
        const invalidDoc = await vscode.workspace.openTextDocument(invalidUri);
        await vscode.window.showTextDocument(invalidDoc);
        const diags = await waitForDiagnostics(invalidUri);
        assert.ok(
            diags.length > 0,
            "expected at least one diagnostic for broken source",
        );
    });

    // --- 1c: formatting ----------------------------------------------------

    test("1c: formatting an unformatted file returns at least one edit", async () => {
        const unformatFile = path.join(tmpDir, "unformatted.wf");
        fs.writeFileSync(
            unformatFile,
            "workflow w(  x:string):string{return x;}",
            "utf-8",
        );
        const unformatUri = vscode.Uri.file(unformatFile);
        const unformatDoc =
            await vscode.workspace.openTextDocument(unformatUri);
        await vscode.window.showTextDocument(unformatDoc);
        await waitForDiagnostics(unformatUri);

        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            "vscode.executeFormatDocumentProvider",
            unformatUri,
            { tabSize: 4, insertSpaces: true },
        );
        assert.ok(
            edits && edits.length > 0,
            "expected at least one formatting edit",
        );
    });

    // --- 1d: document symbols ----------------------------------------------

    test("1d: document symbols list the workflow and its children", async () => {
        const symbols = await vscode.commands.executeCommand<
            vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", validUri);
        assert.ok(symbols && symbols.length > 0, "expected document symbols");
        const wf = symbols[0]!;
        assert.strictEqual(wf.name, "w", "top-level symbol should be 'w'");
        const childNames = wf.children.map((c) => c.name);
        assert.ok(
            childNames.includes("a"),
            "children should include param 'a'",
        );
        assert.ok(
            childNames.includes("x"),
            "children should include const 'x'",
        );
    });

    // --- 2a: hover ---------------------------------------------------------

    test("2a: hover on a reference returns markdown content", async () => {
        // 'a' referenced at line 1, char 14 in VALID_SRC.
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            validUri,
            new vscode.Position(1, 14),
        );
        assert.ok(hovers && hovers.length > 0, "expected hover results");
        const content = hovers
            .flatMap((h) =>
                Array.isArray(h.contents) ? h.contents : [h.contents],
            )
            .map((c) =>
                typeof c === "string" ? c : (c as { value: string }).value,
            )
            .join("\n");
        assert.ok(
            content.toLowerCase().includes("parameter"),
            "hover should describe the symbol kind",
        );
        assert.ok(
            content.includes("a"),
            "hover content should mention the symbol name",
        );
    });

    // --- 2b: go-to-definition ----------------------------------------------

    test("2b: go-to-definition resolves a reference to its declaration line", async () => {
        // 'x' referenced at line 2, char 24 ('x' in '[x, b]') -> declared on line 1.
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeDefinitionProvider",
            validUri,
            new vscode.Position(2, 24),
        );
        assert.ok(locs && locs.length > 0, "expected definition location");
        assert.strictEqual(
            locs[0]!.range.start.line,
            1,
            "definition should point to line 1 where 'x' is declared",
        );
    });

    // --- 2c: find references -----------------------------------------------

    test("2c: find references on a parameter returns at least one usage", async () => {
        // 'a' declared at line 0, char 11; referenced at line 1, char 14.
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            validUri,
            new vscode.Position(0, 11),
        );
        assert.ok(
            locs && locs.length >= 1,
            "expected at least one reference location for param 'a'",
        );
    });

    // --- 2d: completions ---------------------------------------------------

    test("2d: completion list includes built-in task names", async () => {
        // Position (0, 0) = before any content; all tasks should be offered.
        const list =
            await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider",
                validUri,
                new vscode.Position(0, 0),
            );
        assert.ok(list, "expected a completion list");
        const labels = list.items.map((i) =>
            typeof i.label === "string" ? i.label : i.label.label,
        );
        assert.ok(
            labels.some((l) => l.includes("string.join")),
            "completions should include 'string.join'",
        );
    });

    // --- 3a: signature help ------------------------------------------------

    test("3a: signature help inside a task call identifies the active parameter", async () => {
        // Line 2: '    return string.join([x, b], ",");'
        // Position (2, 31) is inside the second argument '","'.
        // locateCall counts the inner comma in [x, b] too, giving commaCount=2,
        // which is clamped to index 1 (the 'separator' param).
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
            "vscode.executeSignatureHelpProvider",
            validUri,
            new vscode.Position(2, 31),
            ",",
        );
        assert.ok(
            help && help.signatures.length > 0,
            "expected signature help",
        );
        assert.ok(
            help.signatures[0]!.label.includes("string.join"),
            "signature label should include the task name",
        );
        assert.strictEqual(
            help.activeParameter,
            1,
            "second argument position should map to activeParameter=1 (separator)",
        );
    });

    // --- 4a: rename --------------------------------------------------------

    test("4a: rename a parameter produces a workspace edit covering all occurrences", async () => {
        // 'a' declared at line 0, char 11; rename to 'alpha'.
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            "vscode.executeDocumentRenameProvider",
            validUri,
            new vscode.Position(0, 11),
            "alpha",
        );
        assert.ok(edit, "rename should produce a workspace edit");
        const fileEdits = edit
            .entries()
            .find(([u]) => u.toString() === validUri.toString());
        assert.ok(fileEdits, "edit should target the valid fixture file");
        // 'a' appears once as declaration + once as reference = at least 2 edits.
        assert.ok(
            fileEdits[1].length >= 2,
            "rename should replace the declaration and all references",
        );
    });
});
