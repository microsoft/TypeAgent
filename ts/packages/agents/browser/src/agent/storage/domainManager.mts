// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainConfig,
    UrlPatternDefinition,
    DomainSettings,
    SiteType,
    ActionCategory,
    SaveResult,
    ValidationResult,
} from "./types.mjs";

/**
 * Result of website analysis
 */
export interface SiteAnalysis {
    siteType: SiteType;
    framework?: string;
    commonPatterns: string[];
    recommendedSettings: Partial<DomainSettings>;
}

/**
 * Manager for domain-specific configurations and URL patterns
 */
export class DomainManager {
    private fileManager: any;
    private domainConfigCache = new Map<string, DomainConfig>();

    constructor(fileManager: any) {
        this.fileManager = fileManager;
    }

    /**
     * Get domain configuration, creating default if none exists
     */
    async getDomainConfig(domain: string): Promise<DomainConfig | null> {
        try {
            // Check cache first
            const cached = this.domainConfigCache.get(domain);
            if (cached) {
                return cached;
            }

            // Try to load from storage
            const config = await this.fileManager.loadDomainConfig(domain);
            if (config) {
                this.domainConfigCache.set(domain, config);
                return config;
            }

            return null;
        } catch (error) {
            console.error(`Failed to get domain config for ${domain}:`, error);
            return null;
        }
    }

