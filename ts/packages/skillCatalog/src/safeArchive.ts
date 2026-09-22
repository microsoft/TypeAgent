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
        requireRange(archive, offset, 46, "ZIP central directory");
        if (archive.readUInt32LE(offset) !== zipCentralSignature) {
            throw new Error("Malformed ZIP central directory.");
        }
        const flags = archive.readUInt16LE(offset + 8);
        const method = archive.readUInt16LE(offset + 10);
        const checksum = archive.readUInt32LE(offset + 16);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const diskStart = archive.readUInt16LE(offset + 34);
        const externalAttributes = archive.readUInt32LE(offset + 38);
        const localOffset = archive.readUInt32LE(offset + 42);
        requireRange(
            archive,
            offset + 46,
            nameLength + extraLength + commentLength,
            "ZIP entry",
        );
        const name = decodeArchivePath(
            archive.subarray(offset + 46, offset + 46 + nameLength),
        );
        offset += 46 + nameLength + extraLength + commentLength;
        const directory = name.endsWith("/");
        const relativePath = normalizeArchivePath(
            directory ? name.slice(0, -1) : name,
        );
        if (directory && relativePath.length === 0) {
            continue;
        }
        validateAcquisitionPath(relativePath, limits, foldedPaths);
        const unixMode = externalAttributes >>> 16;
        const fileType = unixMode & 0o170000;
        if (
            diskStart !== 0 ||
            (flags & 1) !== 0 ||
            ![0, 8].includes(method) ||
            (!directory && fileType !== 0 && fileType !== 0o100000) ||
            (directory && fileType !== 0 && fileType !== 0o040000)
        ) {
            throw new Error(`Unsafe or unsupported ZIP entry: ${name}`);
        }
        if (directory) {
            continue;
        }
        fileCount++;
        if (fileCount > limits.maxFiles) {
            throw new Error(`Skill package exceeds ${limits.maxFiles} files.`);
        }
        validateExecutable(relativePath, unixMode);
        totalBytes = accountFile(
            relativePath,
            uncompressedSize,
            totalBytes,
            limits,
        );
        const content = inflateZipEntry(
            archive,
            localOffset,
            compressedSize,
            uncompressedSize,
            method,
            name,
            limits,
        );
        if (crc32(content) !== checksum) {
            throw new Error(`ZIP checksum mismatch: ${relativePath}`);
        }
        await writeStagedFile(target, relativePath, content);
    }
    if (offset !== centralOffset + centralSize) {
        throw new Error("ZIP central directory size is inconsistent.");
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
    let totalBytes = 0;
    let files = 0;
    let entries = 0;
    let pendingPath: string | undefined;
    while (offset + tarBlockSize <= data.byteLength) {
        const header = data.subarray(offset, offset + tarBlockSize);
        if (header.every((value) => value === 0)) {
            return;
        }
        validateTarChecksum(header);
        const name = readTarString(header, 0, 100);
        const prefix = readTarString(header, 345, 155);
        const mode = readTarOctal(header, 100, 8, "mode");
        const size = readTarOctal(header, 124, 12, "size");
        const type = header[156];
        const contentOffset = offset + tarBlockSize;
        requireRange(data, contentOffset, size, "TAR file data");
        if (type === 0x67 || type === 0x78) {
            const attributes = parsePaxAttributes(
                data.subarray(contentOffset, contentOffset + size),
            );
            const unsupported = [...attributes.keys()].filter(
                (key) => !["comment", "mtime", "path"].includes(key),
            );
            if (
                unsupported.length > 0 ||
                (type === 0x67 && attributes.has("path"))
            ) {
                throw new Error(
                    `Unsupported TAR extended attribute: ${unsupported[0] ?? "path"}`,
                );
            }
            pendingPath = attributes.get("path");
            offset +=
                tarBlockSize + Math.ceil(size / tarBlockSize) * tarBlockSize;
            continue;
        }
        const relativePath = normalizeArchivePath(
            pendingPath ?? (prefix.length === 0 ? name : `${prefix}/${name}`),
        );
        pendingPath = undefined;
        const directory = type === 0x35;
        const regular = type === 0 || type === 0x30;
        entries++;
        if (entries > limits.maxEntries) {
            throw new Error(
                `Skill package exceeds ${limits.maxEntries} entries.`,
            );
        }
        if (directory && relativePath.length === 0) {
            offset +=
                tarBlockSize + Math.ceil(size / tarBlockSize) * tarBlockSize;
            continue;
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
            if (size !== 0) {
                throw new Error(`TAR directory has data: ${relativePath}`);
            }
        } else {
            validateExecutable(relativePath, mode);
            files++;
            if (files > limits.maxFiles) {
                throw new Error(
                    `Skill package exceeds ${limits.maxFiles} files.`,
                );
            }
            totalBytes = accountFile(relativePath, size, totalBytes, limits);
            await writeStagedFile(
                target,
                relativePath,
                data.subarray(contentOffset, contentOffset + size),
            );
        }

        offset += tarBlockSize + Math.ceil(size / tarBlockSize) * tarBlockSize;
    }
    throw new Error("TAR archive is missing its end marker.");
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
