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

        KnowledgeEntityTable.ensureIndexes(db);
    }

    private static ensureIndexes(db: sqlite.Database): void {
        try {
            // Add performance indexes for entity queries
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_entities_name ON knowledgeEntities(entityName)`,
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_entities_type ON knowledgeEntities(entityType)`,
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_entities_confidence ON knowledgeEntities(confidence DESC)`,
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_entities_domain ON knowledgeEntities(domain)`,
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_entities_name_confidence ON knowledgeEntities(entityName, confidence DESC)`,
            );
        } catch (error) {
            console.warn("Failed to create entity indexes:", error);
        }
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
            WHERE entityName != '' AND entityName IS NOT NULL
            GROUP BY entityName 
            ORDER BY count DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as Array<{ entityName: string; count: number }>;
    }

    /**
     * Batch method to get entities by multiple names at once
     * Reduces N queries to 1 for entity lookups
     */
    public getEntitiesByNames(entityNames: string[]): KnowledgeEntity[] {
        if (entityNames.length === 0) return [];

        // Filter out empty strings from input
        const validEntityNames = entityNames.filter(
            (name) => name && name.trim() !== "",
        );
        if (validEntityNames.length === 0) return [];

        const placeholders = validEntityNames.map(() => "?").join(",");
        const stmt = this.db.prepare(`
            SELECT * FROM knowledgeEntities 
            WHERE entityName IN (${placeholders})
            AND entityName != '' AND entityName IS NOT NULL
            ORDER BY confidence DESC
        `);
        return stmt.all(...validEntityNames) as KnowledgeEntity[];
    }

    /**
     * Batch method to get top entities by names with aggregated counts
     * Useful for entity metrics calculations
     */
    public getEntityCounts(
        entityNames: string[],
    ): Array<{ entityName: string; count: number; avgConfidence: number }> {
        if (entityNames.length === 0) return [];

        // Filter out empty strings from input
        const validEntityNames = entityNames.filter(
            (name) => name && name.trim() !== "",
        );
        if (validEntityNames.length === 0) return [];

        const placeholders = validEntityNames.map(() => "?").join(",");
        const stmt = this.db.prepare(`
            SELECT entityName, COUNT(*) as count, AVG(confidence) as avgConfidence
            FROM knowledgeEntities 
            WHERE entityName IN (${placeholders})
            AND entityName != '' AND entityName IS NOT NULL
            GROUP BY entityName 
            ORDER BY count DESC
        `);
        return stmt.all(...validEntityNames) as Array<{
            entityName: string;
            count: number;
            avgConfidence: number;
        }>;
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

    public getUniqueEntityCount(): number {
        const stmt = this.db.prepare(`
            SELECT COUNT(DISTINCT entityName) as count
            FROM knowledgeEntities
            WHERE entityName != '' AND entityName IS NOT NULL
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

    /**
     * Batch method to get entities for multiple topics at once
     * This dramatically reduces database queries from N to 1
     */
    public getEntitiesForTopics(topicIds: string[]): TopicEntityRelation[] {
        if (topicIds.length === 0) return [];

        // Create placeholders for the IN clause
        const placeholders = topicIds.map(() => "?").join(",");

        const stmt = this.db.prepare(`
            SELECT * FROM topicEntityRelations
            WHERE topicId IN (${placeholders})
            ORDER BY topicId, relevance DESC
        `);

        return stmt.all(...topicIds) as TopicEntityRelation[];
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

/**
 * Cleanup function to drop deprecated SQLite tables and their indexes from existing databases.
 * These tables were used for graph storage but are now replaced with Graphology.
 * Call this function after database initialization to clean up legacy data.
 */
export function dropDeprecatedTables(db: sqlite.Database): void {
    try {
        console.log("[dropDeprecatedTables] Cleaning up deprecated SQLite tables...");

        // Drop deprecated tables in order (relationships first to avoid foreign key issues)
        const deprecatedTables = [
            "relationships",
            "communities", 
            "hierarchicalTopics",
            "topicRelationships",
            "topicMetrics"
        ];

        for (const tableName of deprecatedTables) {
            try {
                // Check if table exists before dropping
                const tableExists = db
                    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
                    .get(tableName);
                
                if (tableExists) {
                    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
                    console.log(`[dropDeprecatedTables] Dropped table: ${tableName}`);
                }
            } catch (error) {
                console.warn(`[dropDeprecatedTables] Warning dropping table ${tableName}:`, error);
            }
        }

        // Drop associated indexes that may still exist
        const deprecatedIndexes = [
            "idx_relationships_from",
            "idx_relationships_to", 
            "idx_relationships_strength",
            "idx_relationships_from_strength",
            "idx_relationships_to_strength",
            "idx_topicrels_fromtopic",
            "idx_topicrels_totopic",
            "idx_topicrels_strength", 
            "idx_topicrels_from_strength",
            "idx_topicrels_to_strength"
        ];

        for (const indexName of deprecatedIndexes) {
            try {
                const indexExists = db
                    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
                    .get(indexName);
                
                if (indexExists) {
                    db.exec(`DROP INDEX IF EXISTS ${indexName}`);
                    console.log(`[dropDeprecatedTables] Dropped index: ${indexName}`);
                }
            } catch (error) {
                console.warn(`[dropDeprecatedTables] Warning dropping index ${indexName}:`, error);
            }
        }

        console.log("[dropDeprecatedTables] Cleanup complete. Graph storage now uses pure Graphology.");
    } catch (error) {
        console.error("[dropDeprecatedTables] Error during cleanup:", error);
    }
}




