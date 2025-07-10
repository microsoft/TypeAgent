// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * File system utilities for HTML folder import operations.
 * Provides functionality for folder enumeration, file filtering, and validation.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Options for folder enumeration and filtering
 */
export interface FolderOptions {
    /** File extensions to include (e.g., ['.html', '.htm', '.mhtml']) */
    fileTypes?: string[];
    /** Whether to search recursively through subdirectories */
    recursive?: boolean;
    /** Maximum number of files to process */
    limit?: number;
    /** Maximum file size in bytes */
    maxFileSize?: number;
    /** Skip hidden files and directories */
    skipHidden?: boolean;
}

/**
 * File validation result
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    warning?: string;
}

/**
 * File metadata for HTML files
 */
export interface FileMetadata {
    filename: string;
    filePath: string;
    fileSize: number;
    lastModified: Date;
    fileUrl: string;
}

/**
 * Default folder options for HTML file processing
 */
export const DEFAULT_FOLDER_OPTIONS: FolderOptions = {
    fileTypes: [".html", ".htm", ".mhtml"],
    recursive: true,
    limit: 1000,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    skipHidden: true,
};

/**
 * Enumerate HTML files in a folder with filtering options
 */
export async function enumerateHtmlFiles(
    folderPath: string,
    options: FolderOptions = DEFAULT_FOLDER_OPTIONS,
): Promise<string[]> {
    const mergedOptions = { ...DEFAULT_FOLDER_OPTIONS, ...options };
    const files: string[] = [];

    try {
        await enumerateFilesRecursive(folderPath, files, mergedOptions, 0);

        // Apply limit if specified
        if (mergedOptions.limit && files.length > mergedOptions.limit) {
            return files.slice(0, mergedOptions.limit);
        }

        return files;
    } catch (error) {
        throw new Error(
            `Failed to enumerate files in ${folderPath}: ${(error as Error).message}`,
        );
    }
}

/**
 * Recursive file enumeration helper
 */
async function enumerateFilesRecursive(
    currentPath: string,
    files: string[],
    options: FolderOptions,
    depth: number,
): Promise<void> {
    const maxDepth = 10; // Prevent infinite recursion
    if (depth > maxDepth) {
        return;
    }

    const entries = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
    });

    for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        // Skip hidden files and directories if requested
        if (options.skipHidden && entry.name.startsWith(".")) {
            continue;
        }

        if (entry.isDirectory()) {
            // Recurse into subdirectories if enabled
            if (options.recursive) {
                await enumerateFilesRecursive(
                    fullPath,
                    files,
                    options,
                    depth + 1,
                );
            }
        } else if (entry.isFile()) {
            // Check if file matches our criteria
            if (
                isHtmlFile(fullPath, options) &&
                (await isValidFileSize(fullPath, options))
            ) {
                files.push(fullPath);

                // Check if we've hit the limit
                if (options.limit && files.length >= options.limit) {
                    return;
                }
            }
        }
    }
}

/**
 * Check if a file is an HTML file based on extension
 */
function isHtmlFile(filePath: string, options: FolderOptions): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const allowedTypes = options.fileTypes || DEFAULT_FOLDER_OPTIONS.fileTypes!;
    return allowedTypes.includes(ext);
}

/**
 * Check if file size is within limits
 */
async function isValidFileSize(
    filePath: string,
    options: FolderOptions,
): Promise<boolean> {
    try {
        const stats = await fs.promises.stat(filePath);
        const maxSize =
            options.maxFileSize || DEFAULT_FOLDER_OPTIONS.maxFileSize!;
        return stats.size <= maxSize;
    } catch {
        return false;
    }
}

/**
 * Read HTML file content from disk
 */
export async function readHtmlFile(filePath: string): Promise<string> {
    try {
        return await fs.promises.readFile(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `Failed to read file ${filePath}: ${(error as Error).message}`,
        );
    }
}

/**
 * Validate folder path and permissions
 */
export function validateFolderPath(folderPath: string): ValidationResult {
    if (!folderPath || typeof folderPath !== "string") {
        return {
            valid: false,
            error: "Folder path is required",
        };
    }

    // Check if path exists
    try {
        if (!fs.existsSync(folderPath)) {
            return {
                valid: false,
                error: `Folder does not exist: ${folderPath}`,
            };
        }
    } catch (error) {
        return {
            valid: false,
            error: `Cannot access folder: ${(error as Error).message}`,
        };
    }

    // Check if it's a directory
    try {
        const stats = fs.statSync(folderPath);
        if (!stats.isDirectory()) {
            return {
                valid: false,
                error: `Path is not a directory: ${folderPath}`,
            };
        }
    } catch (error) {
        return {
            valid: false,
            error: `Cannot read folder information: ${(error as Error).message}`,
        };
    }

    // Check if we can read the directory
    try {
        fs.readdirSync(folderPath);
    } catch (error) {
        return {
            valid: false,
            error: `Cannot read folder contents (permission denied): ${folderPath}`,
        };
    }

    return { valid: true };
}

