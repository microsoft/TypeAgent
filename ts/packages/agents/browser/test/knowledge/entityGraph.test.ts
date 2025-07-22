// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EntityGraphManager,
    EnhancedEntity,
    EntityType,
    EntityRelationship,
    EntityKnowledgeGraph,
} from "../../src/agent/knowledge/entityGraph.mjs";

describe("EntityGraphManager", () => {
    let graphManager: EntityGraphManager;

    beforeEach(async () => {
        graphManager = new EntityGraphManager();
        await graphManager.initialize();
        graphManager.clear();
    });

    test("should initialize and create empty graph", async () => {
        const graph = graphManager.getGraph();
        expect(graph.entities.size).toBe(0);
        expect(graph.relationships.size).toBe(0);
    });

    test("should add entities to graph", () => {
        const entity: EnhancedEntity = {
            name: "Test Entity",
            type: "organization" as EntityType,
            confidence: 0.9,
            aliases: ["Test Corp"],
            mentionCount: 50,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: ["technology"],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: ["Test context"],
            topicAffinity: ["AI", "Technology"],
        };

        graphManager.addEntity(entity);
        const graph = graphManager.getGraph();

        expect(graph.entities.size).toBe(1);
        expect(graph.entities.get("Test Entity")).toEqual(entity);
    });

    test("should add relationships between entities", () => {
        // Add two entities first
        const entity1: EnhancedEntity = {
            name: "Entity 1",
            type: "person" as EntityType,
            confidence: 0.9,
            aliases: [],
            mentionCount: 10,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: [],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [],
            topicAffinity: [],
        };

        const entity2: EnhancedEntity = {
            name: "Entity 2",
            type: "organization" as EntityType,
            confidence: 0.8,
            aliases: [],
            mentionCount: 20,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: [],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [],
            topicAffinity: [],
        };

        graphManager.addEntity(entity1);
        graphManager.addEntity(entity2);

        const relationship: EntityRelationship = {
            relatedEntity: "Entity 2",
            relationshipType: "works_at",
            confidence: 0.9,
            evidenceSources: ["test source"],
            firstObserved: "2024-01-01",
            lastObserved: "2024-12-31",
            strength: 0.9,
        };

        graphManager.addRelationship("Entity 1", "Entity 2", relationship);

        const graph = graphManager.getGraph();
        const relationships = graph.relationships.get("Entity 1");

        expect(relationships).toBeDefined();
        expect(relationships!.length).toBeGreaterThanOrEqual(1);
        if (relationships && relationships.length > 0 && relationships[0]) {
            expect(relationships[0].relatedEntity).toBe("Entity 2");
            expect(relationships[0].relationshipType).toBe("works_at");
        } else {
            // Log debug info if the test is failing
            console.log("Debug: relationships:", relationships);
            console.log(
                "Debug: graph:",
                JSON.stringify(graphManager.getGraph(), null, 2),
            );
        }
    });

    test("should find entities by type", () => {
        const personEntity: EnhancedEntity = {
            name: "John Doe",
            type: "person" as EntityType,
            confidence: 0.9,
            aliases: [],
            mentionCount: 10,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: [],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [],
            topicAffinity: [],
        };

        const orgEntity: EnhancedEntity = {
            name: "Tech Corp",
            type: "organization" as EntityType,
            confidence: 0.8,
            aliases: [],
            mentionCount: 20,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: [],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [],
            topicAffinity: [],
        };

        graphManager.addEntity(personEntity);
        graphManager.addEntity(orgEntity);

        const persons = graphManager.getEntitiesByType("person");
        const organizations = graphManager.getEntitiesByType("organization");

        expect(persons.length).toBe(1);
        expect(persons[0].name).toBe("John Doe");
        expect(organizations.length).toBe(1);
        expect(organizations[0].name).toBe("Tech Corp");
    });

    test("should get entity relationships", () => {
        const entity: EnhancedEntity = {
            name: "Test Entity",
            type: "person" as EntityType,
            confidence: 0.9,
            aliases: [],
            mentionCount: 10,
            firstSeen: "2024-01-01",
            lastSeen: "2024-12-31",
            dominantDomains: [],
            strongRelationships: [],
            coOccurringEntities: [],
            contextSnippets: [],
            topicAffinity: [],
        };

        graphManager.addEntity(entity);

        const relationship: EntityRelationship = {
            relatedEntity: "Related Entity",
            relationshipType: "colleague_of",
            confidence: 0.8,
            evidenceSources: ["source1"],
            firstObserved: "2024-01-01",
            lastObserved: "2024-12-31",
            strength: 0.8,
        };

        graphManager.addRelationship(
            "Test Entity",
            "Related Entity",
            relationship,
        );

        const relationships =
            graphManager.getEntityRelationships("Test Entity");

        expect(relationships.length).toBe(1);
        expect(relationships[0].relatedEntity).toBe("Related Entity");
        expect(relationships[0].relationshipType).toBe("colleague_of");
    });
});