    /**
     * Save domain configuration
     */
    async saveDomainConfig(config: DomainConfig): Promise<SaveResult> {
        try {
            // Validate configuration
            const validation = this.validateDomainConfig(config);
            if (!validation.isValid) {
                return {
                    success: false,
                    error: `Validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
                };
            }

            // Sanitize and update metadata
            const sanitizedConfig = this.sanitizeDomainConfig(config);

            // Save to storage
            await this.fileManager.saveDomainConfig(
                sanitizedConfig.domain,
                sanitizedConfig,
            );

            // Update cache
            this.domainConfigCache.set(sanitizedConfig.domain, sanitizedConfig);

            console.log(`Domain config saved for ${sanitizedConfig.domain}`);

            return {
                success: true,
            };
        } catch (error) {
            console.error(
                `Failed to save domain config for ${config.domain}:`,
                error,
            );
            return {
                success: false,
                error: `Failed to save domain config: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }
    /**
     * Delete domain configuration
     */
    async deleteDomainConfig(domain: string): Promise<SaveResult> {
        try {
            // Delete from storage
            const configPath = this.fileManager.getDomainConfigPath(domain);
            await this.fileManager.delete(configPath);

            // Remove from cache
            this.domainConfigCache.delete(domain);

            console.log(`Domain config deleted for ${domain}`);

            return {
                success: true,
            };
        } catch (error) {
            console.error(
                `Failed to delete domain config for ${domain}:`,
                error,
            );
            return {
                success: false,
                error: `Failed to delete domain config: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Add URL pattern to domain configuration
     */
    async addUrlPattern(
        domain: string,
        pattern: UrlPatternDefinition,
    ): Promise<SaveResult> {
        try {
            // Get or create domain config
            let config = await this.getDomainConfig(domain);
            if (!config) {
                config = this.createDefaultDomainConfig(domain);
            }

            // Validate pattern
            const validation = this.validateUrlPattern(pattern);
            if (!validation.isValid) {
                return {
                    success: false,
                    error: `Pattern validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
                };
            }

            // Check for duplicate pattern names
            const existingPattern = config.patterns.find(
                (p) => p.name === pattern.name,
            );
            if (existingPattern) {
                return {
                    success: false,
                    error: `Pattern name "${pattern.name}" already exists for domain ${domain}`,
                };
            }

            // Add pattern
            config.patterns.push(pattern);
            config.metadata.updatedAt = new Date().toISOString();

            // Save updated config
            return await this.saveDomainConfig(config);
        } catch (error) {
            console.error(
                `Failed to add URL pattern to domain ${domain}:`,
                error,
            );
            return {
                success: false,
                error: `Failed to add URL pattern: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }
    /**
     * Remove URL pattern from domain configuration
     */
    async removeUrlPattern(
        domain: string,
        patternName: string,
    ): Promise<SaveResult> {
        try {
            const config = await this.getDomainConfig(domain);
            if (!config) {
                return {
                    success: false,
                    error: `Domain config not found: ${domain}`,
                };
            }

            const patternIndex = config.patterns.findIndex(
                (p) => p.name === patternName,
            );
            if (patternIndex === -1) {
                return {
                    success: false,
                    error: `Pattern "${patternName}" not found in domain ${domain}`,
                };
            }

            // Remove pattern
            config.patterns.splice(patternIndex, 1);
            config.metadata.updatedAt = new Date().toISOString();

            // Save updated config
            return await this.saveDomainConfig(config);
        } catch (error) {
            console.error(
                `Failed to remove URL pattern from domain ${domain}:`,
                error,
            );
            return {
                success: false,
                error: `Failed to remove URL pattern: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    /**
     * Get URL patterns for a domain
     */
    async getUrlPatterns(domain: string): Promise<UrlPatternDefinition[]> {
        try {
            const config = await this.getDomainConfig(domain);
            return config ? config.patterns : [];
        } catch (error) {
            console.error(
                `Failed to get URL patterns for domain ${domain}:`,
                error,
            );
            return [];
        }
    }

    /**
     * Initialize domain with default configuration
     */
    async initializeDomain(domain: string): Promise<DomainConfig> {
        const config = this.createDefaultDomainConfig(domain);
        await this.addDefaultPatterns(config);
        await this.saveDomainConfig(config);
        return config;
    }
    /**
     * Create default domain configuration
     */
    createDefaultDomainConfig(domain: string): DomainConfig {
        return {
            domain,
            version: "1.0.0",
            settings: {
                autoDiscovery: true,
                inheritGlobal: true,
                defaultCategory: "utility" as ActionCategory,
                maxActions: 100,
                customSelectors: {},
            },
            patterns: [],
            metadata: {
                siteType: "unknown" as SiteType,
                lastAnalyzed: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * Add default URL patterns for common website structures
     */
    private async addDefaultPatterns(config: DomainConfig): Promise<void> {
        const domain = config.domain;
        const commonPatterns: UrlPatternDefinition[] = [];

        const allowedHosts = ["github.com", "www.github.com"];

        // Add basic patterns based on domain structure
        const isGitHubDomain = allowedHosts.includes(domain);
        if (isGitHubDomain) {
            commonPatterns.push(
                {
                    name: "repository-pages",
                    pattern: `https://github.com/*/*`,
                    type: "glob",
                    description: "Repository pages",
                    priority: 80,
                },
                {
                    name: "pull-requests",
                    pattern: `https://github.com/*/*/pull/*`,
                    type: "glob",
                    description: "Pull request pages",
                    priority: 90,
                },
            );
        } else {
            // Generic patterns for most websites
            commonPatterns.push(
                {
                    name: "domain-pages",
                    pattern: `https://${domain}/*`,
                    type: "glob",
                    description: "All pages on this domain",
                    priority: 60,
                },
                {
                    name: "subdomain-pages",
                    pattern: `https://*.${domain}/*`,
                    type: "glob",
                    description: "All pages on subdomains",
                    priority: 55,
                },
            );
        }

        config.patterns.push(...commonPatterns);
    }
    /**
     * Validate domain configuration
     */
    private validateDomainConfig(config: DomainConfig): ValidationResult {
        const errors = [];

        if (!config.domain) {
            errors.push({ field: "domain", message: "Domain is required" });
        } else if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(config.domain)) {
            errors.push({ field: "domain", message: "Invalid domain format" });
        }

        if (!config.version) {
            errors.push({ field: "version", message: "Version is required" });
        }

        if (
            config.settings.maxActions < 1 ||
            config.settings.maxActions > 1000
        ) {
            errors.push({
                field: "settings.maxActions",
                message: "Max actions must be between 1 and 1000",
            });
        }

        // Validate patterns
        for (let i = 0; i < config.patterns.length; i++) {
            const patternValidation = this.validateUrlPattern(
                config.patterns[i],
            );
            if (!patternValidation.isValid) {
                errors.push({
                    field: `patterns[${i}]`,
                    message: `Pattern validation failed: ${patternValidation.errors.map((e) => e.message).join(", ")}`,
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: [],
        };
    }

    /**
     * Validate URL pattern definition
     */
    private validateUrlPattern(
        pattern: UrlPatternDefinition,
    ): ValidationResult {
        const errors = [];

        if (!pattern.name) {
            errors.push({ field: "name", message: "Pattern name is required" });
        } else if (pattern.name.length > 50) {
            errors.push({
                field: "name",
                message: "Pattern name must be 50 characters or less",
            });
        }

        if (!pattern.pattern) {
            errors.push({
                field: "pattern",
                message: "Pattern string is required",
            });
        } else if (pattern.pattern.length > 500) {
            errors.push({
                field: "pattern",
                message: "Pattern string must be 500 characters or less",
            });
        }

        if (!["glob", "regex"].includes(pattern.type)) {
            errors.push({
                field: "type",
                message: "Pattern type must be 'glob' or 'regex'",
            });
        }

        if (
            pattern.priority !== undefined &&
            (pattern.priority < 1 || pattern.priority > 100)
        ) {
            errors.push({
                field: "priority",
                message: "Priority must be between 1 and 100",
            });
        }

        if (pattern.description && pattern.description.length > 200) {
            errors.push({
                field: "description",
                message: "Description must be 200 characters or less",
            });
        }

        // Validate pattern syntax
        if (pattern.type === "regex") {
            try {
                new RegExp(pattern.pattern);
            } catch (error) {
                errors.push({
                    field: "pattern",
                    message: "Invalid regex pattern syntax",
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: [],
        };
    }
    /**
     * Sanitize domain configuration
     */
    private sanitizeDomainConfig(config: DomainConfig): DomainConfig {
        return {
            ...config,
            domain: config.domain.toLowerCase().trim(),
            version: config.version.trim(),
            settings: {
                ...config.settings,
                maxActions: Math.max(
                    1,
                    Math.min(1000, config.settings.maxActions),
                ),
            },
            patterns: config.patterns.map((p) => ({
                ...p,
                name: p.name.trim(),
                pattern: p.pattern.trim(),
                description: p.description?.trim() || "",
                priority: Math.max(1, Math.min(100, p.priority || 60)),
            })),
            metadata: {
                ...config.metadata,
                updatedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * Analyze website to suggest configuration
     */
    async analyzeWebsite(url: string): Promise<SiteAnalysis> {
        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname;

            // Basic analysis based on domain and URL structure
            const siteType = this.detectSiteType(domain, url);
            const framework = this.detectFramework(url);
            const commonPatterns = this.generateCommonPatterns(domain, url);
            const recommendedSettings =
                this.generateRecommendedSettings(siteType);

            return {
                siteType,
                ...(framework && { framework }),
                commonPatterns,
                recommendedSettings,
            };
        } catch (error) {
            console.error(`Failed to analyze website ${url}:`, error);
            return {
                siteType: "unknown",
                commonPatterns: [],
                recommendedSettings: {},
            };
        }
    }
    /**
     * Detect site type based on domain and URL patterns
     */
    private detectSiteType(domain: string, url: string): SiteType {
        const lowerDomain = domain.toLowerCase();
        const lowerUrl = url.toLowerCase();

        // E-commerce indicators
        if (
            lowerDomain.includes("shop") ||
            lowerDomain.includes("store") ||
            lowerUrl.includes("/cart") ||
            lowerUrl.includes("/checkout") ||
            lowerUrl.includes("/product")
        ) {
            return "ecommerce";
        }

        // Social media indicators
        if (
            lowerDomain.includes("social") ||
            lowerDomain.includes("facebook") ||
            lowerDomain.includes("twitter") ||
            lowerDomain.includes("linkedin") ||
            lowerUrl.includes("/profile") ||
            lowerUrl.includes("/feed")
        ) {
            return "social";
        }

        // Productivity tools
        if (
            lowerDomain.includes("docs") ||
            lowerDomain.includes("workspace") ||
            lowerDomain.includes("office") ||
            lowerDomain.includes("notion") ||
            lowerDomain.includes("slack") ||
            lowerDomain.includes("teams")
        ) {
            return "productivity";
        }

        // News sites
        if (
            lowerDomain.includes("news") ||
            lowerDomain.includes("times") ||
            lowerDomain.includes("post") ||
            lowerDomain.includes("herald") ||
            lowerUrl.includes("/news") ||
            lowerUrl.includes("/article")
        ) {
            return "news";
        }

        // Government sites
        if (
            lowerDomain.endsWith(".gov") ||
            lowerDomain.endsWith(".gov.uk") ||
            lowerDomain.includes("government")
        ) {
            return "government";
        }

        // Education sites
        if (
            lowerDomain.endsWith(".edu") ||
            lowerDomain.includes("university") ||
            lowerDomain.includes("school") ||
            lowerDomain.includes("learning")
        ) {
            return "education";
        }

        // Blog indicators
        if (
            lowerDomain.includes("blog") ||
            lowerUrl.includes("/blog") ||
            lowerUrl.includes("/post") ||
            lowerUrl.includes("/article")
        ) {
            return "blog";
        }

        return "unknown";
    }
    /**
     * Detect framework (basic implementation)
     */
    private detectFramework(url: string): string | undefined {
        // This would typically require analyzing the page content
        // For now, return undefined as we can't detect from URL alone
        return undefined;
    }

    /**
     * Generate common URL patterns for a domain
     */
    private generateCommonPatterns(domain: string, url: string): string[] {
        const patterns: string[] = [];

        // Basic domain patterns
        patterns.push(`https://${domain}/*`);
        patterns.push(`https://*.${domain}/*`);

        // Analyze URL structure for specific patterns
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname
            .split("/")
            .filter((s) => s.length > 0);

        if (pathSegments.length > 0) {
            // Generate patterns based on path structure
            for (let i = 1; i <= pathSegments.length; i++) {
                const pathPattern = pathSegments.slice(0, i).join("/");
                patterns.push(`https://${domain}/${pathPattern}/*`);
            }
        }

        return patterns;
    }

    /**
     * Generate recommended settings based on site type
     */
    private generateRecommendedSettings(
        siteType: SiteType,
    ): Partial<DomainSettings> {
        const baseSettings: Partial<DomainSettings> = {
            autoDiscovery: true,
            inheritGlobal: true,
            maxActions: 100,
        };

        switch (siteType) {
            case "ecommerce":
                return {
                    ...baseSettings,
                    defaultCategory: "commerce",
                    maxActions: 150,
                };
            case "social":
                return {
                    ...baseSettings,
                    defaultCategory: "social",
                    maxActions: 80,
                };
            case "productivity":
                return {
                    ...baseSettings,
                    defaultCategory: "utility",
                    maxActions: 200,
                };
            case "news":
                return {
                    ...baseSettings,
                    defaultCategory: "content",
                    maxActions: 60,
                };
            default:
                return {
                    ...baseSettings,
                    defaultCategory: "utility",
                };
        }
    }
    /**
     * Auto-configure domain based on analysis
     */
    async autoConfigureDomain(
        domain: string,
        analysis: SiteAnalysis,
    ): Promise<DomainConfig> {
        const config = this.createDefaultDomainConfig(domain);

        // Apply analysis results
        config.metadata.siteType = analysis.siteType;
        if (analysis.framework) {
            config.metadata.framework = analysis.framework;
        }
        config.settings = {
            ...config.settings,
            ...analysis.recommendedSettings,
        };

        // Add suggested patterns
        const suggestedPatterns = analysis.commonPatterns
            .slice(0, 5)
            .map((pattern, index) => ({
                name: `auto-pattern-${index + 1}`,
                pattern,
                type: "glob" as const,
                description: `Auto-generated pattern ${index + 1}`,
                priority: 70 - index * 5,
            }));

        config.patterns.push(...suggestedPatterns);

        return config;
    }

    /**
     * Clear domain config cache
     */
    clearCache(): void {
        this.domainConfigCache.clear();
    }

    /**
     * Get all configured domains
     */
    async getAllDomains(): Promise<string[]> {
        try {
            return await this.fileManager.getAllDomains();
        } catch (error) {
            console.error("Failed to get all domains:", error);
            return [];
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { cacheSize: number; cachedDomains: string[] } {
        return {
            cacheSize: this.domainConfigCache.size,
            cachedDomains: Array.from(this.domainConfigCache.keys()),
        };
    }
}
