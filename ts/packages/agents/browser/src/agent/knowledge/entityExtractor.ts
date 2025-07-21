// Real-Time Entity Extractor Implementation
// Extracts entities and relationships from website data and integrates with existing knowledge

// Note: These interfaces will be implemented to match actual TypeAgent types
interface Website {
    url: string;
    title?: string;
    content?: string;
    timestamp?: string;
}

interface WebsiteCollection {
    // Will be implemented to match actual TypeAgent WebsiteCollection
}

interface Entity {
    name: string;
    type: EntityType;
    confidence: number;
}

export type EntityType =
    | "person"
    | "organization"
    | "product"
    | "concept"
    | "location"
    | "technology"
    | "event"
    | "document";

export interface EnhancedEntity {
    name: string;
    type: EntityType;
    confidence: number;

    // Graph properties
    aliases: string[];
    mentionCount: number;
    firstSeen: string;
    lastSeen: string;
    dominantDomains: string[];

    // Relationship properties
    strongRelationships: EntityRelationship[];
    coOccurringEntities: EntityCoOccurrence[];

    // Content properties
    contextSnippets: string[];
    topicAffinity: string[];

    // Data source tracking
    sourceWebsites: string[];
    extractionMethod: "nlp" | "pattern" | "manual" | "hybrid";
    lastUpdated: string;
}

export interface EntityRelationship {
    relatedEntity: string;
    relationshipType: string;
    confidence: number;
    evidenceSources: string[];
    firstObserved: string;
    lastObserved: string;
    strength: number;
    direction: "bidirectional" | "unidirectional";
}

export interface EntityCoOccurrence {
    entity: string;
    coOccurrenceCount: number;
    contexts: string[];
    strength: number;
}

export interface EntityKnowledgeGraph {
    entities: Map<string, EnhancedEntity>;
    relationships: Map<string, EntityRelationship[]>;
    entityIndex: Map<EntityType, string[]>;
    lastUpdated: string;
    version: number;
    sourceCount: number;
}

export interface ExtractionResult {
    entities: EnhancedEntity[];
    relationships: EntityRelationship[];
    processingTime: number;
    sourceWebsite: string;
    extractionQuality: number;
}

/**
 * Real-Time Entity Extractor
 * Extracts entities and relationships from website content and builds knowledge graphs
 */
export class RealTimeEntityExtractor {
    private entityPatterns: Map<EntityType, RegExp[]> = new Map();
    private relationshipPatterns: Map<string, RegExp[]> = new Map();
    private stopWords: Set<string> = new Set();
    private cache: Map<string, ExtractionResult> = new Map();

    constructor() {
        this.initializePatterns();
        this.initializeStopWords();
    }

    /**
     * Extract entities from a collection of websites
     */
    async extractEntitiesFromWebsites(
        websites: Website[],
    ): Promise<EnhancedEntity[]> {
        const entityMap: Map<string, EnhancedEntity> = new Map();

        for (const website of websites) {
            try {
                const result = await this.extractFromWebsite(website);

                // Merge entities, combining duplicates
                for (const entity of result.entities) {
                    const existing = entityMap.get(entity.name.toLowerCase());
                    if (existing) {
                        this.mergeEntities(existing, entity);
                    } else {
                        entityMap.set(entity.name.toLowerCase(), entity);
                    }
                }
            } catch (error) {
                console.warn(
                    `Failed to extract entities from ${website.url}:`,
                    error,
                );
            }
        }

        return Array.from(entityMap.values());
    }

    /**
     * Build relationships between entities based on co-occurrence and context
     */
    async buildEntityRelationships(
        entities: EnhancedEntity[],
        websites: Website[],
    ): Promise<EntityRelationship[]> {
        const relationships: EntityRelationship[] = [];
        const entityNames = new Set(entities.map((e) => e.name.toLowerCase()));

        for (const website of websites) {
            try {
                const siteRelationships =
                    await this.extractRelationshipsFromWebsite(
                        website,
                        entityNames,
                    );
                relationships.push(...siteRelationships);
            } catch (error) {
                console.warn(
                    `Failed to extract relationships from ${website.url}:`,
                    error,
                );
            }
        }

        // Deduplicate and merge similar relationships
        return this.consolidateRelationships(relationships);
    }

