// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver/node.js";
import { compileIR } from "../src/features/compileIR.js";
import { loadTaskSchemas } from "../src/taskSchemas.js";

const schemas = loadTaskSchemas();

class FakeDocuments {
    private map = new Map<string, TextDocument>();
    add(uri: string, text: string): void {
        this.map.set(uri, TextDocument.create(uri, "workflow", 1, text));
    }
    get(uri: string): TextDocument | undefined {
        return this.map.get(uri);
    }
}

describe("compileIR", () => {
    it("returns IR for a well-typed workflow", () => {
        const docs = new FakeDocuments();
        docs.add(
            "file:///t.wf",
            `workflow w(name: string): string {\n    return name;\n}`,
        );
        const r = compileIR(
            docs as unknown as TextDocuments<TextDocument>,
            { uri: "file:///t.wf" },
            schemas,
        );
        expect(r.errors).toEqual([]);
        expect(r.ir).toBeDefined();
    });

    it("returns errors for invalid source", () => {
        const docs = new FakeDocuments();
        docs.add("file:///t.wf", `workflow w(): { return 1 }`);
        const r = compileIR(
            docs as unknown as TextDocuments<TextDocument>,
            { uri: "file:///t.wf" },
            schemas,
        );
        expect(r.errors.length).toBeGreaterThan(0);
        for (const e of r.errors) {
            expect(typeof e.message).toBe("string");
            expect(typeof e.line).toBe("number");
        }
    });

    it("reports an unknown-document error for missing URIs", () => {
        const docs = new FakeDocuments();
        const r = compileIR(
            docs as unknown as TextDocuments<TextDocument>,
            { uri: "file:///missing.wf" },
            schemas,
        );
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]!.message).toContain("unknown document");
    });
});
