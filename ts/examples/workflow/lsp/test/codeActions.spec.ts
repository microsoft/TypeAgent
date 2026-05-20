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
        const attempt = actions.find((a) => a.title.includes("attempts"));
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
        const insertEdit = edits.find((e) =>
            e.newText.includes("_extracted ="),
        )!;
        expect(insertEdit.newText).toContain("[a, b]");
        const replaceEdit = edits.find((e) => e.newText === "_extracted")!;
        expect(replaceEdit).toBeDefined();
    });
});

describe("code actions — inline const", () => {
    const INLINE_SRC = `workflow w(): string {
    const greeting = "hello";
    return greeting;
}`;

    it("offers inline-const action on a simple binding", () => {
        const range = {
            start: { line: 1, character: 10 },
            end: { line: 1, character: 18 },
        };
        const actions = computeCodeActions(doc(INLINE_SRC), range);
        const inline = actions.find((a) => a.title.startsWith("Inline const"));
        expect(inline).toBeDefined();
    });

    it("refuses inline when RHS identifier is shadowed elsewhere", () => {
        // 'x' is declared twice — inlining 'y' which references 'x' would be
        // unsafe because the inner 'x' could shadow the outer one.
        const SHADOW_SRC = `workflow w(): string {
    const x = "outer";
    const y = x;
    if (true) {
        const x = "inner";
        return y;
    }
    return y;
}`;
        // Place cursor on `const y = x;` (line index 2).
        const range = {
            start: { line: 2, character: 10 },
            end: { line: 2, character: 11 },
        };
        const actions = computeCodeActions(doc(SHADOW_SRC), range);
        const inline = actions.find((a) =>
            a.title.includes("Inline const 'y'"),
        );
        // The safety check should suppress the inline action.
        expect(inline).toBeUndefined();
    });
});

describe("code actions — concat→template", () => {
    const CONCAT_SRC = `workflow w(name: string): string {
    const msg = string.concat(["Hello, ", name, "!"]);
    return msg;
}`;

    it("offers template literal action on a string.concat call", () => {
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 4 },
        };
        const actions = computeCodeActions(doc(CONCAT_SRC), range);
        const tmpl = actions.find((a) => a.title.includes("template literal"));
        expect(tmpl).toBeDefined();
    });

    it("template literal replaces the full concat call (range correct)", () => {
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 4 },
        };
        const actions = computeCodeActions(doc(CONCAT_SRC), range);
        const tmpl = actions.find((a) => a.title.includes("template literal"))!;
        const edits = tmpl.edit!.changes!["file:///t.wf"]!;
        expect(edits.length).toBe(1);
        expect(edits[0]!.newText).toBe("`Hello, ${name}!`");
    });

    it("handles nested brackets safely (does not corrupt syntax)", () => {
        // The OLD regex-based action would break on nested arrays/brackets.
        // The AST-based version must either skip the action or produce
        // a correctly-bounded rewrite.
        const NESTED_SRC = `workflow w(items: array<string>): string {
    const msg = string.concat([list.elementAt(items, 0), "!"]);
    return msg;
}`;
        const range = {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 4 },
        };
        const actions = computeCodeActions(doc(NESTED_SRC), range);
        const tmpl = actions.find((a) => a.title.includes("template literal"));
        // The action can either be omitted (DottedNameExpr only — would
        // print "list.elementAt" which isn't accurate for a call) or it
        // can be emitted with a sound rewrite. Either way it must NOT
        // produce a malformed literal that contains an unbalanced bracket.
        if (tmpl) {
            const edits = tmpl.edit!.changes!["file:///t.wf"]!;
            // Just verify nothing crazy: backtick count is balanced.
            const text = edits[0]!.newText;
            const backticks = (text.match(/`/g) ?? []).length;
            expect(backticks).toBe(2);
        }
    });
});
