// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    isGhcpEvalArtifact,
    registerGhcpEvalArtifact,
} from "../src/execute/ghcpEvalArtifacts.js";

describe("isolated output artifact provenance", () => {
    let root: string;
    let manifest: string;
    let artifact: string;
    const notice = (file: string) => ({
        content: `Output too large to read at once (30 KB). Saved to:\n${file}\nPreview`,
        detailedContent: "tool evidence",
    });
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-artifacts-"));
        manifest = path.join(root, "manifest.json");
        artifact = path.join(root, "123-copilot-tool-output-abc.txt");
        fs.writeFileSync(manifest, JSON.stringify({ root, artifacts: [] }));
        fs.writeFileSync(artifact, "tool evidence");
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    it("requires a trusted completion notice and exact content at read time", () => {
        expect(isGhcpEvalArtifact(artifact, manifest)).toBe(false);
        expect(
            registerGhcpEvalArtifact({ content: "ordinary" }, root, manifest),
        ).toBeUndefined();
        registerGhcpEvalArtifact(notice(artifact), root, manifest);
        expect(isGhcpEvalArtifact(artifact, manifest)).toBe(true);
        fs.writeFileSync(artifact, "changed");
        expect(isGhcpEvalArtifact(artifact, manifest)).toBe(false);
    });
    it("rejects arbitrary names, subdirectories and hard-link aliases", () => {
        const other = path.join(root, "private.txt");
        fs.writeFileSync(other, "private");
        expect(() =>
            registerGhcpEvalArtifact(notice(other), root, manifest),
        ).toThrow("Untrusted");
        const child = path.join(root, "child");
        fs.mkdirSync(child);
        const nested = path.join(child, path.basename(artifact));
        fs.writeFileSync(nested, "nested");
        expect(() =>
            registerGhcpEvalArtifact(notice(nested), root, manifest),
        ).toThrow("Untrusted");
        const alias = path.join(root, "copilot-tool-output-alias.txt");
        fs.linkSync(artifact, alias);
        expect(() =>
            registerGhcpEvalArtifact(notice(alias), root, manifest),
        ).toThrow("Untrusted");
    });
    it("rejects another trial's scope even for a correctly named output", () => {
        const child = path.join(root, "other-trial");
        fs.mkdirSync(child);
        expect(() =>
            registerGhcpEvalArtifact(notice(artifact), child, manifest),
        ).toThrow("Untrusted");
        expect(isGhcpEvalArtifact(artifact, undefined)).toBe(false);
    });
    it("accepts same-line SDK notices only when content matches the structured result", () => {
        fs.writeFileSync(
            artifact,
            JSON.stringify({ status: "completed", output: ["evidence"] }),
        );
        const result = {
            content: `Output too large to read at once (30 KB). Saved to: ${artifact}\nPreview`,
            structuredContent: { status: "completed", output: ["evidence"] },
        };
        registerGhcpEvalArtifact(result, root, manifest);
        expect(isGhcpEvalArtifact(artifact, manifest)).toBe(true);
        fs.writeFileSync(
            artifact,
            JSON.stringify({ secret: "not the result" }),
        );
        expect(() => registerGhcpEvalArtifact(result, root, manifest)).toThrow(
            "does not match",
        );
    });
    it("verifies SDK text plus structured content without accepting suffixes", () => {
        const structuredContent = { status: "completed", output: ["evidence"] };
        const text = JSON.stringify(structuredContent, null, 2);
        const body = `${text}\n\n${JSON.stringify(structuredContent)}`;
        const result = {
            ...notice(artifact),
            structuredContent,
            contents: [{ type: "text", text }],
        };
        fs.writeFileSync(artifact, body);
        registerGhcpEvalArtifact(result, root, manifest);
        expect(isGhcpEvalArtifact(artifact, manifest)).toBe(true);
        fs.writeFileSync(artifact, body + "\nunrelated secret");
        expect(() => registerGhcpEvalArtifact(result, root, manifest)).toThrow(
            "does not match",
        );
    });
});