/**
 * Apply additional filters to file list
 */
export function applyFileFilters(
    files: string[],
    options: FolderOptions,
): string[] {
    let filtered = [...files];

    // Apply file type filtering (already done in enumeration, but can be used for additional filtering)
    if (options.fileTypes) {
        filtered = filtered.filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return options.fileTypes!.includes(ext);
        });
    }

    // Apply limit
    if (options.limit && filtered.length > options.limit) {
        filtered = filtered.slice(0, options.limit);
    }

    return filtered;
}

/**
 * Create file URL from file path (cross-platform)
 */
export function createFileUrl(filePath: string): string {
    // Convert file path to file:// URL
    if (filePath.startsWith("file://")) {
        return filePath;
    }

    // Handle Windows paths
    if (path.sep === "\\") {
        // Convert backslashes to forward slashes and ensure proper encoding
        const normalized = filePath.replace(/\\/g, "/");
        // Add drive letter handling for Windows
        if (/^[A-Za-z]:/.test(normalized)) {
            return `file:///${normalized}`;
        }
        return `file://${normalized}`;
    }

    // Handle Unix paths
    if (filePath.startsWith("/")) {
        return `file://${filePath}`;
    }

    // Relative path - convert to absolute first
    const absolutePath = path.resolve(filePath);
    return createFileUrl(absolutePath);
}

/**
 * Get file metadata for an HTML file
 */
export async function getFileMetadata(filePath: string): Promise<FileMetadata> {
    try {
        const stats = await fs.promises.stat(filePath);

        return {
            filename: path.basename(filePath),
            filePath: path.resolve(filePath),
            fileSize: stats.size,
            lastModified: stats.mtime,
            fileUrl: createFileUrl(filePath),
        };
    } catch (error) {
        throw new Error(
            `Failed to get metadata for ${filePath}: ${(error as Error).message}`,
        );
    }
}

/**
 * Get folder statistics (count of HTML files, total size, etc.)
 */
export async function getFolderStats(
    folderPath: string,
    options: FolderOptions = DEFAULT_FOLDER_OPTIONS,
): Promise<{
    totalFiles: number;
    htmlFiles: number;
    totalSize: number;
    averageFileSize: number;
    largestFile: { path: string; size: number } | null;
}> {
    const validation = validateFolderPath(folderPath);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const htmlFiles = await enumerateHtmlFiles(folderPath, options);
    let totalSize = 0;
    let largestFile: { path: string; size: number } | null = null;

    for (const file of htmlFiles) {
        try {
            const stats = await fs.promises.stat(file);
            totalSize += stats.size;

            if (!largestFile || stats.size > largestFile.size) {
                largestFile = { path: file, size: stats.size };
            }
        } catch {
            // Skip files that can't be accessed
        }
    }

    return {
        totalFiles: htmlFiles.length,
        htmlFiles: htmlFiles.length,
        totalSize,
        averageFileSize:
            htmlFiles.length > 0 ? totalSize / htmlFiles.length : 0,
        largestFile,
    };
}

/**
 * Validate that a folder contains HTML files
 */
export async function validateHtmlFolder(
    folderPath: string,
    options: FolderOptions = DEFAULT_FOLDER_OPTIONS,
): Promise<ValidationResult> {
    // First validate the folder path
    const pathValidation = validateFolderPath(folderPath);
    if (!pathValidation.valid) {
        return pathValidation;
    }

    try {
        // Check if folder contains any HTML files
        const htmlFiles = await enumerateHtmlFiles(folderPath, {
            ...options,
            limit: 1,
        });

        if (htmlFiles.length === 0) {
            return {
                valid: false,
                error: `No HTML files found in folder: ${folderPath}`,
            };
        }

        // Get full stats for warning messages
        const stats = await getFolderStats(folderPath, options);

        let warning: string | undefined;
        if (stats.totalFiles > 100) {
            warning = `Large folder detected (${stats.totalFiles} HTML files). Import may take some time.`;
        }

        return {
            valid: true,
            ...(warning && { warning }),
        };
    } catch (error) {
        return {
            valid: false,
            error: `Failed to validate HTML folder: ${(error as Error).message}`,
        };
    }
}

/**
 * Create a batch of file paths for processing
 */
export function createFileBatches(
    files: string[],
    batchSize: number = 10,
): string[][] {
    const batches: string[][] = [];

    for (let i = 0; i < files.length; i += batchSize) {
        batches.push(files.slice(i, i + batchSize));
    }

    return batches;
}
