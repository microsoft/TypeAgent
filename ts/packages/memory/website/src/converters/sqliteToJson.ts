// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import type { 
    EntityGraphJson, 
    TopicGraphJson 
} from "../storage/graphJsonStorage.js";
import type {
    KnowledgeEntity,
    TopicRelationship,
    TopicEntityRelation,
    TopicMetrics,
    KnowledgeEntityTable,
    RelationshipTable,
    CommunityTable,
    KnowledgeTopicTable,
    HierarchicalTopicTable,
    TopicRelationshipTable,
    TopicEntityRelationTable,
    TopicMetricsTable
} from "../tables.js";

const debug = registerDebug("typeagent:website:converter:sqlite-to-json");

/**
 * Interface representing a WebsiteCollection with all the table references
 */
export interface WebsiteCollection {
    knowledgeEntities?: KnowledgeEntityTable;
    relationships?: RelationshipTable;
    communities?: CommunityTable;
    knowledgeTopics?: KnowledgeTopicTable;
    hierarchicalTopics?: HierarchicalTopicTable;
    topicRelationships?: TopicRelationshipTable;
    topicEntityRelations?: TopicEntityRelationTable;
    topicMetrics?: TopicMetricsTable;
}

/**
 * Converts SQLite-based graph data to JSON format for file storage
 */
export class SqliteToJsonConverter {
    constructor(private websiteCollection: WebsiteCollection) {}

    /**
     * Convert entity graph data from SQLite to JSON format
     */
    async convertEntityGraph(): Promise<EntityGraphJson> {
        debug("Converting entity graph from SQLite to JSON");
        
        const entities = this.convertEntities();
        const relationships = this.convertRelationships();
        const communities = this.convertCommunities();

        const entityGraph: EntityGraphJson = {
            nodes: entities,
            edges: relationships,
            communities: communities,
            metadata: {
                version: "1.0.0",
                lastUpdated: new Date().toISOString(),
                nodeCount: entities.length,
                edgeCount: relationships.length,
                communityCount: communities.length
            }
        };

        debug(`Entity graph converted: ${entities.length} nodes, ${relationships.length} edges, ${communities.length} communities`);
        return entityGraph;
    }

    /**
     * Convert topic graph data from SQLite to JSON format
     */
    async convertTopicGraph(): Promise<TopicGraphJson> {
        debug("Converting topic graph from SQLite to JSON");
        
        const topics = this.convertTopics();
        const topicRelationships = this.convertTopicRelationships();
        const topicEntityRelations = this.convertTopicEntityRelations();
        const metrics = this.convertTopicMetrics();

        const topicGraph: TopicGraphJson = {
            nodes: topics,
            edges: topicRelationships,
            topicEntityRelations: topicEntityRelations,
            metrics: metrics,
            metadata: {
                version: "1.0.0",
                lastUpdated: new Date().toISOString(),
                nodeCount: topics.length,
                edgeCount: topicRelationships.length,
                relationshipCount: topicEntityRelations.length
            }
        };

        debug(`Topic graph converted: ${topics.length} nodes, ${topicRelationships.length} edges, ${topicEntityRelations.length} relations`);
        return topicGraph;
    }

    /**
     * Convert knowledge entities to JSON node format
     */
    private convertEntities(): EntityGraphJson['nodes'] {
        if (!this.websiteCollection.knowledgeEntities) {
            debug("No knowledge entities table found");
            return [];
        }

        try {
            // Group entities by name to aggregate metadata
            const entityMap = new Map<string, {
                id: string;
                name: string;
                type: string;
                confidence: number;
                domains: Set<string>;
                urls: Set<string>;
                extractionDates: string[];
            }>();

            // Get all entities - we'll need to iterate through the raw data
            const stmt = (this.websiteCollection.knowledgeEntities as any).db.prepare(`
                SELECT * FROM knowledgeEntities 
                WHERE entityName != '' AND entityName IS NOT NULL
                ORDER BY confidence DESC
            `);
            const entities = stmt.all() as KnowledgeEntity[];

            debug(`Processing ${entities.length} knowledge entities`);

            for (const entity of entities) {
                const key = entity.entityName;
                
                if (!entityMap.has(key)) {
                    entityMap.set(key, {
                        id: key, // Use entity name as ID
                        name: entity.entityName,
                        type: entity.entityType,
                        confidence: entity.confidence,
                        domains: new Set([entity.domain]),
                        urls: new Set([entity.url]),
                        extractionDates: [entity.extractionDate]
                    });
                } else {
                    const existing = entityMap.get(key)!;
                    existing.confidence = Math.max(existing.confidence, entity.confidence);
                    existing.domains.add(entity.domain);
                    existing.urls.add(entity.url);
                    existing.extractionDates.push(entity.extractionDate);
                }
            }

            // Convert to final format
            const nodes = Array.from(entityMap.values()).map(entity => ({
                id: entity.id,
                name: entity.name,
                type: entity.type,
                confidence: entity.confidence,
                metadata: {
                    domain: Array.from(entity.domains)[0], // Primary domain
                    urls: Array.from(entity.urls),
                    extractionDate: entity.extractionDates[0] // Earliest date
                }
            }));

            debug(`Converted ${nodes.length} unique entities`);
            return nodes;
        } catch (error) {
            debug(`Error converting entities: ${error}`);
            return [];
        }
    }

