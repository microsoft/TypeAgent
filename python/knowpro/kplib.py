# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO:
# - What does the comment "Very concise values" in class Facet mean?
# - Do the protocols need to be @runtime_checkable?
# - Should the field names be camelCase to match the JSON schema?
# - For things of type float, should we add `| int` to emphasize that int is okay?
# - How to allow totally missing attributes? (facets, params, subject_entity_facet)
# - Should we use ABC instead of Protocol for certain classes?

from typing import Literal, Protocol, runtime_checkable


@runtime_checkable
class Quantity(Protocol):
    amount: float
    units: str


type Value = str | float | bool | Quantity


@runtime_checkable
class Facet(Protocol):
    name: str
    # Very concise values.
    value: Value


# Specific, tangible people, places, institutions or things only
@runtime_checkable
class ConcreteEntity(Protocol):
    # The name of the entity or thing such as "Bach", "Great Gatsby",
    # "frog" or "piano".
    name: str
    # The types of the entity such as "speaker", "person", "artist", "animal",
    # "object", "instrument", "school", "room", "museum", "food" etc.
    # An entity can have multiple types; entity types should be single words.
    type: list[str]
    # A specific, inherent, defining, or non-immediate facet of the entity
    # such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg".
    # Trivial actions or state changes are not facets.
    # Facets are concise "properties".
    facets: list[Facet] | None = None


@runtime_checkable
class ActionParam(Protocol):
    name: str
    value: Value


type VerbTense = Literal["past", "present", "future"]


@runtime_checkable
class Action(Protocol):
    # Each verb is typically a word.
    verb: list[str]
    verb_tense: VerbTense
    subject_entity_name: str | Literal["none"]
    object_entity_name: str | Literal["none"]
    indirect_object_entity_name: str | Literal["none"]
    params: list[str | ActionParam] | None = None
    # If the action implies this additional facet or property of the
    # subject entity, such as hobbies, activities, interests, personality.
    subject_entity_facet: Facet | None = None


# Detailed and comprehensive knowledge response.
@runtime_checkable
class KnowledgeResponse(Protocol):
    entities: list[ConcreteEntity]
    # The 'subject_entity_name' and 'object_entity_name' must correspond
    # to the 'name' of an entity listed in the 'entities' array.
    actions: list[Action]
    # Some actions can ALSO be expressed in a reverse way...
    # E.g. (A give to B) --> (B receive from A) and vice versa.
    # If so, also return the reverse form of the action, full filled out.
    inverse_actions: list[Action]
    # Detailed, descriptive topics and keywords.
    topics: list[str]
