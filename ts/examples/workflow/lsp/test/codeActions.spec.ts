// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { computeCodeActions } from "../src/features/codeActions.js";
import { clearCache } from "../src/parsedDocument.js";

beforeEach(() => clearCache());

function doc(text: string): TextDocument {
    return TextDocument.create("file:///t.wf", "workflow", 1, text);
}

const TASK_SRC = `workflow w(s: string): string {
    const r = shell.exec(s);
    return r;
}`;

const EXPR_SRC = `workflow w(a: string, b: string): string {
    const r = string.concat([a, b]);
    return r;
}`;

describe("code actions — surround with attempts", () => {
    it("offers the action when cursor is inside a task call binding", () => {
        // line 1 (0-based) is `    const r = shell.exec(s);`
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 28 },
        };
        const actions = computeCodeActions(doc(TASK_SRC), range);
        const attempt = actions.find((a) =>
            a.title.includes("attempts"),
        );
        expect(attempt).toBeDefined();
    });

    it("new text wraps the statement in attempts / fallback", () => {
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 28 },
        };
        const actions = computeCodeActions(doc(TASK_SRC), range);
        const attempt = actions.find((a) => a.title.includes("attempts"))!;
        const edits = attempt.edit!.changes!["file:///t.wf"]!;
        expect(edits.length).toBe(1);
        const newText = edits[0]!.newText;
        expect(newText).toContain("attempts(3)");
        expect(newText).toContain("fallback (err)");
        expect(newText).toContain("shell.exec");
    });

    it("does not offer the action on a plain const (non-task-call)", () => {
        const text = `workflow w(): string {\n    const x = "hi";\n    return x;\n}`;
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 18 },
        };
        const actions = computeCodeActions(doc(text), range);
        const attempt = actions.find((a) => a.title.includes("attempts"));
        expect(attempt).toBeUndefined();
    });
});

describe("code actions — extract to const", () => {
    it("offers extract when a sub-expression is selected", () => {
        // Select just `[a, b]` (the array literal) inside the concat call.
        const line1 = EXPR_SRC.split("\n")[1]!;
        const exprStart = line1.indexOf("[a, b]");
        const exprEnd = exprStart + "[a, b]".length;
        const range = {
            start: { line: 1, character: exprStart },
            end: { line: 1, character: exprEnd },
        };
        const actions = computeCodeActions(doc(EXPR_SRC), range);
        const extract = actions.find((a) => a.title.includes("Extract"));
        expect(extract).toBeDefined();
    });

    it("insert and replace edits are both present", () => {
        const line1 = EXPR_SRC.split("\n")[1]!;
        const exprStart = line1.indexOf("[a, b]");
        const exprEnd = exprStart + "[a, b]".length;
        const range = {
            start: { line: 1, character: exprStart },
            end: { line: 1, character: exprEnd },
        };
        const actions = computeCodeActions(doc(EXPR_SRC), range);
        const extract = actions.find((a) => a.title.includes("Extract"))!;
        const edits = extract.edit!.changes!["file:///t.wf"]!;
        expect(edits.length).toBe(2);
        const insertEdit = edits.find((e) => e.newText.includes("_extracted ="))!;
        expect(insertEdit.newText).toContain("[a, b]");
        const replaceEdit = edits.find(
            (e) => e.newText === "_extracted",
        )!;
        expect(replaceEdit).toBeDefined();
    });
});
