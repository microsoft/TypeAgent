// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * File manager for handling sessionStorage operations
 */
export class FileManager {
    private sessionStorage: any; // SessionStorage interface from agent-sdk
    private basePath: string = "actionsStore";

    constructor(sessionStorage: any) {
        this.sessionStorage = sessionStorage;
    }

    /**
     * Initialize the directory structure
     */
    async initialize(): Promise<void> {
        const directories = [
            this.basePath,
            `${this.basePath}/actions`,
            `${this.basePath}/actions/global`,
            `${this.basePath}/actions/domains`,
            `${this.basePath}/domains`,
            `${this.basePath}/registry`,
            `${this.basePath}/cache`,
        ];

        for (const dir of directories) {
            try {
                // Check if directory exists, create if it doesn't
                const exists = await this.sessionStorage.exists(dir);
                if (!exists) {
                    // Create directory by writing a placeholder file
                    await this.sessionStorage.write(`${dir}/.keep`, "");
                }
            } catch (error) {
                console.error(`Failed to create directory ${dir}:`, error);
                throw new Error(
                    `Failed to initialize storage directory: ${dir}`,
                );
            }
        }
    }

    /**
     * Write JSON data to a file
     */
    async writeJson<T>(filePath: string, data: T): Promise<void> {
        const fullPath = this.getFullPath(filePath);
        const jsonData = JSON.stringify(data, null, 2);

        try {
            await this.sessionStorage.write(fullPath, jsonData);
        } catch (error) {
            console.error(`Failed to write JSON to ${fullPath}:`, error);
            throw new Error(`Failed to write file: ${filePath}`);
        }
    }

    /**
     * Write text data to a file
     */
    async writeText(filePath: string, data: string): Promise<void> {
        const fullPath = this.getFullPath(filePath);

        try {
            await this.sessionStorage.write(fullPath, data);
        } catch (error) {
            console.error(`Failed to write text to ${fullPath}:`, error);
            throw new Error(`Failed to write file: ${filePath}`);
        }
    }

    /**
     * Read JSON data from a file
     */
    async readJson<T>(filePath: string): Promise<T | null> {
        const fullPath = this.getFullPath(filePath);

        try {
            const exists = await this.sessionStorage.exists(fullPath);
            if (!exists) {
                return null;
            }

            const content = await this.sessionStorage.read(fullPath);
            return JSON.parse(content) as T;
        } catch (error) {
            console.error(`Failed to read JSON from ${fullPath}:`, error);
            return null;
        }
    }

    /**
     * Read text data from a file
     */
    async readText(filePath: string): Promise<string | null> {
        const fullPath = this.getFullPath(filePath);

        try {
            const exists = await this.sessionStorage.exists(fullPath);
            if (!exists) {
                return null;
            }

            return await this.sessionStorage.read(fullPath, "utf8");
        } catch (error) {
            console.error(`Failed to read text from ${fullPath}:`, error);
            return null;
        }
    }

    /**
     * Check if a file exists
     */
    async exists(filePath: string): Promise<boolean> {
        const fullPath = this.getFullPath(filePath);

        try {
            return await this.sessionStorage.exists(fullPath);
        } catch (error) {
            console.error(`Failed to check existence of ${fullPath}:`, error);
            return false;
        }
    }

    /**
     * Delete a file
     */
    async delete(filePath: string): Promise<void> {
        const fullPath = this.getFullPath(filePath);

        try {
            const exists = await this.sessionStorage.exists(fullPath);
            if (exists) {
                await this.sessionStorage.delete(fullPath);
            }
        } catch (error) {
            console.error(`Failed to delete ${fullPath}:`, error);
            throw new Error(`Failed to delete file: ${filePath}`);
        }
    }

    /**
     * List files in a directory
     */
    async listFiles(directoryPath: string): Promise<string[]> {
        const fullPath = this.getFullPath(directoryPath);

        try {
            const files = await this.sessionStorage.list(fullPath);
            return files.filter((file: string) => !file.endsWith("/.keep"));
        } catch (error) {
            console.error(`Failed to list files in ${fullPath}:`, error);
            return [];
        }
    }

