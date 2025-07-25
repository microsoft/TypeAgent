# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""This file defines the data types generated by knowledge extraction.

It also doubles as the schema for the extraction process.
Comments that should go into the schema are in docstrings and Doc() annotations.
"""

from pydantic.dataclasses import dataclass
from typing import Annotated, Literal
from typing_extensions import Doc


@dataclass
class Quantity:
    amount: float
    units: str

    def __str__(self) -> str:
        return f"{self.amount:g} {self.units}"


type Value = str | float | bool | Quantity


@dataclass
class Facet:
    name: str
    value: Annotated[Value, Doc("Very concise values.")]

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.name!r}, {self.value!r})"


@dataclass
class ConcreteEntity:
    """Specific, tangible people, places, institutions or things only."""

    name: Annotated[
        str,
        Doc(
            "The name of the entity or thing such as 'Bach', 'Great Gatsby', "
            + "'frog' or 'piano'."
        ),
    ]
    type: Annotated[
        list[str],
        Doc(
            "The types of the entity such as 'speaker', 'person', 'artist', "
            + "'animal', 'object', 'instrument', 'school', 'room', 'museum', 'food' etc. "
            + "An entity can have multiple types; entity types should be single words."
        ),
    ]
    facets: (
        Annotated[
            list[Facet],
            Doc(
                "A specific, inherent, defining, or non-immediate facet of the entity "
                + "such as 'blue', 'old', 'famous', 'sister', 'aunt_of', 'weight: 4 kg'. "
                + "Trivial actions or state changes are not facets. "
                + "Facets are concise 'properties'."
            ),
        ]
        | None
    ) = None

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.name!r}, {self.type}, {self.facets})"


@dataclass
class ActionParam:
    name: str
    value: Value


type VerbTense = Literal["past", "present", "future"]


@dataclass
class Action:
    verbs: Annotated[list[str], Doc("Each verb is typically a word.")]
    verb_tense: VerbTense
    subject_entity_name: str | Literal["none"] = "none"
    object_entity_name: str | Literal["none"] = "none"
    indirect_object_entity_name: str | Literal["none"] = "none"
    params: list[str | ActionParam] | None = None
    subject_entity_facet: (
        Annotated[
            Facet,
            Doc(
                "If the action implies this additional facet or property of the subject entity, "
                + "such as hobbies, activities, interests, personality."
            ),
        ]
        | None
    ) = None


@dataclass
class KnowledgeResponse:
    """Detailed and comprehensive knowledge response."""

    entities: list[ConcreteEntity]
    actions: Annotated[
        list[Action],
        Doc(
            "The 'subject_entity_name' and 'object_entity_name' must correspond "
            + "to the 'name' of an entity listed in the 'entities' array."
        ),
    ]
    inverse_actions: Annotated[
        list[Action],
        Doc(
            "Some actions can ALSO be expressed in a reverse way... "
            + "E.g. (A give to B) --> (B receive from A) and vice versa. "
            + "If so, also return the reverse form of the action, full filled out."
        ),
    ]
    topics: Annotated[list[str], Doc("Detailed, descriptive topics and keywords.")]
