import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

export interface Entity {
    name: string;
    type: string;
    sourceUrl: string;
    confidence: number;
    pageRank?: number;
    metadata?: any;
}

export interface Relationship {
    id: string;
    from: string;
    to: string;
    type: string;
    confidence: number;
    sourceUrl: string;
    bidirectional?: boolean;
}

export interface Topic {
    name: string;
    urls: string[];
    cooccurrenceCount: number;
}

export interface Message {
    text: string;
    metadata: {
        url: string;
        timestamp: string;
        messageType?: string;
        chunkIndex?: number;
    };
    embedding?: number[];
}

export class MockKnowledgeStore {
    private entities: Map<string, Entity> = new Map();
    private relationships: Relationship[] = [];
    private topics: Map<string, Topic> = new Map();
    private messages: Message[] = [];
    private entityNeighborhoods: Map<string, Set<string>> = new Map();

    constructor() {
        this.loadFixtures();
    }

    private loadFixtures(): void {
        try {
            const graphStructure = JSON.parse(
                readFileSync(
                    join(FIXTURES_DIR, "knowledge-graph/graph-structure.json"),
                    "utf-8",
                ),
            );

            for (const entity of graphStructure.entities) {
                this.entities.set(entity.name, entity);
            }

            this.relationships = graphStructure.relationships;

            for (const topic of graphStructure.topics) {
                this.topics.set(topic.name, topic);
            }

            this.buildEntityNeighborhoods();
        } catch (error) {
            console.warn("Could not load graph fixtures:", error);
        }
    }

    private buildEntityNeighborhoods(): void {
        for (const rel of this.relationships) {
            if (!this.entityNeighborhoods.has(rel.from)) {
                this.entityNeighborhoods.set(rel.from, new Set());
            }
            this.entityNeighborhoods.get(rel.from)!.add(rel.to);

            if (rel.bidirectional) {
                if (!this.entityNeighborhoods.has(rel.to)) {
                    this.entityNeighborhoods.set(rel.to, new Set());
                }
                this.entityNeighborhoods.get(rel.to)!.add(rel.from);
            }
        }
    }

    addEntity(entity: Entity): void {
        this.entities.set(entity.name, entity);
    }

    getEntity(name: string): Entity | undefined {
        return this.entities.get(name);
    }

    getAllEntities(): Entity[] {
        return Array.from(this.entities.values());
    }

    getEntitiesByType(type: string): Entity[] {
        return Array.from(this.entities.values()).filter(
            (e) => e.type === type,
        );
    }

    getEntitiesByUrl(url: string): Entity[] {
        return Array.from(this.entities.values()).filter(
            (e) => e.sourceUrl === url,
        );
    }

    addRelationship(relationship: Relationship): void {
        this.relationships.push(relationship);

        if (!this.entityNeighborhoods.has(relationship.from)) {
            this.entityNeighborhoods.set(relationship.from, new Set());
        }
        this.entityNeighborhoods.get(relationship.from)!.add(relationship.to);

        if (relationship.bidirectional) {
            if (!this.entityNeighborhoods.has(relationship.to)) {
                this.entityNeighborhoods.set(relationship.to, new Set());
            }
            this.entityNeighborhoods
                .get(relationship.to)!
                .add(relationship.from);
        }
    }

    getRelationships(entityName: string): Relationship[] {
        return this.relationships.filter(
            (r) => r.from === entityName || r.to === entityName,
        );
    }

    getEntityNeighbors(entityName: string): string[] {
        return Array.from(this.entityNeighborhoods.get(entityName) || []);
    }

    getEntityNeighborhood(
        entityName: string,
        depth: number,
        maxNodes: number = 50,
    ): {
        entities: Array<{
            name: string;
            type: string;
            distance: number;
            confidence: number;
        }>;
        relationships: Relationship[];
    } {
        const visited = new Set<string>();
        const queue: Array<{ name: string; distance: number }> = [
            { name: entityName, distance: 0 },
        ];
        const result: Array<{
            name: string;
            type: string;
            distance: number;
            confidence: number;
        }> = [];
        const relevantRelationships: Relationship[] = [];

        while (queue.length > 0 && result.length < maxNodes) {
            const current = queue.shift()!;

            if (visited.has(current.name)) {
                continue;
            }
            visited.add(current.name);

            const entity = this.entities.get(current.name);
            if (entity && current.distance > 0) {
                result.push({
                    name: entity.name,
                    type: entity.type,
                    distance: current.distance,
                    confidence: entity.confidence,
                });
            }

            if (current.distance < depth) {
                const neighbors = this.getEntityNeighbors(current.name);
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        queue.push({
                            name: neighbor,
                            distance: current.distance + 1,
                        });
                    }
                }

                const rels = this.getRelationships(current.name);
                relevantRelationships.push(...rels);
            }
        }

        return {
            entities: result,
            relationships: relevantRelationships,
        };
    }

    addTopic(topic: Topic): void {
        this.topics.set(topic.name, topic);
    }

    getTopic(name: string): Topic | undefined {
        return this.topics.get(name);
    }

    getAllTopics(): Topic[] {
        return Array.from(this.topics.values());
    }

    getTopicsByUrl(url: string): string[] {
        return Array.from(this.topics.values())
            .filter((t) => t.urls.includes(url))
            .map((t) => t.name);
    }

    getRelatedTopics(topicName: string, maxResults: number = 10): Topic[] {
        const sourceTopic = this.topics.get(topicName);
        if (!sourceTopic) {
            return [];
        }

        const relatedTopicsMap = new Map<string, number>();

        for (const url of sourceTopic.urls) {
            for (const [name, topic] of this.topics.entries()) {
                if (name !== topicName && topic.urls.includes(url)) {
                    relatedTopicsMap.set(
                        name,
                        (relatedTopicsMap.get(name) || 0) + 1,
                    );
                }
            }
        }

        return Array.from(relatedTopicsMap.entries())
            .map(([name, count]) => ({
                ...this.topics.get(name)!,
                cooccurrenceCount: count,
            }))
            .sort((a, b) => b.cooccurrenceCount - a.cooccurrenceCount)
            .slice(0, maxResults);
    }

    addMessage(message: Message): void {
        this.messages.push(message);
    }

    getMessages(): Message[] {
        return this.messages;
    }

    getMessagesByUrl(url: string): Message[] {
        return this.messages.filter((m) => m.metadata.url === url);
    }

    clear(): void {
        this.entities.clear();
        this.relationships = [];
        this.topics.clear();
        this.messages = [];
        this.entityNeighborhoods.clear();
    }

    reset(): void {
        this.clear();
        this.loadFixtures();
    }

    createMockWebsiteCollection(): any {
        return {
            entities: {
                getAll: () => this.getAllEntities(),
                filter: (predicate: (e: Entity) => boolean) =>
                    this.getAllEntities().filter(predicate),
            },
            relationships: {
                getAll: () => this.relationships,
            },
            topics: this.topics,
            knowledgeTopics: {
                getRelatedTopics: (name: string, max: number) =>
                    this.getRelatedTopics(name, max),
            },
            messages: {
                getAll: () => this.getMessages(),
                filter: (url: string) => this.getMessagesByUrl(url),
            },
        };
    }
}
