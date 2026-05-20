// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Smoke tests for the workflow extension running inside a real
 * VS Code instance. These cover activation and command registration —
 * deeper feature behavior is exercised by the LSP unit/integration
 * tests in the workflow-lsp package, which do not require a display.
 */

import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Workflow extension", () => {
    test("activates and registers commands", async () => {
        // The extension id is publisher.name — see package.json.
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
            content: "workflow w(): string { return \"hi\"; }\n",
        });
        assert.strictEqual(doc.languageId, "workflow");
    });
});
