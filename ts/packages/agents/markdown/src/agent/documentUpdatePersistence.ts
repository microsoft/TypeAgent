// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyDocumentOperations } from "./documentOperations.js";
import type { DocumentOperation } from "./markdownOperationSchema.js";
import {
    isCanonicalDirectory,
    resolveExistingFileWithinRoot,
    resolveWritableFileWithinRoot,
} from "./pathPolicy.js";

export interface DocumentBinding {
    token: string | undefined;
    root: string;
    relativePath: string;
    filePath: string;
}

export interface UpdateExpectations {
    bindingToken: string | undefined;
    root: string | undefined;
    relativePath: string | undefined;
    revision: string;
    updatedRevision: string | undefined;
}

export function computeContentRevision(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function validateIdentity(
    binding: DocumentBinding,
    expected: UpdateExpectations,
): void {
    if (
        expected.bindingToken !== undefined &&
        expected.bindingToken !== binding.token
    ) {
        throw new Error("Document binding token changed");
    }
    if (expected.root !== undefined && expected.root !== binding.root) {
        throw new Error("Document binding root changed");
    }
    if (
        expected.relativePath !== undefined &&
        expected.relativePath !== binding.relativePath
    ) {
        throw new Error("Document binding path changed");
    }
}

function resolveBoundFile(binding: DocumentBinding, write: boolean): string {
    if (!isCanonicalDirectory(binding.root)) {
        throw new Error("The authorized markdown workspace root changed");
    }
    const resolved = write
        ? resolveWritableFileWithinRoot(binding.root, binding.relativePath)
        : resolveExistingFileWithinRoot(binding.root, binding.relativePath);
    if (
        resolved === undefined ||
        path.relative(resolved, binding.filePath) !== ""
    ) {
        throw new Error(
            "The markdown document binding changed or is outside its authorized workspace",
        );
    }
    return resolved;
}

export function readBoundDocument(binding: DocumentBinding) {
    const filePath = resolveBoundFile(binding, false);
    const content = fs.readFileSync(filePath, "utf-8");
    return { content, revision: computeContentRevision(content), filePath };
}

export function persistDocumentOperations(
    binding: DocumentBinding,
    operations: DocumentOperation[],
    expected: UpdateExpectations,
) {
    validateIdentity(binding, expected);
    let filePath = resolveBoundFile(binding, true);
    const currentContent = fs.readFileSync(filePath, "utf-8");
    const currentRevision = computeContentRevision(currentContent);
    if (expected.updatedRevision === currentRevision) {
        return {
            content: currentContent,
            revision: currentRevision,
            alreadyApplied: true,
            filePath,
        };
    }
    if (currentRevision !== expected.revision) {
        throw new Error(
            "Document changed between read and apply (revision mismatch)",
        );
    }

    const content = applyDocumentOperations(currentContent, operations);
    const revision = computeContentRevision(content);
    if (
        expected.updatedRevision !== undefined &&
        expected.updatedRevision !== revision
    ) {
        throw new Error("Updated document revision does not match operations");
    }

    validateIdentity(binding, expected);
    filePath = resolveBoundFile(binding, true);
    if (
        computeContentRevision(fs.readFileSync(filePath, "utf-8")) !==
        currentRevision
    ) {
        throw new Error(
            "Document changed between validation and write (revision mismatch)",
        );
    }
    fs.writeFileSync(filePath, content, "utf-8");
    return { content, revision, alreadyApplied: false, filePath };
}
