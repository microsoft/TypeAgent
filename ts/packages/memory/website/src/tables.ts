// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sqlite from "better-sqlite3";
import * as ms from "memory-storage";

// Website visit frequency table
export interface VisitFrequency {
    domain: string;
    visitCount: number;
    lastVisitDate: string;
    averageTimeSpent?: number;
}

export class VisitFrequencyTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "visitFrequency", [
            ["domain", { type: "string" }],
            ["visitCount", { type: "number" }],
            ["lastVisitDate", { type: "string" }],
            ["averageTimeSpent", { type: "number", optional: true }],
        ]);
    }

    public getTopDomainsByVisits(limit: number = 10): VisitFrequency[] {
        const stmt = this.db.prepare(`
            SELECT * FROM visitFrequency 
            ORDER BY visitCount DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as VisitFrequency[];
    }
}

// Website categories table
export interface WebsiteCategory {
    domain: string;
    category: string;
    confidence: number;
}

export class WebsiteCategoryTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "websiteCategories", [
            ["domain", { type: "string" }],
            ["category", { type: "string" }],
            ["confidence", { type: "number" }],
        ]);
    }

    public getCategoriesForDomain(domain: string): WebsiteCategory[] {
        const stmt = this.db.prepare(`
            SELECT * FROM websiteCategories 
            WHERE domain = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(domain) as WebsiteCategory[];
    }

    public getDomainsByCategory(category: string): WebsiteCategory[] {
        const stmt = this.db.prepare(`
            SELECT * FROM websiteCategories 
            WHERE category = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(category) as WebsiteCategory[];
    }
}

// Bookmark folder structure table
export interface BookmarkFolder {
    folderPath: string;
    url: string;
    title: string;
    dateAdded: string;
}

export class BookmarkFolderTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "bookmarkFolders", [
            ["folderPath", { type: "string" }],
            ["url", { type: "string" }],
            ["title", { type: "string" }],
            ["dateAdded", { type: "string" }],
        ]);
    }

    public getBookmarksByFolder(folderPath: string): BookmarkFolder[] {
        const stmt = this.db.prepare(`
            SELECT * FROM bookmarkFolders 
            WHERE folderPath LIKE ? 
            ORDER BY dateAdded DESC
        `);
        return stmt.all(`${folderPath}%`) as BookmarkFolder[];
    }

    public getAllFolders(): string[] {
        const stmt = this.db.prepare(`
            SELECT DISTINCT folderPath FROM bookmarkFolders 
            ORDER BY folderPath
        `);
        return stmt.all().map((row: any) => row.folderPath);
    }
}

// Knowledge entities table
export interface KnowledgeEntity {
    url: string;
    domain: string;
    entityName: string;
    entityType: string;
    confidence: number;
    extractionDate: string;
}

export class KnowledgeEntityTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "knowledgeEntities", [
            ["url", { type: "string" }],
            ["domain", { type: "string" }],
            ["entityName", { type: "string" }],
            ["entityType", { type: "string" }],
            ["confidence", { type: "number" }],
            ["extractionDate", { type: "string" }],
        ]);
    }

    public getEntitiesByDomain(domain: string): KnowledgeEntity[] {
        const stmt = this.db.prepare(`
            SELECT * FROM knowledgeEntities 
            WHERE domain = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(domain) as KnowledgeEntity[];
    }

    public getTopEntities(
        limit: number = 20,
    ): Array<{ entityName: string; count: number }> {
        const stmt = this.db.prepare(`
            SELECT entityName, COUNT(*) as count 
            FROM knowledgeEntities 
            GROUP BY entityName 
            ORDER BY count DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as Array<{ entityName: string; count: number }>;
    }

    public getEntitiesByType(entityType: string): KnowledgeEntity[] {
        const stmt = this.db.prepare(`
            SELECT * FROM knowledgeEntities 
            WHERE entityType = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(entityType) as KnowledgeEntity[];
    }

    public getTotalEntityCount(): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM knowledgeEntities
        `);
        const result = stmt.get() as { count: number };
        return result.count;
    }
}

// Knowledge topics table
export interface KnowledgeTopic {
    url: string;
    domain: string;
    topic: string;
    relevance: number;
    extractionDate: string;
}

export class KnowledgeTopicTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "knowledgeTopics", [
            ["url", { type: "string" }],
            ["domain", { type: "string" }],
            ["topic", { type: "string" }],
            ["relevance", { type: "number" }],
            ["extractionDate", { type: "string" }],
        ]);
    }

    public getTopicsByDomain(domain: string): KnowledgeTopic[] {
        const stmt = this.db.prepare(`
            SELECT * FROM knowledgeTopics 
            WHERE domain = ? 
            ORDER BY relevance DESC
        `);
        return stmt.all(domain) as KnowledgeTopic[];
    }

    public getTopTopics(
        limit: number = 20,
    ): Array<{ topic: string; count: number }> {
        const stmt = this.db.prepare(`
            SELECT topic, COUNT(*) as count 
            FROM knowledgeTopics 
            GROUP BY topic 
            ORDER BY count DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as Array<{ topic: string; count: number }>;
    }

    public getRelatedTopics(
        topic: string,
        limit: number = 10,
    ): KnowledgeTopic[] {
        const stmt = this.db.prepare(`
            SELECT DISTINCT kt.* FROM knowledgeTopics kt
            WHERE kt.url IN (
                SELECT url FROM knowledgeTopics 
                WHERE topic LIKE ?
            ) AND kt.topic != ?
            ORDER BY kt.relevance DESC
            LIMIT ?
        `);
        return stmt.all(`%${topic}%`, topic, limit) as KnowledgeTopic[];
    }

    public getTotalTopicCount(): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM knowledgeTopics
        `);
        const result = stmt.get() as { count: number };
        return result.count;
    }
}

// Action-Knowledge correlation table
export interface ActionKnowledgeCorrelation {
    url: string;
    domain: string;
    actionType: string;
    relatedEntity: string;
    relatedTopic: string;
    confidence: number;
    correlationDate: string;
}

export class ActionKnowledgeCorrelationTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "actionKnowledgeCorrelations", [
            ["url", { type: "string" }],
            ["domain", { type: "string" }],
            ["actionType", { type: "string" }],
            ["relatedEntity", { type: "string" }],
            ["relatedTopic", { type: "string" }],
            ["confidence", { type: "number" }],
            ["correlationDate", { type: "string" }],
        ]);
    }

    public getCorrelationsByAction(
        actionType: string,
    ): ActionKnowledgeCorrelation[] {
        const stmt = this.db.prepare(`
            SELECT * FROM actionKnowledgeCorrelations 
            WHERE actionType = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(actionType) as ActionKnowledgeCorrelation[];
    }

    public getActionsByEntity(entity: string): ActionKnowledgeCorrelation[] {
        const stmt = this.db.prepare(`
            SELECT * FROM actionKnowledgeCorrelations 
            WHERE relatedEntity = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(entity) as ActionKnowledgeCorrelation[];
    }

    public getActionTopicMatrix(): Array<{
        actionType: string;
        topic: string;
        count: number;
    }> {
        const stmt = this.db.prepare(`
            SELECT actionType, relatedTopic as topic, COUNT(*) as count 
            FROM actionKnowledgeCorrelations 
            GROUP BY actionType, relatedTopic 
            ORDER BY count DESC
        `);
        return stmt.all() as Array<{
            actionType: string;
            topic: string;
            count: number;
        }>;
    }
}

// Entity relationships table
export interface Relationship {
    fromEntity: string;
    toEntity: string;
    relationshipType: string;
    confidence: number;
    sources: string; // JSON array of URLs that support this relationship
    count: number;
    updated: string;
}

export class RelationshipTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "relationships", [
            ["fromEntity", { type: "string" }],
            ["toEntity", { type: "string" }],
            ["relationshipType", { type: "string" }],
            ["confidence", { type: "number" }],
            ["sources", { type: "string" }], // JSON array
            ["count", { type: "number" }],
            ["updated", { type: "string" }],
        ]);
    }

    public getNeighbors(
        entityName: string,
        minConfidence = 0.3,
    ): Relationship[] {
        const stmt = this.db.prepare(`
            SELECT * FROM relationships 
            WHERE (fromEntity = ? OR toEntity = ?) AND confidence >= ?
            ORDER BY confidence DESC
        `);
        return stmt.all(
            entityName,
            entityName,
            minConfidence,
        ) as Relationship[];
    }

    public getRelationshipsForEntities(entities: string[]): Relationship[] {
        const placeholders = entities.map(() => "?").join(",");
        const stmt = this.db.prepare(`
            SELECT * FROM relationships 
            WHERE fromEntity IN (${placeholders}) OR toEntity IN (${placeholders})
            ORDER BY confidence DESC
        `);
        return stmt.all(...entities, ...entities) as Relationship[];
    }

    public getAllRelationships(): Relationship[] {
        const stmt = this.db.prepare(`
            SELECT * FROM relationships 
            ORDER BY confidence DESC
        `);
        return stmt.all() as Relationship[];
    }

    public clear(): void {
        const stmt = this.db.prepare(`DELETE FROM relationships`);
        stmt.run();
    }
}

// Graph communities table
export interface Community {
    id: string;
    entities: string; // JSON array of entity names
    topics: string; // JSON array of related topics
    size: number;
    density: number;
    updated: string;
}

export class CommunityTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "communities", [
            ["id", { type: "string" }],
            ["entities", { type: "string" }], // JSON array
            ["topics", { type: "string" }], // JSON array
            ["size", { type: "number" }],
            ["density", { type: "number" }],
            ["updated", { type: "string" }],
        ]);
    }

    public getForEntities(entityNames: string[]): Community[] {
        if (entityNames.length === 0) return [];

        // Find communities containing any of the given entities
        const conditions = entityNames
            .map(() => "entities LIKE ?")
            .join(" OR ");
        const params = entityNames.map((name) => `%"${name}"%`);

        const stmt = this.db.prepare(`
            SELECT * FROM communities 
            WHERE ${conditions}
            ORDER BY size DESC
        `);
        return stmt.all(...params) as Community[];
    }

    public getAllCommunities(): Community[] {
        const stmt = this.db.prepare(`
            SELECT * FROM communities 
            ORDER BY size DESC
        `);
        return stmt.all() as Community[];
    }

    public clear(): void {
        const stmt = this.db.prepare(`DELETE FROM communities`);
        stmt.run();
    }
}

// Hierarchical topics table
export interface HierarchicalTopicRecord {
    url: string;
    domain: string;
    topicId: string;
    topicName: string;
    level: number;
    parentTopicId?: string;
    confidence: number;
    keywords?: string; // JSON array stored as string
    extractionDate: string;
}

export class HierarchicalTopicTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "hierarchicalTopics", [
            ["url", { type: "string" }],
            ["domain", { type: "string" }],
            ["topicId", { type: "string" }],
            ["topicName", { type: "string" }],
            ["level", { type: "number" }],
            ["parentTopicId", { type: "string", optional: true }],
            ["confidence", { type: "number" }],
            ["keywords", { type: "string", optional: true }],
            ["extractionDate", { type: "string" }],
        ]);
    }

    public getTopicsByLevel(level: number): HierarchicalTopicRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM hierarchicalTopics
            WHERE level = ?
            ORDER BY confidence DESC
        `);
        const results = stmt.all(level);
        return results as HierarchicalTopicRecord[];
    }

    public getChildTopics(parentTopicId: string): HierarchicalTopicRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM hierarchicalTopics
            WHERE parentTopicId = ?
            ORDER BY topicName
        `);
        const results = stmt.all(parentTopicId);
        return results as HierarchicalTopicRecord[];
    }

    public getTopicHierarchy(domain?: string): HierarchicalTopicRecord[] {
        const query = domain
            ? `SELECT * FROM hierarchicalTopics WHERE domain = ? ORDER BY level, topicName`
            : `SELECT * FROM hierarchicalTopics ORDER BY level, topicName`;
        const stmt = this.db.prepare(query);
        const results = domain ? stmt.all(domain) : stmt.all();
        return results as HierarchicalTopicRecord[];
    }

    public getRootTopics(domain?: string): HierarchicalTopicRecord[] {
        const query = domain
            ? `SELECT * FROM hierarchicalTopics WHERE level = 0 AND domain = ? ORDER BY confidence DESC`
            : `SELECT * FROM hierarchicalTopics WHERE level = 0 ORDER BY confidence DESC`;
        const stmt = this.db.prepare(query);
        const results = domain ? stmt.all(domain) : stmt.all();
        return results as HierarchicalTopicRecord[];
    }

    public getTopicById(topicId: string): HierarchicalTopicRecord | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM hierarchicalTopics
            WHERE topicId = ?
        `);
        return stmt.get(topicId) as HierarchicalTopicRecord | undefined;
    }

    public getChildByName(
        topicName: string,
        parentTopicId: string,
    ): HierarchicalTopicRecord | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM hierarchicalTopics
            WHERE topicName = ? AND parentTopicId = ?
            LIMIT 1
        `);
        return stmt.get(topicName, parentTopicId) as
            | HierarchicalTopicRecord
            | undefined;
    }

    public getTopicByName(
        topicName: string,
        level: number,
    ): HierarchicalTopicRecord | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM hierarchicalTopics
            WHERE topicName = ? AND level = ?
            LIMIT 1
        `);
        return stmt.get(topicName, level) as
            | HierarchicalTopicRecord
            | undefined;
    }

    public deleteTopicsByUrl(url: string): void {
        const stmt = this.db.prepare(
            `DELETE FROM hierarchicalTopics WHERE url = ?`,
        );
        stmt.run(url);
    }
}