    /**
     * Create a directory
     */
    async createDirectory(directoryPath: string): Promise<void> {
        const fullPath = this.getFullPath(directoryPath);

        try {
            const exists = await this.sessionStorage.exists(fullPath);
            if (!exists) {
                await this.sessionStorage.write(`${fullPath}/.keep`, "");
            }
        } catch (error) {
            console.error(`Failed to create directory ${fullPath}:`, error);
            throw new Error(`Failed to create directory: ${directoryPath}`);
        }
    }

    /**
     * Get file size
     */
    async getFileSize(filePath: string): Promise<number> {
        const fullPath = this.getFullPath(filePath);

        try {
            const exists = await this.sessionStorage.exists(fullPath);
            if (!exists) {
                return 0;
            }

            const content = await this.sessionStorage.read(fullPath);
            return new Blob([content]).size;
        } catch (error) {
            console.error(`Failed to get size of ${fullPath}:`, error);
            return 0;
        }
    }

    /**
     * Get storage statistics
     */
    async getStorageStats(): Promise<{ totalSize: number; fileCount: number }> {
        try {
            const allFiles = await this.getAllFiles();
            let totalSize = 0;

            for (const file of allFiles) {
                const size = await this.getFileSize(file);
                totalSize += size;
            }

            return {
                totalSize,
                fileCount: allFiles.length,
            };
        } catch (error) {
            console.error("Failed to get storage stats:", error);
            return { totalSize: 0, fileCount: 0 };
        }
    }

    /**
     * Get all files recursively
     */
    private async getAllFiles(directory: string = ""): Promise<string[]> {
        const allFiles: string[] = [];
        const currentDir = directory || this.basePath;

        try {
            const items = await this.sessionStorage.list(currentDir, {
                fullPath: true,
            });

            for (const item of items) {
                if (item.endsWith("/.keep")) {
                    continue;
                }

                const relativePath = item.replace(`${this.basePath}/`, "");

                // Check if it's a file (has extension) or directory
                if (item.includes(".") && !item.endsWith("/")) {
                    allFiles.push(relativePath);
                } else {
                    // Recursively get files from subdirectory
                    const subFiles = await this.getAllFiles(item);
                    allFiles.push(...subFiles);
                }
            }
        } catch (error) {
            console.error(`Failed to list files in ${currentDir}:`, error);
        }

        return allFiles;
    }

    /**
     * Get full path with base path prefix
     */
    private getFullPath(filePath: string): string {
        if (filePath.startsWith(this.basePath)) {
            return filePath;
        }
        return `${this.basePath}/${filePath}`;
    }

    /**
     * Generate unique filename
     */
    generateUniqueId(): string {
        // Generate UUID v4 without hyphens for filename compatibility
        return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(
            /[xy]/g,
            function (c) {
                const r = (Math.random() * 16) | 0;
                const v = c === "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            },
        );
    }

    /**
     * Sanitize filename for storage
     */
    sanitizeFilename(filename: string): string {
        return filename
            .replace(/[^a-zA-Z0-9.-]/g, "_")
            .replace(/_{2,}/g, "_")
            .toLowerCase();
    }

    /**
     * Get macro file path based on scope
     * Returns YAML file path by default, with option for JSON (backward compat)
     */
    getMacroFilePath(
        macroId: string,
        scope: { type: string; domain?: string },
        format: 'yaml' | 'json' = 'yaml',
    ): string {
        const fileName = `${macroId}.${format}`;

        if (scope.type === "global") {
            return `macros/global/${fileName}`;
        } else {
            const domain = this.sanitizeFilename(scope.domain || "unknown");
            return `macros/domains/${domain}/${fileName}`;
        }
    }

    /**
     * @deprecated Use getMacroFilePath instead
     */
    getActionFilePath(
        actionId: string,
        scope: { type: string; domain?: string },
    ): string {
        return this.getMacroFilePath(actionId, scope);
    }

    /**
     * Get index file path
     */
    getIndexPath(indexType: string): string {
        return `registry/${indexType}-index.json`;
    }

    /**
     * Backup storage to a compressed format
     */
    async createBackup(): Promise<string> {
        try {
            const allFiles = await this.getAllFiles();
            const backup: Record<string, any> = {
                version: "1.0.0",
                timestamp: new Date().toISOString(),
                files: {},
            };

            for (const file of allFiles) {
                const content = await this.readJson(file);
                backup.files[file] = content;
            }

            return JSON.stringify(backup, null, 2);
        } catch (error) {
            console.error("Failed to create backup:", error);
            throw new Error("Failed to create backup");
        }
    }
}
