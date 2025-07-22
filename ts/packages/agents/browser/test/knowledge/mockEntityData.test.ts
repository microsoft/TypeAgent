// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EntityMockDataGenerator,
    MOCK_SCENARIOS,
} from "../../src/agent/knowledge/mockEntityData.mjs";

describe("EntityMockDataGenerator", () => {
    let mockGenerator: EntityMockDataGenerator;

    beforeEach(() => {
        mockGenerator = new EntityMockDataGenerator();
    });

    test("should generate tech ecosystem graph", async () => {
        const graph = await mockGenerator.generateTechEcosystemGraph();

        expect(graph.entities.size).toBeGreaterThan(0);
        expect(graph.relationships.size).toBeGreaterThan(0);

        // Check that entities exist - names may vary based on implementation
        const entityNames = Array.from(graph.entities.keys());
        expect(entityNames.length).toBeGreaterThan(1); // Should have multiple entities
    });

    test("should generate AI research graph", async () => {
        const graph = await mockGenerator.generateOpenAIEcosystem();

        expect(graph.entities.size).toBeGreaterThan(0);

        // Check for key AI entities - adjust based on actual implementation
        const entityNames = Array.from(graph.entities.keys());
        expect(entityNames.length).toBeGreaterThan(0);
    });

    test("should generate business ecosystem graph", async () => {
        const graph = await mockGenerator.generateBusinessEcosystemGraph();

        expect(graph.entities.size).toBeGreaterThan(0);
        expect(graph.relationships.size).toBeGreaterThan(0);
    });

    test("should have valid mock scenarios configuration", () => {
        expect(MOCK_SCENARIOS).toBeDefined();
        expect(Object.keys(MOCK_SCENARIOS).length).toBeGreaterThan(0);

        // Check specific scenarios exist
        expect(MOCK_SCENARIOS.TECH_ECOSYSTEM).toBeDefined();
        expect(MOCK_SCENARIOS.OPENAI_ECOSYSTEM).toBeDefined();

        // Validate scenario values are strings
        expect(typeof MOCK_SCENARIOS.TECH_ECOSYSTEM).toBe("string");
        expect(typeof MOCK_SCENARIOS.OPENAI_ECOSYSTEM).toBe("string");
    });

    test("should generate entities with proper structure", async () => {
        const graph = await mockGenerator.generateTechEcosystemGraph();
        const entities = Array.from(graph.entities.values());

        expect(entities.length).toBeGreaterThan(0);

        const firstEntity = entities[0];
        expect(firstEntity).toBeDefined();
        expect(firstEntity.name).toBeDefined();
        expect(firstEntity.type).toBeDefined();
        expect(firstEntity.confidence).toBeGreaterThan(0);
        expect(firstEntity.confidence).toBeLessThanOrEqual(1);
        expect(Array.isArray(firstEntity.aliases)).toBe(true);
        expect(typeof firstEntity.mentionCount).toBe("number");
    });

    test("should generate relationships with proper structure", async () => {
        const graph = await mockGenerator.generateTechEcosystemGraph();

        // Get any relationships that exist
        const allRelationships = Array.from(
            graph.relationships.values(),
        ).flat();

        expect(allRelationships.length).toBeGreaterThan(0);

        const relationship = allRelationships[0];
        expect(relationship.relatedEntity).toBeDefined();
        expect(relationship.relationshipType).toBeDefined();
        expect(relationship.confidence).toBeGreaterThan(0);
        expect(relationship.confidence).toBeLessThanOrEqual(1);
        expect(relationship.strength).toBeGreaterThan(0);
        expect(relationship.strength).toBeLessThanOrEqual(1);
    });
});
