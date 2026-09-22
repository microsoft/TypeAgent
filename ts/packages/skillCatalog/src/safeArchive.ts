// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { gunzipSync, inflateRawSync } from "node:zlib";
import type { SkillAcquisitionLimits } from "./acquisitionTypes.js";
import {
    validateAcquisitionPath,
    validateExecutable,
    writeStagedFile,
} from "./packageValidation.js";
import { sha256 } from "./util.js";

const tarBlockSize = 512;
const zipEndSignature = 0x06054b50;
const zipCentralSignature = 0x02014b50;
const zipLocalSignature = 0x04034b50;

interface ZipEntry {
    readonly flags: number;
    readonly method: number;
    readonly checksum: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly diskStart: number;
    readonly unixMode: number;
    readonly localOffset: number;
    readonly name: string;
    readonly directory: boolean;
    readonly relativePath: string;
    readonly nextOffset: number;
}

interface TarEntry {
    readonly mode: number;
    readonly size: number;
    readonly type: number;
    readonly contentOffset: number;
    readonly nextOffset: number;
    readonly path: string;
}

interface TarExtractionState {
    files: number;
    entries: number;
    totalBytes: number;
}

export async function extractArchive(
    archivePath: string,
    requestedFormat: "zip" | "tar" | "tar.gz" | undefined,
    target: string,
    limits: SkillAcquisitionLimits,
): Promise<string> {
    const archive = await readFile(archivePath);
    if (archive.byteLength > limits.maxArchiveBytes) {
        throw new Error(`Archive exceeds ${limits.maxArchiveBytes} bytes.`);
    }
    await extractArchiveData(archive, requestedFormat, target, limits);
    return sha256(archive);
}

export async function extractArchiveData(
    archive: Uint8Array,
    requestedFormat: "zip" | "tar" | "tar.gz" | undefined,
    target: string,
    limits: SkillAcquisitionLimits,
): Promise<void> {
    const bytes = Buffer.from(archive);
    const format = detectFormat(bytes, requestedFormat);
    if (format === "zip") {
        await extractZip(bytes, target, limits);
    } else {
        const tar =
            format === "tar.gz"
                ? gunzipSync(bytes, {
                      maxOutputLength: maximumExpandedArchiveSize(limits),
                  })
                : bytes;
        await extractTar(tar, target, limits);
    }
}

function detectFormat(
    archive: Buffer,
    requested: "zip" | "tar" | "tar.gz" | undefined,
): "zip" | "tar" | "tar.gz" {
    if (archive.byteLength === 0) {
        throw new Error("Archive is empty.");
    }
    const detected =
        archive.byteLength >= 4 && archive.readUInt32LE(0) === 0x04034b50
            ? "zip"
            : archive[0] === 0x1f && archive[1] === 0x8b
              ? "tar.gz"
              : "tar";
    if (requested !== undefined && requested !== detected) {
        throw new Error(
            `Archive content is ${detected}, not requested ${requested}.`,
        );
    }
    return detected;
}

