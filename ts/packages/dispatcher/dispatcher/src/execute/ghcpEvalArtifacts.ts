// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

type Artifact = { path: string; sha256: string };
type Manifest = { root: string; artifacts: Artifact[] };

function originalContent(result: object): string[] {
    const expected: string[] = [];
    if (
        "detailedContent" in result &&
        typeof result.detailedContent === "string"
    )
        expected.push(result.detailedContent);
    const chunks =
        "contents" in result && Array.isArray(result.contents)
            ? result.contents
            : [];
    const texts = chunks.flatMap((chunk: unknown) =>
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text" &&
        "text" in chunk &&
        typeof chunk.text === "string"
            ? [chunk.text]
            : [],
    );
    if (texts.length) expected.push(texts.join("\n"), texts.join("\n\n"));
    if (
        "structuredContent" in result &&
        result.structuredContent !== undefined
    ) {
        const structured = JSON.stringify(result.structuredContent);
        expected.push(
            ...expected.map((text) => `${text}\n\n${structured}`),
            structured,
            JSON.stringify(result.structuredContent, null, 2),
        );
    }
    return expected;
}

function fingerprint(file: string, root: string): Artifact {
    const canonicalRoot = fs.realpathSync(root);
    const canonical = fs.realpathSync(file);
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 10 * 1024 * 1024 ||
        path.dirname(canonical).toLowerCase() !== canonicalRoot.toLowerCase() ||
        path.resolve(file).toLowerCase() !== canonical.toLowerCase() ||
        !/^(?:\d+-)?copilot-tool-output-[\w-]+\.txt$/.test(path.basename(file))
    ) {
        throw new Error("Untrusted GHCP evaluation output artifact");
    }
    return {
        path: canonical,
        sha256: createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex"),
    };
}

/** Register only an SDK completion's overflow notice inside this trial's private temp directory. */
export function registerGhcpEvalArtifact(
    result: unknown,
    root: string,
    manifestFile: string,
): Artifact | undefined {
    if (
        !result ||
        typeof result !== "object" ||
        !("content" in result) ||
        typeof result.content !== "string"
    )
        return undefined;
    const match = result.content.match(
        /^Output too large to read at once[^\r\n]*?Saved to:\s*([^\r\n]+)/,
    );
    if (!match) return undefined;
    const artifact = fingerprint(match[1].trim(), root);
    const text = fs.readFileSync(artifact.path, "utf8");
    if (!originalContent(result).includes(text))
        throw new Error("Output artifact does not match the SDK result");
    const manifest: Manifest = JSON.parse(
        fs.readFileSync(manifestFile, "utf8"),
    );
    if (manifest.root !== root) throw new Error("Artifact scope mismatch");
    if (!manifest.artifacts.some((entry) => entry.path === artifact.path))
        manifest.artifacts.push(artifact);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    return artifact;
}

export function isGhcpEvalArtifact(
    file: string,
    manifestFile = process.env.TYPEAGENT_GHCP_EVAL_ARTIFACTS,
): boolean {
    if (!manifestFile) return false;
    const manifest: Manifest = JSON.parse(
        fs.readFileSync(manifestFile, "utf8"),
    );
    const expected = manifest.artifacts.find(
        (entry) =>
            entry.path.toLowerCase() === path.resolve(file).toLowerCase(),
    );
    if (!expected) return false;
    const actual = fingerprint(file, manifest.root);
    return actual.sha256 === expected.sha256;
}
