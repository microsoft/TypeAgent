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


@runtime_checkable
class ConcreteEntity(Protocol):
    """Specific, tangible people, places, institutions or things only."""

    # the name of the entity or thing such as "Bach", "Great Gatsby",
    # "frog" or "piano".
    name: str
    # the types of the entity such as "speaker", "person", "artist", "animal",
    # "object", "instrument", "school", "room", "museum", "food" etc.
    # An entity can have multiple types; entity types should be single words.
    type: list[str]
    # A specific, inherent, defining, or non-immediate facet of the entity
    # such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg".
    # Trivial actions or state changes are not facets.
    # Facets are concise "properties".
    facets: list[Facet] | None


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
    params: list[str | ActionParam] | None
    # If the action implies this additional facet or property of the subject entity,
    # such as hobbies, activities, interests, personality.
    subject_entity_facet: Facet | None


@runtime_checkable
class KnowledgeResponse(Protocol):
    """Detailed and comprehensive knowledge response."""

    # The 'subjectEntityName' and 'objectEntityName' must correspond to the
    # 'name' of an entity listed in the 'entities' array.
    entities: list[ConcreteEntity]
    actions: list[Action]
    # Some actions can ALSO be expressed in a reverse way...
    # e.g. (A give to B) --> (B receive from A) and vice versa.
    # If so, also return the reverse form of the action, full filled out.
    inverse_actions: list[Action]
    # Detailed, descriptive topics and keywords.
    topics: list[str]