async function extractZip(
    archive: Buffer,
    target: string,
    limits: SkillAcquisitionLimits,
): Promise<void> {
    const endOffset = findZipEnd(archive);
    const disk = archive.readUInt16LE(endOffset + 4);
    const centralDisk = archive.readUInt16LE(endOffset + 6);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    const centralSize = archive.readUInt32LE(endOffset + 12);
    const centralOffset = archive.readUInt32LE(endOffset + 16);
    if (
        disk !== 0 ||
        centralDisk !== 0 ||
        entryCount === 0xffff ||
        centralSize === 0xffffffff ||
        centralOffset === 0xffffffff
    ) {
        throw new Error("Multi-disk and ZIP64 archives are not supported.");
    }
    if (
        entryCount > limits.maxEntries ||
        centralOffset + centralSize > endOffset
    ) {
        throw new Error("ZIP central directory exceeds configured limits.");
    }
    const foldedPaths = new Map<string, string>();
    let offset = centralOffset;
    let totalBytes = 0;
    let fileCount = 0;
    for (let index = 0; index < entryCount; index++) {
        const entry = readZipEntry(archive, offset);
        offset = entry.nextOffset;
        if (entry.directory && entry.relativePath.length === 0) {
            continue;
        }
        validateAcquisitionPath(entry.relativePath, limits, foldedPaths);
        validateZipEntry(entry);
        if (entry.directory) {
            continue;
        }
        fileCount++;
        if (fileCount > limits.maxFiles) {
            throw new Error(`Skill package exceeds ${limits.maxFiles} files.`);
        }
        validateExecutable(entry.relativePath, entry.unixMode);
        totalBytes = accountFile(
            entry.relativePath,
            entry.uncompressedSize,
            totalBytes,
            limits,
        );
        const content = inflateZipEntry(
            archive,
            entry.localOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.method,
            entry.name,
            limits,
        );
        if (crc32(content) !== entry.checksum) {
            throw new Error(`ZIP checksum mismatch: ${entry.relativePath}`);
        }
        await writeStagedFile(target, entry.relativePath, content);
    }
    if (offset !== centralOffset + centralSize) {
        throw new Error("ZIP central directory size is inconsistent.");
    }
}

