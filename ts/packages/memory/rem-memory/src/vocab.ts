// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";

// REM RDF vocabulary. Canonical entities and reified relations live in the
// default graph; each observation's provenance lives in its own named graph.

/** Schema namespace for REM predicates/classes. */
export const REM = "https://typeagent.microsoft.com/rem#";

/** Instance namespaces. */
export const ENTITY_NS = "https://typeagent.microsoft.com/rem/entity/";
export const RELATION_NS = "https://typeagent.microsoft.com/rem/relation/";
export const OBSERVATION_NS =
    "https://typeagent.microsoft.com/rem/observation/";

/** Standard RDF/XSD IRIs used by REM. */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const XSD_DOUBLE = "http://www.w3.org/2001/XMLSchema#double";
export const XSD_LONG = "http://www.w3.org/2001/XMLSchema#long";
export const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** REM classes. */
export const CLASS_ENTITY = `${REM}Entity`;
export const CLASS_RELATION = `${REM}Relation`;
export const CLASS_OBSERVATION = `${REM}Observation`;

/** REM predicates. */
export const P_NAME = `${REM}name`;
export const P_ALIAS = `${REM}alias`;
export const P_ENTITY_TYPE = `${REM}entityType`;
export const P_FACET_NAME = `${REM}facetName`;
export const P_FACET_VALUE = `${REM}facetValue`;
export const P_FACET = `${REM}facet`;

export const P_SUBJECT = `${REM}subject`;
export const P_PREDICATE_LABEL = `${REM}predicateLabel`;
export const P_OBJECT = `${REM}object`;
export const P_STRENGTH = `${REM}strength`;

export const P_ASSERTS = `${REM}asserts`;
export const P_FEEDER = `${REM}feeder`;
export const P_TIER = `${REM}tier`;
export const P_TIMESTAMP = `${REM}timestamp`;
export const P_CONFIDENCE = `${REM}confidence`;
export const P_SOURCE = `${REM}source`;

/** Mint a new canonical entity IRI. */
export function mintEntityIri(): string {
    return `${ENTITY_NS}${randomUUID()}`;
}

/** Mint a new reified relation IRI. */
export function mintRelationIri(): string {
    return `${RELATION_NS}${randomUUID()}`;
}

/** Mint a new observation IRI (also used as the provenance named graph). */
export function mintObservationIri(): string {
    return `${OBSERVATION_NS}${randomUUID()}`;
}

/**
 * Stable, deterministic relation IRI for a (subject, predicate, object) triple
 * so the same fact reinforces one relation rather than spawning duplicates.
 */
export function relationKey(
    subjectId: string,
    predicate: string,
    objectId: string,
): string {
    const slug = encodeURIComponent(
        `${subjectId}|${predicate.toLowerCase()}|${objectId}`,
    );
    return `${RELATION_NS}${slug}`;
}
