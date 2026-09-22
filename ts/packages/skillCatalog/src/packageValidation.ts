// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    constants,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
    PreparedSkillAcquisition,
    SkillAcquisitionLimits,
} from "./acquisitionTypes.js";
import type {
    SkillAcquisitionMetadata,
    SkillFileInput,
    SkillIdentity,
} from "./types.js";
import {
    normalizedSkillPath,
    sha256,
    skillManifestDigest,
    validateSkillPath,
} from "./util.js";

const executableExtensions = new Set([
    ".bat",
    ".cmd",
    ".com",
    ".dll",
    ".exe",
    ".msi",
    ".ps1",
    ".sh",
]);
const excludedSegments = new Set([".git", ".hg", ".svn", "node_modules"]);

export interface CollectedPackage {
    readonly files: readonly SkillFileInput[];
    readonly manifestDigest: string;
    readonly name: string;
    readonly description: string;
}

export async function collectPackage(
    root: string,
    identity: SkillIdentity,
    limits: SkillAcquisitionLimits,
): Promise<CollectedPackage> {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("A staged skill root must be a real directory.");
    }
    const canonicalRoot = await realpath(root);
    const files: SkillFileInput[] = [];
    const foldedPaths = new Map<string, string>();
    let totalBytes = 0;
    let entryCount = 0;

    await visit("");
    files.sort((left, right) => left.path.localeCompare(right.path));
    const skillDocument = files.find((file) => file.path === "SKILL.md");
    if (skillDocument === undefined) {
        throw new Error("An Agent Skill requires a root SKILL.md.");
    }
    const frontmatter = parseSkillFrontmatter(
        skillDocument.content as Uint8Array,
        limits.maxFrontmatterBytes,
    );
    if (frontmatter.name !== identity.name) {
        throw new Error(
            `SKILL.md name '${frontmatter.name}' does not match skill identity '${identity.name}'.`,
        );
    }
    validatePackageHooks(files);
    const manifest = files.map((file) => {
        const content = file.content as Uint8Array;
        return {
            path: file.path,
            sha256: sha256(content),
            size: content.byteLength,
        };
    });
    return {
        files,
        manifestDigest: skillManifestDigest(manifest),
        name: frontmatter.name,
        description: frontmatter.description,
    };

    async function visit(relativeDirectory: string): Promise<void> {
        const directory = path.join(root, ...relativeDirectory.split("/"));
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            entryCount++;
            if (entryCount > limits.maxEntries) {
                throw new Error(
                    `Skill package exceeds ${limits.maxEntries} entries.`,
                );
            }
            const relativePath =
                relativeDirectory.length === 0
                    ? entry.name
                    : `${relativeDirectory}/${entry.name}`;
            validateAcquisitionPath(relativePath, limits, foldedPaths);
            if (
                relativePath
                    .split("/")
                    .some((segment) =>
                        excludedSegments.has(
                            segment.toLocaleLowerCase("en-US"),
                        ),
                    )
            ) {
                throw new Error(
                    `Package metadata directory is not allowed: ${relativePath}`,
                );
            }
            const absolutePath = path.join(root, ...relativePath.split("/"));
            const stat = await lstat(absolutePath);
            if (stat.isSymbolicLink()) {
                throw new Error(
                    `Symbolic links and junctions are not allowed: ${relativePath}`,
                );
            }
            await assertContained(canonicalRoot, absolutePath, relativePath);
            if (stat.isDirectory()) {
                await visit(relativePath);
                continue;
            }
            if (!stat.isFile()) {
                throw new Error(
                    `Only regular package files are allowed: ${relativePath}`,
                );
            }
            validateExecutable(relativePath, stat.mode);
            if (stat.size > limits.maxFileBytes) {
                throw new Error(
                    `Skill file exceeds ${limits.maxFileBytes} bytes: ${relativePath}`,
                );
            }
            if (files.length >= limits.maxFiles) {
                throw new Error(
                    `Skill package exceeds ${limits.maxFiles} files.`,
                );
            }
            totalBytes += stat.size;
            if (totalBytes > limits.maxTotalBytes) {
                throw new Error(
                    `Skill package exceeds ${limits.maxTotalBytes} bytes.`,
                );
            }
            const handle = await open(
                absolutePath,
                constants.O_RDONLY | constants.O_NOFOLLOW,
            );
            const content = await readStableFile(handle, stat, relativePath);
            validateExecutableContent(relativePath, content);
            files.push({ path: relativePath, content });
        }
    }

    async function readStableFile(
        handle: Awaited<ReturnType<typeof open>>,
        expected: Awaited<ReturnType<typeof lstat>>,
        relativePath: string,
    ): Promise<Uint8Array> {
        try {
            const opened = await handle.stat();
            if (
                !opened.isFile() ||
                opened.dev !== expected.dev ||
                opened.ino !== expected.ino ||
                opened.size !== expected.size
            ) {
                throw new Error(
                    `Skill file changed during acquisition: ${relativePath}`,
                );
            }
            const content = await handle.readFile();
            if (content.byteLength !== opened.size) {
                throw new Error(
                    `Skill file changed during acquisition: ${relativePath}`,
                );
            }
            return content;
        } finally {
            await handle.close();
        }
    }
}