function readZipEntry(archive: Buffer, offset: number): ZipEntry {
    requireRange(archive, offset, 46, "ZIP central directory");
    if (archive.readUInt32LE(offset) !== zipCentralSignature) {
        throw new Error("Malformed ZIP central directory.");
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const variableLength = nameLength + extraLength + commentLength;
    requireRange(archive, offset + 46, variableLength, "ZIP entry");
    const name = decodeArchivePath(
        archive.subarray(offset + 46, offset + 46 + nameLength),
    );
    const directory = name.endsWith("/");
    return {
        flags: archive.readUInt16LE(offset + 8),
        method: archive.readUInt16LE(offset + 10),
        checksum: archive.readUInt32LE(offset + 16),
        compressedSize: archive.readUInt32LE(offset + 20),
        uncompressedSize: archive.readUInt32LE(offset + 24),
        diskStart: archive.readUInt16LE(offset + 34),
        unixMode: archive.readUInt32LE(offset + 38) >>> 16,
        localOffset: archive.readUInt32LE(offset + 42),
        name,
        directory,
        relativePath: normalizeArchivePath(
            directory ? name.slice(0, -1) : name,
        ),
        nextOffset: offset + 46 + variableLength,
    };
}

function validateZipEntry(entry: ZipEntry): void {
    const fileType = entry.unixMode & 0o170000;
    const invalidFileType = entry.directory
        ? fileType !== 0 && fileType !== 0o040000
        : fileType !== 0 && fileType !== 0o100000;
    if (
        entry.diskStart !== 0 ||
        (entry.flags & 1) !== 0 ||
        ![0, 8].includes(entry.method) ||
        invalidFileType
    ) {
        throw new Error(`Unsafe or unsupported ZIP entry: ${entry.name}`);
    }
}

function inflateZipEntry(
    archive: Buffer,
    localOffset: number,
    compressedSize: number,
    uncompressedSize: number,
    method: number,
    expectedName: string,
    limits: SkillAcquisitionLimits,
): Uint8Array {
    requireRange(archive, localOffset, 30, "ZIP local header");
    if (archive.readUInt32LE(localOffset) !== zipLocalSignature) {
        throw new Error("Malformed ZIP local header.");
    }
    const nameLength = archive.readUInt16LE(localOffset + 26);
    const extraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + nameLength + extraLength;
    requireRange(archive, dataOffset, compressedSize, "ZIP file data");
    const localName = decodeArchivePath(
        archive.subarray(localOffset + 30, localOffset + 30 + nameLength),
    );
    if (localName !== expectedName) {
        throw new Error("ZIP local and central paths do not match.");
    }
    const compressed = archive.subarray(
        dataOffset,
        dataOffset + compressedSize,
    );
    const content =
        method === 0
            ? compressed
            : inflateRawSync(compressed, {
                  maxOutputLength: Math.min(
                      limits.maxFileBytes,
                      Math.max(1, uncompressedSize),
                  ),
              });
    if (content.byteLength !== uncompressedSize) {
        throw new Error(`ZIP entry size mismatch: ${expectedName}`);
    }
    return content;
}

async function extractTar(
    archive: Uint8Array,
    target: string,
    limits: SkillAcquisitionLimits,
): Promise<void> {
    const data = Buffer.from(archive);
    const foldedPaths = new Map<string, string>();
    let offset = 0;
    let pendingPath: string | undefined;
    const state: TarExtractionState = {
        files: 0,
        entries: 0,
        totalBytes: 0,
    };
    while (offset + tarBlockSize <= data.byteLength) {
        const header = data.subarray(offset, offset + tarBlockSize);
        if (header.every((value) => value === 0)) {
            return;
        }
        const entry = readTarEntry(data, offset);
        offset = entry.nextOffset;
        if (isPaxHeader(entry)) {
            pendingPath = readPaxPath(data, entry);
            continue;
        }
        const relativePath = normalizeArchivePath(pendingPath ?? entry.path);
        pendingPath = undefined;
        await extractTarEntry(
            data,
            entry,
            relativePath,
            target,
            limits,
            foldedPaths,
            state,
        );
    }
    throw new Error("TAR archive is missing its end marker.");
}

function readTarEntry(data: Buffer, offset: number): TarEntry {
    const header = data.subarray(offset, offset + tarBlockSize);
    validateTarChecksum(header);
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const mode = readTarOctal(header, 100, 8, "mode");
    const size = readTarOctal(header, 124, 12, "size");
    const contentOffset = offset + tarBlockSize;
    requireRange(data, contentOffset, size, "TAR file data");
    return {
        mode,
        size,
        type: header[156],
        contentOffset,
        nextOffset:
            contentOffset + Math.ceil(size / tarBlockSize) * tarBlockSize,
        path: prefix.length === 0 ? name : `${prefix}/${name}`,
    };
}

function isPaxHeader(entry: TarEntry): boolean {
    return entry.type === 0x67 || entry.type === 0x78;
}

function readPaxPath(data: Buffer, entry: TarEntry): string | undefined {
    const attributes = parsePaxAttributes(
        data.subarray(entry.contentOffset, entry.contentOffset + entry.size),
    );
    const unsupported = [...attributes.keys()].filter(
        (key) => !["comment", "mtime", "path"].includes(key),
    );
    if (
        unsupported.length > 0 ||
        (entry.type === 0x67 && attributes.has("path"))
    ) {
        throw new Error(
            `Unsupported TAR extended attribute: ${unsupported[0] ?? "path"}`,
        );
    }
    return attributes.get("path");
}

async function extractTarEntry(
    data: Buffer,
    entry: TarEntry,
    relativePath: string,
    target: string,
    limits: SkillAcquisitionLimits,
    foldedPaths: Map<string, string>,
    state: TarExtractionState,
): Promise<void> {
    const directory = entry.type === 0x35;
    const regular = entry.type === 0 || entry.type === 0x30;
    state.entries++;
    if (state.entries > limits.maxEntries) {
        throw new Error(`Skill package exceeds ${limits.maxEntries} entries.`);
    }
    if (directory && relativePath.length === 0) {
        return;
    }
    validateAcquisitionPath(
        directory && relativePath.endsWith("/")
            ? relativePath.slice(0, -1)
            : relativePath,
        limits,
        foldedPaths,
    );
    if (!regular && !directory) {
        throw new Error(
            `TAR links, devices, and extended entries are forbidden: ${relativePath}`,
        );
    }
    if (directory) {
        if (entry.size !== 0) {
            throw new Error(`TAR directory has data: ${relativePath}`);
        }
        return;
    }
    validateExecutable(relativePath, entry.mode);
    state.files++;
    if (state.files > limits.maxFiles) {
        throw new Error(`Skill package exceeds ${limits.maxFiles} files.`);
    }
    state.totalBytes = accountFile(
        relativePath,
        entry.size,
        state.totalBytes,
        limits,
    );
    await writeStagedFile(
        target,
        relativePath,
        data.subarray(entry.contentOffset, entry.contentOffset + entry.size),
    );
}

function findZipEnd(archive: Buffer): number {
    const minimum = Math.max(0, archive.byteLength - 65557);
    for (let offset = archive.byteLength - 22; offset >= minimum; offset--) {
        if (
            archive.readUInt32LE(offset) === zipEndSignature &&
            offset + 22 + archive.readUInt16LE(offset + 20) ===
                archive.byteLength
        ) {
            return offset;
        }
    }
    throw new Error("ZIP end record was not found.");
}

function decodeArchivePath(value: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
        throw new Error("Archive paths must use UTF-8.");
    }
}

