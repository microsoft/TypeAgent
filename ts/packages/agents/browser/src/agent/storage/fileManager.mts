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
     * Get action file path based on scope
     */
    getActionFilePath(
        actionId: string,
        scope: { type: string; domain?: string },
    ): string {
        const fileName = `${actionId}.json`;

        if (scope.type === "global") {
            return `actions/global/${fileName}`;
        } else {
            const domain = this.sanitizeFilename(scope.domain || "unknown");
            return `actions/domains/${domain}/${fileName}`;
        }
    }

    /**
     * Get domain config file path
     */
    getDomainConfigPath(domain: string): string {
        const sanitizedDomain = this.sanitizeFilename(domain);
        return `domains/${sanitizedDomain}/config.json`;
    }

    /**
     * Get index file path
     */
    getIndexPath(indexType: string): string {
        return `registry/${indexType}-index.json`;
    }

    /**
     * Save domain configuration
     */
    async saveDomainConfig(domain: string, config: any): Promise<void> {
        const configPath = this.getDomainConfigPath(domain);
        const domainDir = `domains/${this.sanitizeFilename(domain)}`;

        // Ensure domain directory exists
        await this.createDirectory(domainDir);

        // Save configuration
        await this.writeJson(configPath, config);
    }

    /**
     * Load domain configuration
     */
    async loadDomainConfig(domain: string): Promise<any | null> {
        const configPath = this.getDomainConfigPath(domain);
        return await this.readJson(configPath);
    }

    /**
     * Get all configured domains
     */
    async getAllDomains(): Promise<string[]> {
        try {
            const domainsDir = `domains`;
            const domainDirs = await this.listFiles(domainsDir);

            // Filter out .keep files and extract domain names
            const domains: string[] = [];
            for (const dir of domainDirs) {
                if (!dir.includes(".keep")) {
                    // Check if config file exists
                    const configPath = `${domainsDir}/${dir}/config.json`;
                    const exists = await this.exists(configPath);
                    if (exists) {
                        domains.push(dir);
                    }
                }
            }

            return domains;
        } catch (error) {
            console.error("Failed to get all domains:", error);
            return [];
        }
    }

    /**
     * Delete domain configuration and all related files
     */
    async deleteDomainConfig(domain: string): Promise<void> {
        const sanitizedDomain = this.sanitizeFilename(domain);
        const domainDir = `domains/${sanitizedDomain}`;

        try {
            // List all files in domain directory
            const files = await this.listFiles(domainDir);

            // Delete all files
            for (const file of files) {
                await this.delete(`${domainDir}/${file}`);
            }

            // Delete the directory marker
            await this.delete(`${domainDir}/.keep`);
        } catch (error) {
            console.error(
                `Failed to delete domain config for ${domain}:`,
                error,
            );
            throw new Error(`Failed to delete domain configuration: ${domain}`);
        }
    }

    /**
     * Check if domain has configuration
     */
    async hasDomainConfig(domain: string): Promise<boolean> {
        const configPath = this.getDomainConfigPath(domain);
        return await this.exists(configPath);
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