// Topic-to-entity relationships table
export interface TopicEntityRelation {
    topicId: string;
    entityName: string;
    relevance: number;
    domain: string;
    [key: string]: any;
}

export class TopicEntityRelationTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "topicEntityRelations", [
            ["topicId", { type: "string" }],
            ["entityName", { type: "string" }],
            ["relevance", { type: "number" }],
            ["domain", { type: "string" }],
        ]);
    }

    public getEntitiesForTopic(topicId: string): TopicEntityRelation[] {
        const stmt = this.db.prepare(`
            SELECT * FROM topicEntityRelations
            WHERE topicId = ?
            ORDER BY relevance DESC
        `);
        return stmt.all(topicId) as TopicEntityRelation[];
    }

    public getTopicsForEntity(entityName: string): TopicEntityRelation[] {
        const stmt = this.db.prepare(`
            SELECT * FROM topicEntityRelations
            WHERE entityName = ?
            ORDER BY relevance DESC
        `);
        return stmt.all(entityName) as TopicEntityRelation[];
    }

    public addRelation(relation: TopicEntityRelation): void {
        this.addRows({
            sourceRef: {
                range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } },
            },
            record: relation,
        });
    }

    public deleteRelationsByTopic(topicId: string): void {
        const stmt = this.db.prepare(
            `DELETE FROM topicEntityRelations WHERE topicId = ?`,
        );
        stmt.run(topicId);
    }
}