export async function writeStagedFile(
    root: string,
    relativePath: string,
    content: Uint8Array,
): Promise<void> {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx", mode: 0o600 });
}

export function validateAcquisitionPath(
    relativePath: string,
    limits: SkillAcquisitionLimits,
    foldedPaths: Map<string, string>,
): void {
    validateSkillPath(relativePath);
    if (relativePath.length > limits.maxPathLength) {
        throw new Error(
            `Skill path exceeds ${limits.maxPathLength} characters: ${relativePath}`,
        );
    }
    const folded = normalizedSkillPath(relativePath);
    const collision = foldedPaths.get(folded);
    if (collision !== undefined) {
        throw new Error(
            collision === relativePath
                ? `Duplicate skill path: ${relativePath}`
                : `Case-folding path collision: ${collision} and ${relativePath}`,
        );
    }
    foldedPaths.set(folded, relativePath);
}

export function validateExecutable(relativePath: string, mode: number): void {
    if ((mode & 0o111) !== 0) {
        throw new Error(
            `Executable package file is not allowed: ${relativePath}`,
        );
    }
    if (
        executableExtensions.has(path.posix.extname(relativePath).toLowerCase())
    ) {
        throw new Error(
            `Executable package file is not allowed: ${relativePath}`,
        );
    }
}

function validateExecutableContent(
    relativePath: string,
    content: Uint8Array,
): void {
    const magic = Buffer.from(content.subarray(0, 4));
    const executable =
        (magic[0] === 0x4d && magic[1] === 0x5a) ||
        magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
        magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
        magic.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
        magic.equals(Buffer.from([0xce, 0xfa, 0xed, 0xfe])) ||
        magic.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xce])) ||
        magic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])) ||
        (magic[0] === 0x23 && magic[1] === 0x21);
    if (executable) {
        throw new Error(
            `Executable package content is not allowed: ${relativePath}`,
        );
    }
}

export function prepareAcquisition(
    collected: CollectedPackage,
    source: SkillAcquisitionMetadata,
    displayName?: string,
    description?: string,
): PreparedSkillAcquisition {
    return {
        files: collected.files,
        metadata: source,
        displayName: displayName ?? collected.name,
        description: description ?? collected.description,
    };
}

async function assertContained(
    canonicalRoot: string,
    candidate: string,
    relativePath: string,
): Promise<void> {
    const canonicalCandidate = await realpath(candidate);
    const relative = path.relative(canonicalRoot, canonicalCandidate);
    if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    ) {
        throw new Error(`Package path escapes its root: ${relativePath}`);
    }
}

function parseSkillFrontmatter(
    content: Uint8Array,
    maxBytes: number,
): { name: string; description: string } {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
            content.subarray(0, Math.min(content.byteLength, maxBytes + 1)),
        );
    } catch {
        throw new Error("SKILL.md must contain valid UTF-8.");
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (lines[0] !== "---") {
        throw new Error("SKILL.md must begin with YAML frontmatter.");
    }
    const end = lines.indexOf("---", 1);
    if (end < 0) {
        throw new Error(
            content.byteLength > maxBytes
                ? `SKILL.md frontmatter exceeds ${maxBytes} bytes.`
                : "SKILL.md frontmatter is not terminated.",
        );
    }
    const values = new Map<string, string>();
    for (const line of lines.slice(1, end)) {
        if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
            continue;
        }
        const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
        if (match === null) {
            throw new Error(
                "SKILL.md frontmatter must use scalar YAML fields.",
            );
        }
        const [, key, rawValue] = match;
        if (values.has(key)) {
            throw new Error(`Duplicate SKILL.md frontmatter field: ${key}`);
        }
        values.set(key, parseScalar(rawValue));
    }
    const name = values.get("name");
    const description = values.get("description");
    if (
        name === undefined ||
        description === undefined ||
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) ||
        description.trim().length === 0 ||
        description.length > 1024
    ) {
        throw new Error(
            "SKILL.md frontmatter requires a valid name and non-empty description.",
        );
    }
    return { name, description };
}

function parseScalar(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (typeof parsed === "string") {
                return parsed;
            }
        } catch {
            // Report the common scalar error below.
        }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    if (/[\[\]{}&*!|>@`]/.test(trimmed)) {
        throw new Error("Unsupported complex SKILL.md frontmatter value.");
    }
    return trimmed.replace(/\s+#.*$/, "").trim();
}

function validatePackageHooks(files: readonly SkillFileInput[]): void {
    const packageFiles = files.filter(
        (file) =>
            path.posix.basename(file.path).toLocaleLowerCase("en-US") ===
            "package.json",
    );
    for (const packageJson of packageFiles) {
        validatePackageJson(packageJson);
    }
}

function validatePackageJson(packageJson: SkillFileInput): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
                packageJson.content as Uint8Array,
            ),
        );
    } catch {
        throw new Error(`${packageJson.path} must contain valid UTF-8 JSON.`);
    }
    if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
    ) {
        throw new Error(`${packageJson.path} must contain an object.`);
    }
    const record = parsed as Record<string, unknown>;
    if (
        record.scripts !== undefined ||
        record.bin !== undefined ||
        record.gypfile !== undefined
    ) {
        throw new Error(
            "Package hooks and executable package entries are forbidden.",
        );
    }
}