    /**
     * Convert relationships to JSON edge format
     */
    private convertRelationships(): EntityGraphJson['edges'] {
        if (!this.websiteCollection.relationships) {
            debug("No relationships table found");
            return [];
        }

        try {
            const relationships = this.websiteCollection.relationships.getAllRelationships();
            debug(`Processing ${relationships.length} relationships`);

            const edges = relationships.map(rel => ({
                source: rel.fromEntity,
                target: rel.toEntity,
                type: rel.relationshipType,
                confidence: rel.confidence,
                metadata: {
                    sources: rel.sources ? JSON.parse(rel.sources) : [],
                    count: rel.count,
                    updated: rel.updated
                }
            }));

            debug(`Converted ${edges.length} relationships to edges`);
            return edges;
        } catch (error) {
            debug(`Error converting relationships: ${error}`);
            return [];
        }
    }

    /**
     * Convert communities to JSON format
     */
    private convertCommunities(): EntityGraphJson['communities'] {
        if (!this.websiteCollection.communities) {
            debug("No communities table found");
            return [];
        }

        try {
            const communities = this.websiteCollection.communities.getAllCommunities();
            debug(`Processing ${communities.length} communities`);

            const convertedCommunities = communities.map(community => ({
                id: community.id,
                entities: JSON.parse(community.entities),
                topics: JSON.parse(community.topics),
                size: community.size,
                density: community.density,
                updated: community.updated
            }));

            debug(`Converted ${convertedCommunities.length} communities`);
            return convertedCommunities;
        } catch (error) {
            debug(`Error converting communities: ${error}`);
            return [];
        }
    }

    /**
     * Convert hierarchical topics to JSON node format
     */
    private convertTopics(): TopicGraphJson['nodes'] {
        if (!this.websiteCollection.hierarchicalTopics) {
            debug("No hierarchical topics table found");
            return [];
        }

        try {
            const topics = this.websiteCollection.hierarchicalTopics.getTopicHierarchy();
            debug(`Processing ${topics.length} hierarchical topics`);

            const nodes: TopicGraphJson['nodes'] = topics.map(topic => ({
                id: topic.topicId,
                name: topic.topicName,
                level: topic.level,
                ...(topic.parentTopicId && { parentId: topic.parentTopicId }),
                confidence: topic.confidence,
                metadata: {
                    keywords: topic.keywords ? JSON.parse(topic.keywords) : [],
                    sourceTopicNames: topic.sourceTopicNames ? JSON.parse(topic.sourceTopicNames) : [],
                    domains: [topic.domain],
                    urls: [topic.url],
                    extractionDate: topic.extractionDate
                }
            }));

            debug(`Converted ${nodes.length} topics to nodes`);
            return nodes;
        } catch (error) {
            debug(`Error converting topics: ${error}`);
            return [];
        }
    }

    /**
     * Convert topic relationships to JSON edge format
     */
    private convertTopicRelationships(): TopicGraphJson['edges'] {
        if (!this.websiteCollection.topicRelationships) {
            debug("No topic relationships table found");
            return [];
        }

        try {
            // Get all topic relationships from the database
            const stmt = (this.websiteCollection.topicRelationships as any).db.prepare(`
                SELECT * FROM topicRelationships 
                ORDER BY strength DESC
            `);
            const relationships = stmt.all() as TopicRelationship[];
            
            debug(`Processing ${relationships.length} topic relationships`);

            const edges: TopicGraphJson['edges'] = relationships.map(rel => ({
                source: rel.fromTopic,
                target: rel.toTopic,
                type: rel.relationshipType,
                strength: rel.strength,
                metadata: {
                    ...(rel.cooccurrenceCount !== null && rel.cooccurrenceCount !== undefined && { cooccurrenceCount: rel.cooccurrenceCount }),
                    sourceUrls: rel.sourceUrls ? JSON.parse(rel.sourceUrls) : [],
                    ...(rel.firstSeen && { firstSeen: rel.firstSeen }),
                    ...(rel.lastSeen && { lastSeen: rel.lastSeen }),
                    updated: rel.updated
                }
            }));

            debug(`Converted ${edges.length} topic relationships to edges`);
            return edges;
        } catch (error) {
            debug(`Error converting topic relationships: ${error}`);
            return [];
        }
    }