// Topic relationships table
export interface TopicRelationship {
    fromTopic: string;
    toTopic: string;
    relationshipType: string;
    strength: number;
    metadata?: string;
    sourceUrls?: string;
    cooccurrenceCount?: number;
    firstSeen?: string;
    lastSeen?: string;
    updated: string;
}

export class TopicRelationshipTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        TopicRelationshipTable.ensureTable(db);

        super(
            db,
            "topicRelationships",
            [
                ["fromTopic", { type: "string" }],
                ["toTopic", { type: "string" }],
                ["relationshipType", { type: "string" }],
                ["strength", { type: "number" }],
                ["metadata", { type: "string", optional: true }],
                ["sourceUrls", { type: "string", optional: true }],
                ["cooccurrenceCount", { type: "number", optional: true }],
                ["firstSeen", { type: "string", optional: true }],
                ["lastSeen", { type: "string", optional: true }],
                ["updated", { type: "string" }],
            ],
            false,
        );
    }

    private static ensureTable(db: sqlite.Database): void {
        try {
            const tableInfo = db
                .prepare(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='topicRelationships'",
                )
                .get() as { sql?: string } | undefined;

            const needsRecreate =
                !tableInfo ||
                !tableInfo.sql?.includes(
                    "UNIQUE (fromTopic, toTopic, relationshipType)",
                );

            if (needsRecreate) {
                if (tableInfo) {
                    db.exec(`DROP TABLE IF EXISTS topicRelationships`);
                }

                db.exec(`
                    CREATE TABLE topicRelationships (
                        rowId INTEGER PRIMARY KEY AUTOINCREMENT,
                        sourceRef TEXT NOT NULL,
                        fromTopic TEXT NOT NULL,
                        toTopic TEXT NOT NULL,
                        relationshipType TEXT NOT NULL,
                        strength REAL NOT NULL,
                        metadata TEXT,
                        sourceUrls TEXT,
                        cooccurrenceCount INTEGER,
                        firstSeen TEXT,
                        lastSeen TEXT,
                        updated TEXT NOT NULL,
                        UNIQUE (fromTopic, toTopic, relationshipType)
                    )
                `);
            }
        } catch (error) {}
    }

    public getRelationshipsForTopic(topicId: string): TopicRelationship[] {
        const stmt = this.db.prepare(`
            SELECT * FROM topicRelationships
            WHERE fromTopic = ? OR toTopic = ?
            ORDER BY strength DESC
        `);
        return stmt.all(topicId, topicId) as TopicRelationship[];
    }

    public getStrongRelationships(
        topicId: string,
        minStrength: number = 0.7,
    ): TopicRelationship[] {
        const stmt = this.db.prepare(`
            SELECT * FROM topicRelationships
            WHERE (fromTopic = ? OR toTopic = ?) AND strength >= ?
            ORDER BY strength DESC
        `);
        return stmt.all(topicId, topicId, minStrength) as TopicRelationship[];
    }

    public upsertRelationship(relationship: TopicRelationship): void {
        const sourceRef = {
            range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } },
        };

        const stmt = this.db.prepare(`
            INSERT INTO topicRelationships
            (sourceRef, fromTopic, toTopic, relationshipType, strength, metadata, sourceUrls, cooccurrenceCount, firstSeen, lastSeen, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fromTopic, toTopic, relationshipType) DO UPDATE SET
                strength = excluded.strength,
                metadata = excluded.metadata,
                sourceUrls = excluded.sourceUrls,
                cooccurrenceCount = excluded.cooccurrenceCount,
                lastSeen = excluded.lastSeen,
                updated = excluded.updated
        `);
        stmt.run(
            JSON.stringify(sourceRef),
            relationship.fromTopic,
            relationship.toTopic,
            relationship.relationshipType,
            relationship.strength,
            relationship.metadata || null,
            relationship.sourceUrls || null,
            relationship.cooccurrenceCount || null,
            relationship.firstSeen || null,
            relationship.lastSeen || null,
            relationship.updated,
        );
    }

    public deleteRelationshipsByTopic(topicId: string): void {
        const stmt = this.db.prepare(
            `DELETE FROM topicRelationships WHERE fromTopic = ? OR toTopic = ?`,
        );
        stmt.run(topicId, topicId);
    }
}