function normalizeArchivePath(value: string): string {
    let normalized = value;
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    return normalized === "." ? "" : normalized;
}

function parsePaxAttributes(content: Uint8Array): Map<string, string> {
    const attributes = new Map<string, string>();
    let offset = 0;
    while (offset < content.byteLength) {
        const space = content.indexOf(0x20, offset);
        if (space < 0) {
            throw new Error("Malformed TAR extended header.");
        }
        const lengthText = new TextDecoder().decode(
            content.subarray(offset, space),
        );
        if (!/^[1-9][0-9]*$/.test(lengthText)) {
            throw new Error("Malformed TAR extended header length.");
        }
        const length = Number.parseInt(lengthText, 10);
        if (
            !Number.isSafeInteger(length) ||
            length <= space - offset + 1 ||
            offset + length > content.byteLength ||
            content[offset + length - 1] !== 0x0a
        ) {
            throw new Error("Malformed TAR extended header record.");
        }
        const record = decodeArchivePath(
            content.subarray(space + 1, offset + length - 1),
        );
        const separator = record.indexOf("=");
        if (separator <= 0) {
            throw new Error("Malformed TAR extended header value.");
        }
        const key = record.slice(0, separator);
        if (attributes.has(key)) {
            throw new Error(`Duplicate TAR extended attribute: ${key}`);
        }
        attributes.set(key, record.slice(separator + 1));
        offset += length;
    }
    return attributes;
}

function accountFile(
    relativePath: string,
    size: number,
    totalBytes: number,
    limits: SkillAcquisitionLimits,
): number {
    if (!Number.isSafeInteger(size) || size > limits.maxFileBytes) {
        throw new Error(
            `Skill file exceeds ${limits.maxFileBytes} bytes: ${relativePath}`,
        );
    }
    const next = totalBytes + size;
    if (next > limits.maxTotalBytes) {
        throw new Error(`Skill package exceeds ${limits.maxTotalBytes} bytes.`);
    }
    return next;
}

function requireRange(
    data: Uint8Array,
    offset: number,
    length: number,
    label: string,
): void {
    if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > data.byteLength
    ) {
        throw new Error(`${label} extends beyond the archive.`);
    }
}

function readTarString(
    header: Uint8Array,
    offset: number,
    length: number,
): string {
    const field = header.subarray(offset, offset + length);
    const end = field.indexOf(0);
    return decodeArchivePath(end < 0 ? field : field.subarray(0, end));
}

function readTarOctal(
    header: Uint8Array,
    offset: number,
    length: number,
    label: string,
): number {
    const value = readTarString(header, offset, length).trim();
    if (!/^[0-7]+$/.test(value)) {
        throw new Error(`Invalid TAR ${label}.`);
    }
    const parsed = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`TAR ${label} is too large.`);
    }
    return parsed;
}

function validateTarChecksum(header: Uint8Array): void {
    const expected = readTarOctal(header, 148, 8, "checksum");
    let actual = 0;
    for (let index = 0; index < header.length; index++) {
        actual += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (actual !== expected) {
        throw new Error("TAR header checksum mismatch.");
    }
}

function maximumExpandedArchiveSize(limits: SkillAcquisitionLimits): number {
    return limits.maxTotalBytes + limits.maxEntries * 1024 + 1024 * 1024;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