    /**
     * Update entity graph with new website data
     */
    async updateEntityGraph(
        newWebsites: Website[],
    ): Promise<EntityKnowledgeGraph> {
        const startTime = Date.now();

        // Extract entities and relationships from new websites
        const entities = await this.extractEntitiesFromWebsites(newWebsites);
        const relationships = await this.buildEntityRelationships(
            entities,
            newWebsites,
        );

        // Build entity index
        const entityIndex = this.buildEntityIndex(entities);

        const graph: EntityKnowledgeGraph = {
            entities: new Map(entities.map((e) => [e.name, e])),
            relationships: this.groupRelationshipsByEntity(relationships),
            entityIndex,
            lastUpdated: new Date().toISOString(),
            version: 1,
            sourceCount: newWebsites.length,
        };

        console.log(
            `Entity graph updated in ${Date.now() - startTime}ms: ${entities.length} entities, ${relationships.length} relationships`,
        );
        return graph;
    }

    /**
     * Migrate from existing TypeAgent knowledge to enhanced entity format
     */
    async migrateFromExistingKnowledge(
        websiteCollection: WebsiteCollection,
    ): Promise<EntityKnowledgeGraph> {
        try {
            // Get existing entities from the website collection
            const existingEntities =
                await this.getExistingEntities(websiteCollection);
            const websites =
                await this.getWebsitesFromCollection(websiteCollection);

            // Enhance existing entities with additional data
            const enhancedEntities: EnhancedEntity[] = [];
            for (const entity of existingEntities) {
                const enhanced = await this.enhanceEntityWithWebsiteData(
                    entity,
                    websites,
                );
                enhancedEntities.push(enhanced);
            }

            // Extract additional entities that might have been missed
            const newEntities =
                await this.extractEntitiesFromWebsites(websites);

            // Merge existing and new entities
            const allEntities = this.mergeEntityLists(
                enhancedEntities,
                newEntities,
            );

            // Build relationships
            const relationships = await this.buildEntityRelationships(
                allEntities,
                websites,
            );

            return {
                entities: new Map(allEntities.map((e) => [e.name, e])),
                relationships: this.groupRelationshipsByEntity(relationships),
                entityIndex: this.buildEntityIndex(allEntities),
                lastUpdated: new Date().toISOString(),
                version: 1,
                sourceCount: websites.length,
            };
        } catch (error) {
            console.error("Failed to migrate existing knowledge:", error);
            throw new Error("Knowledge migration failed");
        }
    }

    /**
     * Enhance an existing entity with additional website data
     */
    async enhanceEntityWithWebsiteData(
        entity: Entity,
        websites: Website[],
    ): Promise<EnhancedEntity> {
        const contextSnippets: string[] = [];
        const sourceWebsites: string[] = [];
        const dominantDomains: string[] = [];
        let mentionCount = 0;
        let firstSeen = new Date().toISOString();
        let lastSeen = new Date(0).toISOString();

        // Analyze mentions across websites
        for (const website of websites) {
            const mentions = this.findEntityMentions(entity.name, website);
            if (mentions.length > 0) {
                mentionCount += mentions.length;
                sourceWebsites.push(website.url);
                contextSnippets.push(...mentions.slice(0, 3)); // Top 3 mentions per site

                // Track domains
                const domain = new URL(website.url).hostname;
                if (!dominantDomains.includes(domain)) {
                    dominantDomains.push(domain);
                }

                // Update first/last seen dates
                if (website.timestamp) {
                    const siteDate = new Date(website.timestamp).toISOString();
                    if (siteDate < firstSeen) firstSeen = siteDate;
                    if (siteDate > lastSeen) lastSeen = siteDate;
                }
            }
        }

        // Generate enhanced entity
        return {
            name: entity.name,
            type: entity.type,
            confidence: Math.min(0.95, entity.confidence + mentionCount * 0.01), // Boost confidence based on mentions
            aliases: this.extractAliases(entity.name, contextSnippets),
            mentionCount,
            firstSeen,
            lastSeen,
            dominantDomains: dominantDomains.slice(0, 5), // Top 5 domains
            strongRelationships: [], // Will be populated by relationship building
            coOccurringEntities: [], // Will be populated by co-occurrence analysis
            contextSnippets: contextSnippets.slice(0, 10), // Top 10 snippets
            topicAffinity: this.extractTopics(contextSnippets),
            sourceWebsites: sourceWebsites.slice(0, 20), // Top 20 sources
            extractionMethod: "hybrid",
            lastUpdated: new Date().toISOString(),
        };
    }

