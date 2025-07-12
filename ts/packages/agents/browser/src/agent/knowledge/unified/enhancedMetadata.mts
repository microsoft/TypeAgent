// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface URLAnalyzer {
    analyze(url: string): URLInfo;
}

export interface DomainClassifier {
    classify(domain: string): DomainInfo;
}

export interface TitleProcessor {
    process(title: string): TitleInfo;
}

export interface URLInfo {
    domain: string;
    subdomain: string | undefined;
    pathSegments: string[];
    queryParams: Record<string, string>;
    protocol: string;
    port: number | undefined;
}

export interface DomainInfo {
    category: string;
    type: string;
    keywords: string[];
    confidence: number;
}

export interface TitleInfo {
    keywords: string[];
    entities: string[];
    confidence: number;
    language?: string;
}

export class EnhancedURLAnalyzer implements URLAnalyzer {
    analyze(url: string): URLInfo {
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname
                .split("/")
                .filter((segment) => segment.length > 0)
                .map((segment) => decodeURIComponent(segment));

            const queryParams: Record<string, string> = {};
            urlObj.searchParams.forEach((value, key) => {
                queryParams[key] = value;
            });

            const subdomain = this.extractSubdomain(urlObj.hostname);

            return {
                domain: urlObj.hostname,
                subdomain,
                pathSegments,
                queryParams,
                protocol: urlObj.protocol,
                port: urlObj.port ? parseInt(urlObj.port) : undefined,
            };
        } catch (error) {
            return {
                domain: url,
                subdomain: undefined,
                pathSegments: [],
                queryParams: {},
                protocol: "unknown:",
                port: undefined,
            };
        }
    }

    private extractSubdomain(hostname: string): string | undefined {
        const parts = hostname.split(".");
        if (parts.length > 2) {
            const subdomain = parts[0];
            if (subdomain !== "www") {
                return subdomain;
            }
        }
        return undefined;
    }
}

export class EnhancedDomainClassifier implements DomainClassifier {
    private domainPatterns = {
        documentation: [
            "docs",
            "documentation",
            "guide",
            "manual",
            "help",
            "wiki",
            "github.io",
            "readthedocs",
            "gitbook",
        ],
        ecommerce: [
            "amazon",
            "shop",
            "store",
            "buy",
            "cart",
            "checkout",
            "commerce",
            "retail",
            "marketplace",
        ],
        news: [
            "news",
            "blog",
            "article",
            "post",
            "media",
            "journal",
            "times",
            "herald",
            "gazette",
            "press",
        ],
        education: [
            "edu",
            "university",
            "college",
            "school",
            "course",
            "learn",
            "tutorial",
            "training",
            "academy",
        ],
        social: [
            "social",
            "forum",
            "community",
            "chat",
            "message",
            "connect",
            "network",
            "share",
        ],
        technical: [
            "api",
            "dev",
            "developer",
            "code",
            "git",
            "repo",
            "technical",
            "engineering",
            "software",
        ],
        reference: [
            "reference",
            "lookup",
            "search",
            "find",
            "directory",
            "index",
            "catalog",
            "database",
        ],
    };

    classify(domain: string): DomainInfo {
        const domainLower = domain.toLowerCase();

        for (const [category, patterns] of Object.entries(
            this.domainPatterns,
        )) {
            for (const pattern of patterns) {
                if (domainLower.includes(pattern)) {
                    return {
                        category,
                        type: this.mapCategoryToType(category),
                        keywords: this.extractKeywords(domain, category),
                        confidence: 0.8,
                    };
                }
            }
        }

        const tld = this.extractTLD(domain);
        const categoryFromTLD = this.categorizeTLD(tld);

        return {
            category: categoryFromTLD,
            type: this.mapCategoryToType(categoryFromTLD),
            keywords: this.extractKeywords(domain, categoryFromTLD),
            confidence: 0.6,
        };
    }

    private extractTLD(domain: string): string {
        const parts = domain.split(".");
        return parts[parts.length - 1];
    }

    private categorizeTLD(tld: string): string {
        const tldCategories: Record<string, string> = {
            edu: "education",
            org: "organization",
            gov: "government",
            mil: "military",
            com: "commercial",
            net: "network",
            io: "technical",
        };

        return tldCategories[tld] || "general";
    }

    private mapCategoryToType(category: string): string {
        const typeMapping: Record<string, string> = {
            documentation: "informational",
            ecommerce: "transactional",
            news: "informational",
            education: "educational",
            social: "interactive",
            technical: "technical",
            reference: "reference",
            general: "general",
        };

        return typeMapping[category] || "general";
    }

    private extractKeywords(domain: string, category: string): string[] {
        const keywords = [category];

        const domainParts = domain.replace(/\./g, " ").split(/[-_\s]+/);
        domainParts.forEach((part) => {
            if (
                part.length > 2 &&
                !["www", "com", "org", "net"].includes(part)
            ) {
                keywords.push(part);
            }
        });

        return [...new Set(keywords)];
    }
}

export class EnhancedTitleProcessor implements TitleProcessor {
    private stopWords = new Set([
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "up",
        "about",
        "into",
        "through",
        "during",
        "before",
        "after",
        "above",
        "below",
        "between",
        "among",
        "under",
        "over",
    ]);

    process(title: string): TitleInfo {
        const cleaned = this.cleanTitle(title);
        const words = this.tokenize(cleaned);
        const keywords = this.extractKeywords(words);
        const entities = this.extractEntities(cleaned);
        const confidence = this.calculateConfidence(title, keywords, entities);

        return {
            keywords,
            entities,
            confidence,
            language: this.detectLanguage(title),
        };
    }

    private cleanTitle(title: string): string {
        return title
            .replace(/\s*[-–—|]\s*.*$/, "") // Remove everything after delimiter
            .replace(/\([^)]*\)/g, "") // Remove parenthetical content
            .replace(/\[[^\]]*\]/g, "") // Remove bracketed content
            .trim();
    }

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((word) => word.length > 1 && !this.stopWords.has(word));
    }

    private extractKeywords(words: string[]): string[] {
        const frequency = new Map<string, number>();

        words.forEach((word) => {
            frequency.set(word, (frequency.get(word) || 0) + 1);
        });

        return Array.from(frequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([word]) => word);
    }

    private extractEntities(text: string): string[] {
        const entities: string[] = [];

        // Extract proper nouns (capitalized words)
        const properNouns = text.match(/\b[A-Z][a-z]+\b/g);
        if (properNouns) {
            entities.push(...properNouns);
        }

        // Extract quoted terms
        const quotedTerms = text.match(/"([^"]+)"/g);
        if (quotedTerms) {
            entities.push(...quotedTerms.map((term) => term.replace(/"/g, "")));
        }

        return [...new Set(entities)].slice(0, 10);
    }

    private calculateConfidence(
        title: string,
        keywords: string[],
        entities: string[],
    ): number {
        let confidence = 0.5;

        // Higher confidence for longer titles with more content
        if (title.length > 20) confidence += 0.1;
        if (title.length > 50) confidence += 0.1;

        // Higher confidence for descriptive titles
        if (keywords.length > 3) confidence += 0.1;
        if (keywords.length > 6) confidence += 0.1;

        return Math.min(confidence, 1.0);
    }

    private detectLanguage(text: string): string {
        // Simple language detection based on character patterns
        const englishPattern = /^[a-zA-Z0-9\s\-_.,!?()[\]{}'"]+$/;

        if (englishPattern.test(text)) {
            return "en";
        }

        return "unknown";
    }
}
