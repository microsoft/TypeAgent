// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs/promises";
import path from "path";
import * as os from "os";
import crypto from "crypto";
import registerDebug from "debug";

const debug = registerDebug("typeagent:views:server:pdf:urlMap");

export interface UrlDocumentMapping {
    id: string;
    url: string;
    createdAt: string;
    lastAccessedAt: string;
}

export interface UrlMappingStore {
    mappings: Record<string, UrlDocumentMapping>;
    urlToId: Record<string, string>;
}

/**
 * Service to manage URL to document ID mappings
 */
export class UrlDocumentMappingService {
    private store: UrlMappingStore = {
        mappings: {},
        urlToId: {},
    };

    private readonly storePath: string;
    private readonly storeFile: string;

    constructor() {
        // Get storage path from environment variable or use default
        this.storePath =
            process.env.TYPEAGENT_BROWSER_FILES ||
            path.join(os.homedir(), ".typeagent", "browser", "viewstore");
        this.storeFile = path.join(this.storePath, "url-mappings.json");
    }

    /**
     * Initialize the service and load existing mappings
     */
    async initialize(): Promise<void> {
        try {
            // Ensure storage directory exists
            await fs.mkdir(this.storePath, { recursive: true });

            // Load existing mappings if they exist
            await this.loadMappings();

            debug(`📄 URL Document Mapping Service initialized`);
            debug(`📄 Storage path: ${this.storePath}`);
            debug(
                `📄 Loaded ${Object.keys(this.store.mappings).length} existing mappings`,
            );
        } catch (error) {
            console.error(
                "Failed to initialize URL Document Mapping Service:",
                error,
            );
            throw error;
        }
    }

    /**
     * Load mappings from persistent storage
     */
    private async loadMappings(): Promise<void> {
        try {
            const data = await fs.readFile(this.storeFile, "utf-8");
            this.store = JSON.parse(data);

            // Rebuild urlToId index if it's missing
            if (!this.store.urlToId) {
                this.store.urlToId = {};
                for (const [id, mapping] of Object.entries(
                    this.store.mappings,
                )) {
                    this.store.urlToId[mapping.url] = id;
                }
                await this.saveMappings();
            }
        } catch (error) {
            if ((error as any).code === "ENOENT") {
                // File doesn't exist, start with empty store
                debug("📄 No existing mappings file found, starting fresh");
            } else {
                console.error("Error loading mappings:", error);
                throw error;
            }
        }
    }

    /**
     * Save mappings to persistent storage
     */
    private async saveMappings(): Promise<void> {
        try {
            const data = JSON.stringify(this.store, null, 2);
            await fs.writeFile(this.storeFile, data, "utf-8");
        } catch (error) {
            console.error("Error saving mappings:", error);
            throw error;
        }
    }

    /**
     * Generate a unique document ID
     */
    private generateDocumentId(): string {
        // Generate a URL-safe base64 string
        return crypto.randomBytes(16).toString("base64url");
    }

    /**
     * Get or create a document ID for a given URL
     */
    async getOrCreateDocumentId(url: string): Promise<string> {
        // Normalize URL (remove fragments, standardize)
        const normalizedUrl = this.normalizeUrl(url);

        // Check if we already have a mapping for this URL
        const existingId = this.store.urlToId[normalizedUrl];
        if (existingId) {
            // Update last accessed time
            const mapping = this.store.mappings[existingId];
            if (mapping) {
                mapping.lastAccessedAt = new Date().toISOString();
                await this.saveMappings();
                return existingId;
            }
        }

        // Create new mapping
        const newId = this.generateDocumentId();
        const now = new Date().toISOString();

        const mapping: UrlDocumentMapping = {
            id: newId,
            url: normalizedUrl,
            createdAt: now,
            lastAccessedAt: now,
        };

        this.store.mappings[newId] = mapping;
        this.store.urlToId[normalizedUrl] = newId;

        await this.saveMappings();

        debug(`📄 Created new document mapping: ${newId} -> ${normalizedUrl}`);
        return newId;
    }

    /**
     * Get document info by ID
     */
    async getDocumentById(id: string): Promise<UrlDocumentMapping | null> {
        const mapping = this.store.mappings[id];
        if (mapping) {
            // Update last accessed time
            mapping.lastAccessedAt = new Date().toISOString();
            await this.saveMappings();
            return mapping;
        }
        return null;
    }

    /**
     * Get document info by URL
     */
    async getDocumentByUrl(url: string): Promise<UrlDocumentMapping | null> {
        const normalizedUrl = this.normalizeUrl(url);
        const id = this.store.urlToId[normalizedUrl];
        if (id) {
            return this.getDocumentById(id);
        }
        return null;
    }

    /**
     * List all document mappings
     */
    async getAllMappings(): Promise<UrlDocumentMapping[]> {
        return Object.values(this.store.mappings);
    }

    /**
     * Delete a document mapping
     */
    async deleteMapping(id: string): Promise<boolean> {
        const mapping = this.store.mappings[id];
        if (mapping) {
            delete this.store.mappings[id];
            delete this.store.urlToId[mapping.url];
            await this.saveMappings();
            console.log(`📄 Deleted document mapping: ${id}`);
            return true;
        }
        return false;
    }

    /**
     * Normalize URL for consistent storage
     */
    private normalizeUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            // Remove fragment identifier
            urlObj.hash = "";
            // Sort query parameters for consistency
            urlObj.searchParams.sort();
            return urlObj.toString();
        } catch (error) {
            // If URL parsing fails, return as-is
            return url;
        }
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<{
        totalMappings: number;
        storageSize: number;
        storagePath: string;
    }> {
        try {
            const stats = await fs.stat(this.storeFile);
            return {
                totalMappings: Object.keys(this.store.mappings).length,
                storageSize: stats.size,
                storagePath: this.storePath,
            };
        } catch (error) {
            return {
                totalMappings: Object.keys(this.store.mappings).length,
                storageSize: 0,
                storagePath: this.storePath,
            };
        }
    }
}
