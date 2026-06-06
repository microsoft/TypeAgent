// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity, Observation, Relation, trustTierRank } from "./model.js";
import { iri, literal, RdfStore } from "./rdfStore.js";
import { EntityResolver } from "./resolver.js";
import { SignalStore } from "./signalStore.js";
import { Feeder, FeederInput } from "./feeder.js";
import { Recall, RecallOptions } from "./recall.js";
import {
    CLASS_ENTITY,
    CLASS_OBSERVATION,
    CLASS_RELATION,
    mintObservationIri,
    P_ALIAS,
    P_ASSERTS,
    P_CONFIDENCE,
    P_ENTITY_TYPE,
    P_FACET,
    P_FACET_NAME,
    P_FACET_VALUE,
    P_FEEDER,
    P_NAME,
    P_OBJECT,
    P_PREDICATE_LABEL,
    P_SOURCE,
    P_STRENGTH,
    P_SUBJECT,
    P_TIER,
    P_TIMESTAMP,
    RDF_TYPE,
    relationKey,
    XSD_DOUBLE,
    XSD_LONG,
} from "./vocab.js";

// Ingestion: turn an observation into durable memory. Entities and relations
// are written to the RDF default graph *eagerly* (immediately visible to
// recall); the decaying signal is seeded/reinforced in SQLite; and the full
// provenance is written into a per-observation named graph.

/** Summary of what a single ingest produced. */
export type IngestResult = {
    observationId: string;
    entities: Entity[];
    relations: Relation[];
};

/** Facets get their own addressable node under the owning entity. */
function facetIri(entityId: string, facetName: string): string {
    return `${entityId}/facet/${encodeURIComponent(facetName.toLowerCase())}`;
}

export class RemMemory {
    private readonly recaller: Recall;

    constructor(
        private readonly rdf: RdfStore,
        private readonly signals: SignalStore,
        private readonly resolver: EntityResolver,
    ) {
        this.recaller = new Recall(rdf, signals, resolver);
    }

    /** Retrieve and rank relations relevant to a query. */
    recall(query: string, options?: RecallOptions) {
        return this.recaller.recall(query, options);
    }

    /** Run a feeder over input and ingest everything it produces. */
    async ingestFrom(
        feeder: Feeder,
        input: FeederInput,
    ): Promise<IngestResult[]> {
        const observations = await feeder.produce(input);
        const results: IngestResult[] = [];
        for (const observation of observations) {
            results.push(await this.ingestObservation(observation));
        }
        return results;
    }

    /** Ingest a single observation. */
    async ingestObservation(observation: Observation): Promise<IngestResult> {
        const observationId = mintObservationIri();

        // 1. Resolve and eagerly persist canonical entities.
        const nameToId = new Map<string, string>();
        const entities: Entity[] = [];
        for (const observed of observation.entities) {
            const { entity } = await this.resolver.resolve(observed);
            this.writeEntity(entity);
            nameToId.set(observed.name, entity.id);
            entities.push(entity);
        }

        // Provenance evidence weight scales with trust tier.
        const evidence = trustTierRank(observation.tier) + 1;

        // 2. Persist relations + reinforce decay signal + write provenance.
        const relations: Relation[] = [];
        for (const observed of observation.relations) {
            const subjectId = nameToId.get(observed.subject);
            const objectId = nameToId.get(observed.object);
            if (subjectId === undefined || objectId === undefined) {
                continue;
            }
            const relationId = relationKey(
                subjectId,
                observed.predicate,
                objectId,
            );
            const relation: Relation = {
                id: relationId,
                subjectId,
                predicate: observed.predicate,
                objectId,
            };
            this.writeRelation(relation);

            const weight = this.signals.reinforce(
                relationId,
                observation.timestamp,
                evidence,
            );
            this.setStrength(relationId, weight);
            this.writeProvenance(observationId, relation);
            relations.push(relation);
        }

        // Observation-level provenance metadata.
        this.writeObservationMeta(observationId, observation);

        return { observationId, entities, relations };
    }

    private writeEntity(entity: Entity): void {
        this.rdf.addQuad(entity.id, RDF_TYPE, iri(CLASS_ENTITY));
        this.rdf.addQuad(entity.id, P_NAME, literal(entity.name));
        for (const alias of entity.aliases) {
            this.rdf.addQuad(entity.id, P_ALIAS, literal(alias));
        }
        for (const type of entity.types) {
            this.rdf.addQuad(entity.id, P_ENTITY_TYPE, literal(type));
        }
        for (const facet of entity.facets) {
            const fIri = facetIri(entity.id, facet.name);
            this.rdf.addQuad(entity.id, P_FACET, iri(fIri));
            this.rdf.addQuad(fIri, P_FACET_NAME, literal(facet.name));
            this.rdf.addQuad(fIri, P_FACET_VALUE, literal(String(facet.value)));
        }
    }

    private writeRelation(relation: Relation): void {
        this.rdf.addQuad(relation.id, RDF_TYPE, iri(CLASS_RELATION));
        this.rdf.addQuad(relation.id, P_SUBJECT, iri(relation.subjectId));
        this.rdf.addQuad(
            relation.id,
            P_PREDICATE_LABEL,
            literal(relation.predicate),
        );
        this.rdf.addQuad(relation.id, P_OBJECT, iri(relation.objectId));
    }

    /** Replace the provisional strength snapshot for a relation. */
    private setStrength(relationId: string, weight: number): void {
        this.rdf.update(
            `DELETE WHERE { <${relationId}> <${P_STRENGTH}> ?s } ;` +
                `INSERT DATA { <${relationId}> <${P_STRENGTH}> ` +
                `"${weight}"^^<${XSD_DOUBLE}> }`,
        );
    }

    private writeProvenance(observationId: string, relation: Relation): void {
        this.rdf.addQuad(
            observationId,
            P_ASSERTS,
            iri(relation.id),
            observationId,
        );
    }

    private writeObservationMeta(
        observationId: string,
        observation: Observation,
    ): void {
        const g = observationId;
        this.rdf.addQuad(observationId, RDF_TYPE, iri(CLASS_OBSERVATION), g);
        this.rdf.addQuad(
            observationId,
            P_FEEDER,
            literal(observation.feeder),
            g,
        );
        this.rdf.addQuad(observationId, P_TIER, literal(observation.tier), g);
        this.rdf.addQuad(
            observationId,
            P_TIMESTAMP,
            {
                kind: "literal",
                value: String(observation.timestamp),
                datatype: XSD_LONG,
            },
            g,
        );
        if (observation.source !== undefined) {
            this.rdf.addQuad(
                observationId,
                P_SOURCE,
                literal(observation.source),
                g,
            );
        }
        if (observation.confidence !== undefined) {
            this.rdf.addQuad(
                observationId,
                P_CONFIDENCE,
                {
                    kind: "literal",
                    value: String(observation.confidence),
                    datatype: XSD_DOUBLE,
                },
                g,
            );
        }
    }
}
