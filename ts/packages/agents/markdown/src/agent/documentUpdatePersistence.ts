// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyDocumentOperations } from "./documentOperations.js";
import type { DocumentOperation } from "./markdownOperationSchema.js";
import {
    resolveRealDirectory,
    resolveExistingFileWithinRoot,
} from "./documentPathPolicy.js";

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

function resolveBoundFile(binding: DocumentBinding): string {
    if (resolveRealDirectory(binding.root) !== binding.root) {
        throw new Error("The authorized markdown workspace root changed");
    }
    const resolved = resolveExistingFileWithinRoot(
        binding.root,
        binding.relativePath,
    );
    if (
        resolved === undefined ||
        path.relative(
            resolved,
            path.resolve(binding.root, binding.relativePath),
        ) !== "" ||
        path.relative(resolved, binding.filePath) !== ""
    ) {
        throw new Error(
            "The markdown document binding changed or is outside its authorized workspace",
        );
    }
    return resolved;
}

export async function readBoundDocument(binding: DocumentBinding) {
    binding = { ...binding };
    const filePath = resolveBoundFile(binding);
    const rootIdentity = fs.statSync(binding.root, { bigint: true });
    const fileIdentity = fs.statSync(filePath, { bigint: true });
    const file = await fs.promises.open(filePath, "r");
    let content: string;
    try {
        const openedIdentity = await file.stat({ bigint: true });
        if (!sameFileIdentity(fileIdentity, openedIdentity)) {
            throw new Error("Document binding file changed while opening");
        }
        // Check the opened handle before reading, not just its pathname.
        resolveBoundFile(binding);
        content = await file.readFile("utf-8");
    } finally {
        await file.close();
    }

    // The root or file may have been replaced during any of the awaits above.
    resolveBoundFile(binding);
    if (
        !sameFileIdentity(
            rootIdentity,
            fs.statSync(binding.root, { bigint: true }),
        )
    ) {
        throw new Error("The authorized markdown workspace root changed");
    }
    const currentIdentity = fs.statSync(filePath, { bigint: true });
    if (!sameFileIdentity(fileIdentity, currentIdentity)) {
        throw new Error("Document binding file changed while reading");
    }
    // ctime can change on a read on Windows; it is not a content revision.
    if (
        fileIdentity.size !== currentIdentity.size ||
        fileIdentity.mtimeNs !== currentIdentity.mtimeNs
    ) {
        throw new Error("Document changed while reading (revision mismatch)");
    }
    return { content, revision: computeContentRevision(content), filePath };
}

function sameFileIdentity(
    left: fs.BigIntStats,
    right: fs.BigIntStats,
): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

export function persistDocumentOperations(
    binding: DocumentBinding,
    operations: DocumentOperation[],
    expected: UpdateExpectations,
) {
    validateIdentity(binding, expected);
    let filePath = resolveBoundFile(binding);
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
    filePath = resolveBoundFile(binding);
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
