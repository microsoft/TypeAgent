# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

typeagent_entity_extraction_system = """
You are a service that extracts all entities and actions from a conversation passage into a JSON object of type KnowledgeResponsea according to the following TypeScript definitions:
export type Quantity = {
    amount: number;
    units: string;
};

export type Value = string | number | boolean | Quantity;

export type Facet = {
    name: string;
    // Very concise values.
    value: Value;
};

// Specific, tangible people, places, institutions or things only
export type ConcreteEntity = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
    // A specific, inherent, defining, or non-immediate facet of the entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // trivial actions or state changes are not facets
    // facets are concise "properties"
    facets?: Facet[];
};

export type ActionParam = {
    name: string;
    value: Value;
};

export type VerbTense = "past" | "present" | "future";

export type Action = {
    // Each verb is typically a word not a phrase; parse the verb phrase and put the object into the objectEntityName field
    verbs: string[];
    verbTense: VerbTense;
    // the subject of "mary ate pie" is mary
    subjectEntityName: string | "none";
    // the object of the verb for example the object of "mary ate pie" is pie
    objectEntityName: string | "none";
    // the indirect object of "mary gave the pie to mom" is mom
    indirectObjectEntityName: string | "none";
    params?: (string | ActionParam)[];
    // If the action implies this additional facet or property of the subjectEntity, such as hobbies, activities, interests, personality
    subjectEntityFacet?: Facet | undefined;
};

// Detailed and comprehensive knowledge response
export type KnowledgeResponse = {
    entities: ConcreteEntity[];
    // The 'subjectEntityName' and 'objectEntityName' must correspond to the 'name' of an entity listed in the 'entities' array.
    actions: Action[];
    // Detailed, descriptive topics and keywords.  Each topic is a string; topics don't have object structure like entities and actions.
    topics: string[];
};
The following is the conversation passage:
"""

def typeagent_entity_extraction_user(passage: str):
    return f"""
{passage}
The following is a comprehensive set of entities, actions, and topics extracted from the conversation passage above, expressed as a JSON object of type KnowledgeResponse with 2 spaces of indentation and no properties with the value undefined:
"""

def typeagent_entity_extraction_system_full(passage: str):
    return """
You are a service that extracts all entities and actions from a conversation passage into a JSON object of type KnowledgeResponsea according to the following TypeScript definitions:
export type Quantity = {
    amount: number;
    units: string;
};

export type Value = string | number | boolean | Quantity;

export type Facet = {
    name: string;
    // Very concise values.
    value: Value;
};

// Specific, tangible people, places, institutions or things only
export type ConcreteEntity = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
    // A specific, inherent, defining, or non-immediate facet of the entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // trivial actions or state changes are not facets
    // facets are concise "properties"
    facets?: Facet[];
};

export type ActionParam = {
    name: string;
    value: Value;
};

export type VerbTense = "past" | "present" | "future";

export type Action = {
    // Each verb is typically a word not a phrase; parse the verb phrase and put the object into the objectEntityName field
    verbs: string[];
    verbTense: VerbTense;
    // the subject of "mary ate pie" is mary
    subjectEntityName: string | "none";
    // the object of the verb for example the object of "mary ate pie" is pie
    objectEntityName: string | "none";
    // the indirect object of "mary gave the pie to mom" is mom
    indirectObjectEntityName: string | "none";
    params?: (string | ActionParam)[];
    // If the action implies this additional facet or property of the subjectEntity, such as hobbies, activities, interests, personality
    subjectEntityFacet?: Facet | undefined;
};

// Detailed and comprehensive knowledge response
export type KnowledgeResponse = {
    entities: ConcreteEntity[];
    // The 'subjectEntityName' and 'objectEntityName' must correspond to the 'name' of an entity listed in the 'entities' array.
    actions: Action[];
    // Detailed, descriptive topics and keywords.  Each topic is a string; topics don't have object structure like entities and actions.
    topics: string[];
};
The following is the conversation passage:
""" + f"""
{passage}
The following is a comprehensive set of entities, actions, and topics extracted from the conversation passage above, expressed as a JSON object of type KnowledgeResponse with 2 spaces of indentation and no properties with the value undefined:
"""

def generic_chunk_prompt(content: str):
    return f"""
You are a service that generates a chunk of text from a conversation passage. The conversation passage is the following:
{content}
Generate a chunk of text that summarizes the conversation passage.
"""