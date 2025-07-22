// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EnhancedEntity,
    EntityType,
    EntityRelationship,
    EntityKnowledgeGraph,
    EntityGraphManager,
    EntityCoOccurrence,
} from "./entityGraph.mjs";

/**
 * Mock Entity Data Generator for Phase 1 Development
 *
 * Provides comprehensive mock data scenarios for testing
 * and demonstrating the entity graph visualization.
 */
export class EntityMockDataGenerator {
    private graphManager: EntityGraphManager;

    constructor() {
        this.graphManager = new EntityGraphManager();
    }

    /**
     * Generate a technology ecosystem mock graph
     */
    async generateTechEcosystemGraph(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        // Add tech ecosystem entities
        const entities = this.createTechEcosystemEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    /**
     * Generate a business ecosystem mock graph
     */
    async generateBusinessEcosystemGraph(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        const entities = this.createBusinessEcosystemEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    /**
     * Generate Microsoft ecosystem mock graph
     */
    async generateMicrosoftEcosystem(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        const entities = this.createMicrosoftEcosystemEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    /**
     * Generate OpenAI ecosystem mock graph
     */
    async generateOpenAIEcosystem(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        const entities = this.createOpenAIEcosystemEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    /**
     * Generate startup ecosystem mock graph
     */
    async generateStartupEcosystem(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        const entities = this.createStartupEcosystemEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    /**
     * Generate academic research ecosystem
     */
    async generateAcademicResearchGraph(): Promise<EntityKnowledgeGraph> {
        await this.graphManager.initialize();
        this.graphManager.clear();

        const entities = this.createAcademicResearchEntities();
        entities.forEach((entity) => this.graphManager.addEntity(entity));

        return this.graphManager.getGraph();
    }

    private createTechEcosystemEntities(): EnhancedEntity[] {
        const now = new Date();
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        return [
            this.createEntity({
                name: "React",
                type: "technology",
                confidence: 0.95,
                aliases: ["React.js", "ReactJS"],
                mentionCount: 45,
                firstSeen: "2024-01-15T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: [
                    "github.com",
                    "reactjs.org",
                    "stackoverflow.com",
                ],
                relationships: [
                    {
                        relatedEntity: "Next.js",
                        relationshipType: "framework_based_on",
                        confidence: 0.9,
                        strength: 0.8,
                        evidenceSources: [
                            "github.com/vercel/next.js",
                            "nextjs.org",
                        ],
                        firstObserved: "2024-01-20T10:00:00Z",
                        lastObserved: now.toISOString(),
                    },
                    {
                        relatedEntity: "Facebook",
                        relationshipType: "created_by",
                        confidence: 0.95,
                        strength: 0.9,
                        evidenceSources: ["reactjs.org", "engineering.fb.com"],
                        firstObserved: "2024-01-15T10:00:00Z",
                        lastObserved: lastMonth.toISOString(),
                    },
                ],
                coOccurringEntities: [
                    {
                        entityName: "Next.js",
                        coOccurrenceCount: 15,
                        contexts: ["documentation", "tutorials"],
                        confidence: 0.9,
                    },
                ],
                contextSnippets: [
                    "React is a JavaScript library for building user interfaces",
                ],
                topicAffinity: [
                    "frontend development",
                    "JavaScript",
                    "web frameworks",
                ],
            }),

            this.createEntity({
                name: "Facebook",
                type: "organization",
                confidence: 0.95,
                aliases: ["Meta", "Meta Platforms"],
                mentionCount: 32,
                firstSeen: "2024-01-15T10:00:00Z",
                lastSeen: lastMonth.toISOString(),
                dominantDomains: ["facebook.com", "engineering.fb.com"],
                relationships: [
                    {
                        relatedEntity: "React",
                        relationshipType: "created",
                        confidence: 0.95,
                        strength: 0.9,
                        evidenceSources: ["reactjs.org", "engineering.fb.com"],
                        firstObserved: "2024-01-15T10:00:00Z",
                        lastObserved: lastMonth.toISOString(),
                    },
                ],
                coOccurringEntities: [
                    {
                        entityName: "React",
                        coOccurrenceCount: 18,
                        contexts: ["engineering blog"],
                        confidence: 0.9,
                    },
                ],
                contextSnippets: [
                    "Leading social media platform and technology company",
                ],
                topicAffinity: [
                    "social media",
                    "open source",
                    "web technologies",
                ],
            }),
        ];
    }

    private createBusinessEcosystemEntities(): EnhancedEntity[] {
        const now = new Date();

        return [
            this.createEntity({
                name: "Apple",
                type: "organization",
                confidence: 0.96,
                aliases: ["Apple Inc.", "AAPL"],
                mentionCount: 52,
                firstSeen: "2024-01-10T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: ["apple.com", "developer.apple.com"],
                relationships: [
                    {
                        relatedEntity: "iPhone",
                        relationshipType: "created",
                        confidence: 0.98,
                        strength: 0.95,
                        evidenceSources: ["apple.com"],
                        firstObserved: "2024-01-10T10:00:00Z",
                        lastObserved: now.toISOString(),
                    },
                ],
                coOccurringEntities: [
                    {
                        entityName: "iPhone",
                        coOccurrenceCount: 35,
                        contexts: ["product launches"],
                        confidence: 0.95,
                    },
                ],
                contextSnippets: [
                    "Technology company known for innovative consumer electronics",
                ],
                topicAffinity: [
                    "consumer electronics",
                    "mobile technology",
                    "design",
                ],
            }),
        ];
    }

    private createMicrosoftEcosystemEntities(): EnhancedEntity[] {
        const now = new Date();

        return [
            this.createEntity({
                name: "Microsoft",
                type: "organization",
                confidence: 0.96,
                aliases: ["Microsoft Corp.", "MSFT"],
                mentionCount: 78,
                firstSeen: "2024-01-05T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: ["microsoft.com"],
                relationships: [
                    {
                        relatedEntity: "Satya Nadella",
                        relationshipType: "led_by",
                        confidence: 0.95,
                        strength: 0.9,
                        evidenceSources: ["microsoft.com"],
                        firstObserved: "2024-01-05T10:00:00Z",
                        lastObserved: now.toISOString(),
                    },
                ],
                coOccurringEntities: [
                    {
                        entityName: "Satya Nadella",
                        coOccurrenceCount: 45,
                        contexts: ["earnings calls"],
                        confidence: 0.95,
                    },
                ],
                contextSnippets: [
                    "Leading technology company and cloud computing provider",
                ],
                topicAffinity: ["cloud computing", "enterprise software"],
            }),
        ];
    }

    private createOpenAIEcosystemEntities(): EnhancedEntity[] {
        const now = new Date();

        return [
            this.createEntity({
                name: "OpenAI",
                type: "organization",
                confidence: 0.96,
                aliases: ["OpenAI Inc."],
                mentionCount: 89,
                firstSeen: "2024-01-01T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: ["openai.com"],
                relationships: [
                    {
                        relatedEntity: "ChatGPT",
                        relationshipType: "created",
                        confidence: 0.98,
                        strength: 0.95,
                        evidenceSources: ["openai.com"],
                        firstObserved: "2024-01-01T10:00:00Z",
                        lastObserved: now.toISOString(),
                    },
                ],
                coOccurringEntities: [
                    {
                        entityName: "ChatGPT",
                        coOccurrenceCount: 67,
                        contexts: ["product launches"],
                        confidence: 0.95,
                    },
                ],
                contextSnippets: [
                    "Leading artificial intelligence research company",
                ],
                topicAffinity: ["artificial intelligence", "machine learning"],
            }),
        ];
    }

    private createStartupEcosystemEntities(): EnhancedEntity[] {
        const now = new Date();

        return [
            this.createEntity({
                name: "Y Combinator",
                type: "organization",
                confidence: 0.94,
                aliases: ["YC"],
                mentionCount: 42,
                firstSeen: "2024-02-01T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: ["ycombinator.com"],
                relationships: [],
                coOccurringEntities: [],
                contextSnippets: [
                    "Leading startup accelerator and seed funding program",
                ],
                topicAffinity: ["startup funding", "entrepreneurship"],
            }),
        ];
    }

    private createAcademicResearchEntities(): EnhancedEntity[] {
        const now = new Date();

        return [
            this.createEntity({
                name: "MIT",
                type: "organization",
                confidence: 0.96,
                aliases: ["Massachusetts Institute of Technology"],
                mentionCount: 38,
                firstSeen: "2024-01-01T10:00:00Z",
                lastSeen: now.toISOString(),
                dominantDomains: ["mit.edu"],
                relationships: [],
                coOccurringEntities: [],
                contextSnippets: [
                    "Leading research university in science and technology",
                ],
                topicAffinity: ["research", "education", "technology"],
            }),
        ];
    }

    private createEntity(config: {
        name: string;
        type: EntityType;
        confidence: number;
        aliases: string[];
        mentionCount: number;
        firstSeen: string;
        lastSeen: string;
        dominantDomains: string[];
        relationships: Array<{
            relatedEntity: string;
            relationshipType: string;
            confidence: number;
            strength: number;
            evidenceSources: string[];
            firstObserved: string;
            lastObserved: string;
        }>;
        coOccurringEntities: EntityCoOccurrence[];
        contextSnippets: string[];
        topicAffinity: string[];
    }): EnhancedEntity {
        const relationships: EntityRelationship[] = config.relationships.map(
            (rel) => ({
                relatedEntity: rel.relatedEntity,
                relationshipType: rel.relationshipType,
                confidence: rel.confidence,
                evidenceSources: rel.evidenceSources,
                firstObserved: rel.firstObserved,
                lastObserved: rel.lastObserved,
                strength: rel.strength,
            }),
        );

        return {
            name: config.name,
            type: config.type,
            confidence: config.confidence,
            aliases: config.aliases,
            mentionCount: config.mentionCount,
            firstSeen: config.firstSeen,
            lastSeen: config.lastSeen,
            dominantDomains: config.dominantDomains,
            strongRelationships: relationships,
            coOccurringEntities: config.coOccurringEntities,
            contextSnippets: config.contextSnippets,
            topicAffinity: config.topicAffinity,
            centrality: Math.random() * 0.5 + 0.3,
            importance: (config.confidence * config.mentionCount) / 100,
            clusterGroup: this.determineClusterGroup(
                config.type,
                config.topicAffinity,
            ),
        };
    }

    private determineClusterGroup(type: EntityType, topics: string[]): string {
        if (
            topics.some(
                (t) =>
                    t.includes("AI") || t.includes("artificial intelligence"),
            )
        ) {
            return "ai-cluster";
        }
        if (topics.some((t) => t.includes("web") || t.includes("frontend"))) {
            return "web-tech-cluster";
        }
        if (type === "person") {
            return "people-cluster";
        }
        if (type === "organization") {
            return "org-cluster";
        }
        return "general-cluster";
    }

    /**
     * Get all available mock scenarios
     */
    getAvailableScenarios(): Array<{
        id: string;
        name: string;
        description: string;
    }> {
        return [
            {
                id: "tech_ecosystem",
                name: "Technology Ecosystem",
                description:
                    "React, Next.js, TypeScript, and web development technologies",
            },
            {
                id: "business_ecosystem",
                name: "Business Ecosystem",
                description:
                    "Apple, iPhone, iOS, and mobile technology companies",
            },
            {
                id: "microsoft_ecosystem",
                name: "Microsoft Ecosystem",
                description:
                    "Microsoft, Azure, Office 365, and enterprise software",
            },
            {
                id: "openai_ecosystem",
                name: "OpenAI Ecosystem",
                description: "OpenAI, ChatGPT, GPT-4, and AI technologies",
            },
            {
                id: "startup_ecosystem",
                name: "Startup Ecosystem",
                description:
                    "Y Combinator, funded startups, and entrepreneurship",
            },
            {
                id: "academic_research",
                name: "Academic Research",
                description:
                    "MIT, research institutions, and academic publications",
            },
        ];
    }

    /**
     * Generate a scenario by ID
     */
    async generateScenario(
        scenarioId: string,
    ): Promise<EntityKnowledgeGraph | null> {
        switch (scenarioId) {
            case "tech_ecosystem":
                return this.generateTechEcosystemGraph();
            case "business_ecosystem":
                return this.generateBusinessEcosystemGraph();
            case "microsoft_ecosystem":
                return this.generateMicrosoftEcosystem();
            case "openai_ecosystem":
                return this.generateOpenAIEcosystem();
            case "startup_ecosystem":
                return this.generateStartupEcosystem();
            case "academic_research":
                return this.generateAcademicResearchGraph();
            default:
                return null;
        }
    }
}

/**
 * Pre-defined mock scenarios for quick access
 */
export const MOCK_SCENARIOS = {
    MICROSOFT_ECOSYSTEM: "microsoft_ecosystem",
    OPENAI_ECOSYSTEM: "openai_ecosystem",
    TECH_ECOSYSTEM: "tech_ecosystem",
    BUSINESS_ECOSYSTEM: "business_ecosystem",
    STARTUP_ECOSYSTEM: "startup_ecosystem",
    ACADEMIC_RESEARCH: "academic_research",
} as const;