// Topic metrics table
export interface TopicMetrics {
    topicId: string;
    topicName: string;
    documentCount: number;
    domainCount: number;
    degreeCentrality: number;
    betweennessCentrality: number;
    firstSeen?: string;
    lastSeen?: string;
    activityPeriod: number;
    avgConfidence: number;
    maxConfidence: number;
    totalRelationships: number;
    strongRelationships: number;
    entityCount: number;
    topEntities?: string;
    updated: string;
}

export class TopicMetricsTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        TopicMetricsTable.ensureTable(db);

        super(
            db,
            "topicMetrics",
            [
                ["topicId", { type: "string" }],
                ["topicName", { type: "string" }],
                ["documentCount", { type: "number" }],
                ["domainCount", { type: "number" }],
                ["degreeCentrality", { type: "number" }],
                ["betweennessCentrality", { type: "number" }],
                ["firstSeen", { type: "string", optional: true }],
                ["lastSeen", { type: "string", optional: true }],
                ["activityPeriod", { type: "number" }],
                ["avgConfidence", { type: "number" }],
                ["maxConfidence", { type: "number" }],
                ["totalRelationships", { type: "number" }],
                ["strongRelationships", { type: "number" }],
                ["entityCount", { type: "number" }],
                ["topEntities", { type: "string", optional: true }],
                ["updated", { type: "string" }],
            ],
            false,
        );
    }

    private static ensureTable(db: sqlite.Database): void {
        try {
            const tableInfo = db
                .prepare(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='topicMetrics'",
                )
                .get() as { sql?: string } | undefined;

            const needsRecreate =
                !tableInfo || !tableInfo.sql?.includes("UNIQUE (topicId)");

            if (needsRecreate) {
                if (tableInfo) {
                    db.exec(`DROP TABLE IF EXISTS topicMetrics`);
                }

                db.exec(`
                    CREATE TABLE topicMetrics (
                        rowId INTEGER PRIMARY KEY AUTOINCREMENT,
                        sourceRef TEXT NOT NULL,
                        topicId TEXT NOT NULL,
                        topicName TEXT NOT NULL,
                        documentCount INTEGER DEFAULT 0,
                        domainCount INTEGER DEFAULT 0,
                        degreeCentrality INTEGER DEFAULT 0,
                        betweennessCentrality REAL DEFAULT 0,
                        firstSeen TEXT,
                        lastSeen TEXT,
                        activityPeriod INTEGER DEFAULT 0,
                        avgConfidence REAL DEFAULT 0,
                        maxConfidence REAL DEFAULT 0,
                        totalRelationships INTEGER DEFAULT 0,
                        strongRelationships INTEGER DEFAULT 0,
                        entityCount INTEGER DEFAULT 0,
                        topEntities TEXT,
                        updated TEXT NOT NULL,
                        UNIQUE (topicId)
                    )
                `);
            }
        } catch (error) {}
    }

    public getMetrics(topicId: string): TopicMetrics | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM topicMetrics WHERE topicId = ?
        `);
        return stmt.get(topicId) as TopicMetrics | undefined;
    }

    public upsertMetrics(metrics: TopicMetrics): void {
        const sourceRef = {
            range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } },
        };

        const stmt = this.db.prepare(`
            INSERT INTO topicMetrics
            (sourceRef, topicId, topicName, documentCount, domainCount, degreeCentrality, betweennessCentrality,
             firstSeen, lastSeen, activityPeriod, avgConfidence, maxConfidence,
             totalRelationships, strongRelationships, entityCount, topEntities, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(topicId) DO UPDATE SET
                topicName = excluded.topicName,
                documentCount = excluded.documentCount,
                domainCount = excluded.domainCount,
                degreeCentrality = excluded.degreeCentrality,
                betweennessCentrality = excluded.betweennessCentrality,
                firstSeen = excluded.firstSeen,
                lastSeen = excluded.lastSeen,
                activityPeriod = excluded.activityPeriod,
                avgConfidence = excluded.avgConfidence,
                maxConfidence = excluded.maxConfidence,
                totalRelationships = excluded.totalRelationships,
                strongRelationships = excluded.strongRelationships,
                entityCount = excluded.entityCount,
                topEntities = excluded.topEntities,
                updated = excluded.updated
        `);
        stmt.run(
            JSON.stringify(sourceRef),
            metrics.topicId,
            metrics.topicName,
            metrics.documentCount,
            metrics.domainCount,
            metrics.degreeCentrality,
            metrics.betweennessCentrality,
            metrics.firstSeen || null,
            metrics.lastSeen || null,
            metrics.activityPeriod,
            metrics.avgConfidence,
            metrics.maxConfidence,
            metrics.totalRelationships,
            metrics.strongRelationships,
            metrics.entityCount,
            metrics.topEntities || null,
            metrics.updated,
        );
    }

    public getTopTopicsByImportance(limit: number = 20): TopicMetrics[] {
        const stmt = this.db.prepare(`
            SELECT * FROM topicMetrics
            ORDER BY documentCount DESC, degreeCentrality DESC, betweennessCentrality DESC
            LIMIT ?
        `);
        return stmt.all(limit) as TopicMetrics[];
    }

    public deleteMetrics(topicId: string): void {
        const stmt = this.db.prepare(
            `DELETE FROM topicMetrics WHERE topicId = ?`,
        );
        stmt.run(topicId);
    }
}