    /**
     * Convert topic-entity relations
     */
    private convertTopicEntityRelations(): TopicGraphJson['topicEntityRelations'] {
        if (!this.websiteCollection.topicEntityRelations) {
            debug("No topic entity relations table found");
            return [];
        }

        try {
            // Get all topic-entity relations from the database
            const stmt = (this.websiteCollection.topicEntityRelations as any).db.prepare(`
                SELECT * FROM topicEntityRelations 
                ORDER BY relevance DESC
            `);
            const relations = stmt.all() as TopicEntityRelation[];
            
            debug(`Processing ${relations.length} topic-entity relations`);

            const topicEntityRelations = relations.map(rel => ({
                topicId: rel.topicId,
                entityName: rel.entityName,
                relevance: rel.relevance,
                domain: rel.domain
            }));

            debug(`Converted ${topicEntityRelations.length} topic-entity relations`);
            return topicEntityRelations;
        } catch (error) {
            debug(`Error converting topic-entity relations: ${error}`);
            return [];
        }
    }

    /**
     * Convert topic metrics
     */
    private convertTopicMetrics(): TopicGraphJson['metrics'] {
        if (!this.websiteCollection.topicMetrics) {
            debug("No topic metrics table found");
            return {};
        }

        try {
            // Get all topic metrics from the database
            const stmt = (this.websiteCollection.topicMetrics as any).db.prepare(`
                SELECT * FROM topicMetrics
            `);
            const metrics = stmt.all() as TopicMetrics[];
            
            debug(`Processing ${metrics.length} topic metrics`);

            const metricsRecord: Record<string, TopicGraphJson['metrics'][string]> = {};
            
            for (const metric of metrics) {
                metricsRecord[metric.topicId] = {
                    topicId: metric.topicId,
                    topicName: metric.topicName,
                    documentCount: metric.documentCount,
                    domainCount: metric.domainCount,
                    degreeCentrality: metric.degreeCentrality,
                    betweennessCentrality: metric.betweennessCentrality,
                    ...(metric.firstSeen && { firstSeen: metric.firstSeen }),
                    ...(metric.lastSeen && { lastSeen: metric.lastSeen }),
                    activityPeriod: metric.activityPeriod,
                    avgConfidence: metric.avgConfidence,
                    maxConfidence: metric.maxConfidence,
                    totalRelationships: metric.totalRelationships,
                    strongRelationships: metric.strongRelationships,
                    entityCount: metric.entityCount,
                    ...(metric.topEntities && { topEntities: metric.topEntities }),
                    updated: metric.updated
                };
            }

            debug(`Converted ${Object.keys(metricsRecord).length} topic metrics`);
            return metricsRecord;
        } catch (error) {
            debug(`Error converting topic metrics: ${error}`);
            return {};
        }
    }

    /**
     * Validate that the conversion will be successful before attempting
     */
    validateConversionPossible(): { 
        canConvert: boolean; 
        issues: string[];
        entityCount: number;
        topicCount: number;
    } {
        const issues: string[] = [];
        let entityCount = 0;
        let topicCount = 0;

        // Check entity tables
        if (!this.websiteCollection.knowledgeEntities) {
            issues.push("Knowledge entities table not available");
        } else {
            try {
                entityCount = this.websiteCollection.knowledgeEntities.getUniqueEntityCount();
            } catch (error) {
                issues.push(`Error accessing entity count: ${error}`);
            }
        }

        if (!this.websiteCollection.relationships) {
            issues.push("Relationships table not available");
        }

        // Check topic tables
        if (!this.websiteCollection.hierarchicalTopics) {
            issues.push("Hierarchical topics table not available");
        } else {
            try {
                const topics = this.websiteCollection.hierarchicalTopics.getTopicHierarchy();
                topicCount = topics.length;
            } catch (error) {
                issues.push(`Error accessing topic count: ${error}`);
            }
        }

        const canConvert = issues.length === 0 && (entityCount > 0 || topicCount > 0);

        return {
            canConvert,
            issues,
            entityCount,
            topicCount
        };
    }
}