    // Private helper methods

    private async extractFromWebsite(
        website: Website,
    ): Promise<ExtractionResult> {
        const cacheKey = `${website.url}_${website.timestamp}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const startTime = Date.now();

        // Extract entities using multiple methods
        const content = website.content || website.title || "";

        // Method 1: Pattern-based extraction
        const patternEntities = this.extractEntitiesWithPatterns(
            content,
            website,
        );

        // Method 2: Named entity recognition (simplified)
        const nerEntities = this.extractEntitiesWithNER(content, website);

        // Method 3: Context-based extraction
        const contextEntities = this.extractEntitiesFromContext(
            content,
            website,
        );

        // Combine and deduplicate
        const allEntities = [
            ...patternEntities,
            ...nerEntities,
            ...contextEntities,
        ];
        const uniqueEntities = this.deduplicateEntities(allEntities);

        const result: ExtractionResult = {
            entities: uniqueEntities,
            relationships: [], // Will be extracted separately
            processingTime: Date.now() - startTime,
            sourceWebsite: website.url,
            extractionQuality: this.calculateExtractionQuality(
                uniqueEntities,
                content,
            ),
        };

        // Cache result
        this.cache.set(cacheKey, result);
        return result;
    }

    private initializePatterns(): void {
        // Person patterns
        this.entityPatterns.set("person", [
            /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g, // First Last
            /\b(Dr\.|Mr\.|Ms\.|Mrs\.|Prof\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g, // Title + Name
        ]);

        // Organization patterns
        this.entityPatterns.set("organization", [
            /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Inc\.|LLC|Corp\.|Company|Corporation)\b/g,
            /\b([A-Z]+(?:\s+[A-Z]+)*)\b/g, // Acronyms
        ]);

        // Product patterns
        this.entityPatterns.set("product", [
            /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(version|v\d+|\d+\.\d+)/gi,
        ]);

        // Technology patterns
        this.entityPatterns.set("technology", [
            /\b(React|Vue|Angular|TypeScript|JavaScript|Python|Java|Node\.js|Docker|Kubernetes)\b/g,
        ]);

        // Relationship patterns
        this.relationshipPatterns.set("works_at", [
            /(\w+(?:\s+\w+)*)\s+works?\s+at\s+(\w+(?:\s+\w+)*)/gi,
            /(\w+(?:\s+\w+)*)\s+is\s+employed\s+by\s+(\w+(?:\s+\w+)*)/gi,
        ]);

        this.relationshipPatterns.set("founded", [
            /(\w+(?:\s+\w+)*)\s+founded\s+(\w+(?:\s+\w+)*)/gi,
            /(\w+(?:\s+\w+)*)\s+established\s+(\w+(?:\s+\w+)*)/gi,
        ]);
    }

    private initializeStopWords(): void {
        const words = [
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
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
        ];
        this.stopWords = new Set(words);
    }

    private extractEntitiesWithPatterns(
        content: string,
        website: Website,
    ): EnhancedEntity[] {
        const entities: EnhancedEntity[] = [];

        for (const [type, patterns] of this.entityPatterns) {
            for (const pattern of patterns) {
                const matches = content.matchAll(pattern);
                for (const match of matches) {
                    const entityName = match[1] || match[0];
                    if (
                        entityName &&
                        !this.stopWords.has(entityName.toLowerCase())
                    ) {
                        entities.push(
                            this.createEnhancedEntity(
                                entityName,
                                type,
                                website,
                                "pattern",
                            ),
                        );
                    }
                }
            }
        }

        return entities;
    }

    private extractEntitiesWithNER(
        content: string,
        website: Website,
    ): EnhancedEntity[] {
        // Simplified NER - in production, this would use a proper NLP library
        const entities: EnhancedEntity[] = [];

        // Look for capitalized words that might be entities
        const words = content.split(/\s+/);
        const capitalizedSequences: string[] = [];
        let currentSequence = "";

        for (const word of words) {
            const cleanWord = word.replace(/[^\w]/g, "");
            if (
                cleanWord &&
                cleanWord[0] === cleanWord[0].toUpperCase() &&
                cleanWord.length > 2
            ) {
                currentSequence = currentSequence
                    ? `${currentSequence} ${cleanWord}`
                    : cleanWord;
            } else {
                if (currentSequence && currentSequence.split(" ").length <= 3) {
                    capitalizedSequences.push(currentSequence);
                }
                currentSequence = "";
            }
        }

        // Add remaining sequence
        if (currentSequence) {
            capitalizedSequences.push(currentSequence);
        }

        // Convert sequences to entities with type inference
        for (const sequence of capitalizedSequences) {
            const inferredType = this.inferEntityType(sequence);
            entities.push(
                this.createEnhancedEntity(
                    sequence,
                    inferredType,
                    website,
                    "nlp",
                ),
            );
        }

        return entities;
    }

    private extractEntitiesFromContext(
        content: string,
        website: Website,
    ): EnhancedEntity[] {
        // Extract entities based on context clues
        const entities: EnhancedEntity[] = [];

        // Technology context
        const techRegex =
            /using\s+(\w+(?:\s+\w+)*)|built\s+with\s+(\w+(?:\s+\w+)*)|powered\s+by\s+(\w+(?:\s+\w+)*)/gi;
        const techMatches = content.matchAll(techRegex);
        for (const match of techMatches) {
            const tech = match[1] || match[2] || match[3];
            if (tech) {
                entities.push(
                    this.createEnhancedEntity(
                        tech,
                        "technology",
                        website,
                        "pattern",
                    ),
                );
            }
        }

        return entities;
    }

    private createEnhancedEntity(
        name: string,
        type: EntityType,
        website: Website,
        method: "nlp" | "pattern" | "manual" | "hybrid",
    ): EnhancedEntity {
        return {
            name: name.trim(),
            type,
            confidence: this.calculateEntityConfidence(name, type, method),
            aliases: [],
            mentionCount: 1,
            firstSeen: website.timestamp || new Date().toISOString(),
            lastSeen: website.timestamp || new Date().toISOString(),
            dominantDomains: [new URL(website.url).hostname],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [
                this.extractContextSnippet(
                    name,
                    website.content || website.title || "",
                ),
            ],
            topicAffinity: [],
            sourceWebsites: [website.url],
            extractionMethod: method,
            lastUpdated: new Date().toISOString(),
        };
    }

    private inferEntityType(text: string): EntityType {
        const lowerText = text.toLowerCase();

        // Technology keywords
        if (
            /\b(js|react|vue|angular|node|python|java|docker|api|sdk|framework|library)\b/.test(
                lowerText,
            )
        ) {
            return "technology";
        }

        // Organization keywords
        if (
            /\b(inc|corp|llc|company|ltd|organization|foundation|institute)\b/.test(
                lowerText,
            )
        ) {
            return "organization";
        }

        // Person indicators (contains common name patterns)
        if (
            /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(text) &&
            text.split(" ").length === 2
        ) {
            return "person";
        }

        // Default to concept
        return "concept";
    }

    private calculateEntityConfidence(
        name: string,
        type: EntityType,
        method: "nlp" | "pattern" | "manual" | "hybrid",
    ): number {
        let confidence = 0.5; // Base confidence

        // Boost based on extraction method
        switch (method) {
            case "manual":
                confidence = 0.95;
                break;
            case "pattern":
                confidence = 0.8;
                break;
            case "nlp":
                confidence = 0.7;
                break;
            case "hybrid":
                confidence = 0.85;
                break;
        }

        // Boost for well-formed names
        if (type === "person" && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name)) {
            confidence += 0.1;
        }

        // Boost for known technology names
        if (
            type === "technology" &&
            /^(React|Vue|Angular|TypeScript|JavaScript|Python|Java)$/i.test(
                name,
            )
        ) {
            confidence += 0.15;
        }

        return Math.min(0.95, confidence);
    }

    private extractContextSnippet(entityName: string, content: string): string {
        const index = content.toLowerCase().indexOf(entityName.toLowerCase());
        if (index === -1) return "";

        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + entityName.length + 50);
        return content.substring(start, end).trim();
    }

    private async extractRelationshipsFromWebsite(
        website: Website,
        entityNames: Set<string>,
    ): Promise<EntityRelationship[]> {
        const relationships: EntityRelationship[] = [];
        const content = website.content || website.title || "";

        // Extract using predefined patterns
        for (const [relType, patterns] of this.relationshipPatterns) {
            for (const pattern of patterns) {
                const matches = content.matchAll(pattern);
                for (const match of matches) {
                    const entity1 = match[1]?.trim();
                    const entity2 = match[2]?.trim();

                    if (
                        entity1 &&
                        entity2 &&
                        entityNames.has(entity1.toLowerCase()) &&
                        entityNames.has(entity2.toLowerCase())
                    ) {
                        relationships.push({
                            relatedEntity: entity2,
                            relationshipType: relType,
                            confidence: 0.8,
                            evidenceSources: [website.url],
                            firstObserved:
                                website.timestamp || new Date().toISOString(),
                            lastObserved:
                                website.timestamp || new Date().toISOString(),
                            strength: 0.7,
                            direction: "unidirectional",
                        });
                    }
                }
            }
        }

        return relationships;
    }

    private mergeEntities(
        existing: EnhancedEntity,
        newEntity: EnhancedEntity,
    ): void {
        // Merge mention counts
        existing.mentionCount += newEntity.mentionCount;

        // Update confidence (weighted average)
        existing.confidence = (existing.confidence + newEntity.confidence) / 2;

        // Merge aliases
        for (const alias of newEntity.aliases) {
            if (!existing.aliases.includes(alias)) {
                existing.aliases.push(alias);
            }
        }

        // Update dates
        if (newEntity.firstSeen < existing.firstSeen) {
            existing.firstSeen = newEntity.firstSeen;
        }
        if (newEntity.lastSeen > existing.lastSeen) {
            existing.lastSeen = newEntity.lastSeen;
        }

        // Merge domains and sources
        existing.dominantDomains.push(...newEntity.dominantDomains);
        existing.sourceWebsites.push(...newEntity.sourceWebsites);
        existing.contextSnippets.push(...newEntity.contextSnippets);

        // Deduplicate arrays
        existing.dominantDomains = [...new Set(existing.dominantDomains)];
        existing.sourceWebsites = [...new Set(existing.sourceWebsites)];

        existing.lastUpdated = new Date().toISOString();
    }

    private deduplicateEntities(entities: EnhancedEntity[]): EnhancedEntity[] {
        const entityMap = new Map<string, EnhancedEntity>();

        for (const entity of entities) {
            const key = entity.name.toLowerCase();
            const existing = entityMap.get(key);

            if (existing) {
                this.mergeEntities(existing, entity);
            } else {
                entityMap.set(key, entity);
            }
        }

        return Array.from(entityMap.values());
    }

    private consolidateRelationships(
        relationships: EntityRelationship[],
    ): EntityRelationship[] {
        const relationshipMap = new Map<string, EntityRelationship>();

        for (const rel of relationships) {
            const key = `${rel.relatedEntity}_${rel.relationshipType}`;
            const existing = relationshipMap.get(key);

            if (existing) {
                // Merge evidence sources
                existing.evidenceSources.push(...rel.evidenceSources);
                existing.evidenceSources = [
                    ...new Set(existing.evidenceSources),
                ];

                // Update confidence (weighted average)
                existing.confidence =
                    (existing.confidence + rel.confidence) / 2;

                // Update strength
                existing.strength = Math.max(existing.strength, rel.strength);

                // Update dates
                if (rel.firstObserved < existing.firstObserved) {
                    existing.firstObserved = rel.firstObserved;
                }
                if (rel.lastObserved > existing.lastObserved) {
                    existing.lastObserved = rel.lastObserved;
                }
            } else {
                relationshipMap.set(key, { ...rel });
            }
        }

        return Array.from(relationshipMap.values());
    }

    private buildEntityIndex(
        entities: EnhancedEntity[],
    ): Map<EntityType, string[]> {
        const index = new Map<EntityType, string[]>();

        for (const entity of entities) {
            const existing = index.get(entity.type) || [];
            existing.push(entity.name);
            index.set(entity.type, existing);
        }

        return index;
    }

    private groupRelationshipsByEntity(
        relationships: EntityRelationship[],
    ): Map<string, EntityRelationship[]> {
        const grouped = new Map<string, EntityRelationship[]>();

        for (const rel of relationships) {
            const existing = grouped.get(rel.relatedEntity) || [];
            existing.push(rel);
            grouped.set(rel.relatedEntity, existing);
        }

        return grouped;
    }

    private findEntityMentions(entityName: string, website: Website): string[] {
        const content = website.content || website.title || "";
        const mentions: string[] = [];
        const regex = new RegExp(`\\b${entityName}\\b`, "gi");

        let match;
        while ((match = regex.exec(content)) !== null) {
            const start = Math.max(0, match.index - 30);
            const end = Math.min(
                content.length,
                match.index + entityName.length + 30,
            );
            mentions.push(content.substring(start, end).trim());
        }

        return mentions;
    }

    private extractAliases(
        entityName: string,
        contextSnippets: string[],
    ): string[] {
        const aliases: string[] = [];

        // Look for common alias patterns in context
        for (const snippet of contextSnippets) {
            // Pattern: "Entity (Alias)" or "Alias (Entity)"
            const aliasPattern = new RegExp(
                `${entityName}\\s*\\(([^)]+)\\)|\\(([^)]+)\\)\\s*${entityName}`,
                "gi",
            );
            const matches = snippet.matchAll(aliasPattern);

            for (const match of matches) {
                const alias = (match[1] || match[2])?.trim();
                if (alias && alias !== entityName && !aliases.includes(alias)) {
                    aliases.push(alias);
                }
            }
        }

        return aliases.slice(0, 5); // Limit to 5 aliases
    }

    private extractTopics(contextSnippets: string[]): string[] {
        const topics: string[] = [];
        const topicKeywords = [
            "technology",
            "business",
            "science",
            "research",
            "development",
            "innovation",
            "software",
            "hardware",
            "artificial intelligence",
            "machine learning",
            "data science",
            "web development",
            "mobile",
            "cloud computing",
            "cybersecurity",
            "blockchain",
            "fintech",
        ];

        const combinedText = contextSnippets.join(" ").toLowerCase();

        for (const keyword of topicKeywords) {
            if (combinedText.includes(keyword) && !topics.includes(keyword)) {
                topics.push(keyword);
            }
        }

        return topics.slice(0, 5); // Limit to 5 topics
    }

    private calculateExtractionQuality(
        entities: EnhancedEntity[],
        content: string,
    ): number {
        // Simple quality metric based on entity density and confidence
        if (entities.length === 0) return 0;

        const avgConfidence =
            entities.reduce((sum, e) => sum + e.confidence, 0) /
            entities.length;
        const entityDensity = Math.min(
            1,
            entities.length / (content.length / 100),
        ); // Entities per 100 chars

        return avgConfidence * 0.7 + entityDensity * 0.3;
    }

    private mergeEntityLists(
        list1: EnhancedEntity[],
        list2: EnhancedEntity[],
    ): EnhancedEntity[] {
        const merged = [...list1];

        for (const entity of list2) {
            const existing = merged.find(
                (e) => e.name.toLowerCase() === entity.name.toLowerCase(),
            );
            if (existing) {
                this.mergeEntities(existing, entity);
            } else {
                merged.push(entity);
            }
        }

        return merged;
    }

    // Integration with existing TypeAgent systems
    private async getExistingEntities(
        websiteCollection: WebsiteCollection,
    ): Promise<Entity[]> {
        // This would integrate with the existing entity system
        // For now, return empty array - implement based on actual TypeAgent entity API
        return [];
    }

    private async getWebsitesFromCollection(
        websiteCollection: WebsiteCollection,
    ): Promise<Website[]> {
        // This would get websites from the collection
        // For now, return empty array - implement based on actual WebsiteCollection API
        return [];
    }
}
