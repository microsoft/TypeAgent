# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO: Move this file into knowpro.

from pydantic.dataclasses import dataclass
from pydantic import Field, AliasChoices
from typing import Literal

from .field_helpers import CamelCaseField
from .date_time_schema import DateTimeRange


@dataclass
class FacetTerm:
    facet_name: str = Field(
        description=(
            "The name of the facet, such as 'color', 'profession', 'patent number'; "
            "'*' means match any facet name."
        )
    )
    facet_value: str = Field(
        description=(
            "The value of the facet, such as 'red', 'writer'; "
            "'*' means match any facet value."
        )
    )


@dataclass
class EntityTerm:
    """
    Use to find information about specific, tangible people, places, institutions or things only.
    This includes entities with particular facets.
    Abstract concepts or topics are not entityTerms. Use string for them.
    Any terms will match fuzzily.
    """

    name: str = Field(
        description=(
            "The name of the entity or thing such as 'Bach', 'Great Gatsby', 'frog' or 'piano' or 'we', 'I'; "
            "'*' means match any entity name."
        )
    )
    is_name_pronoun: bool | None = None
    type: list[str] | None = Field(
        default=None,
        description=(
            "The specific types of the entity such as 'book', 'movie', 'song', 'speaker', "
            "'person', 'artist', 'animal', 'instrument', 'school', 'room', 'museum', 'food' etc.\n"
            "Generic types like 'object', 'thing' etc. are NOT allowed.\n"
            "An entity can have multiple types; entity types should be single words."
        ),
    )
    facets: list[FacetTerm] | None = Field(
        default=None,
        description=(
            "Facet terms search for properties or attributes of the entity.\n"
            "E.g.: color(blue), profession(writer), author(*), aunt(Agatha), weight(4kg), phoneNumber(...), etc."
        ),
    )


@dataclass
class VerbsTerm:
    words: list[str] = Field(description="Individual words in single or compound verb.")
    tense: Literal["Past", "Present", "Future"] = "Present"


@dataclass
class ActionTerm:
    action_verbs: VerbsTerm | None = Field(
        default=None, description="Action verbs describing the interaction."
    )
    actor_entities: list[EntityTerm] | Literal["*"] = Field(
        default="*",
        description=(
            "The origin of the action or information, typically the entity performing the action."
        ),
    )
    target_entities: list[EntityTerm] | None = Field(
        default=None,
        description=(
            "The recipient or target of the action or information.\n"
            "Action verbs can imply relevant facet names on the targetEntity. "
            "E.g. write -> writer, sing -> singer etc."
        ),
    )
    additional_entities: list[EntityTerm] | None = Field(
        default=None,
        description=(
            "Additional entities participating in the action.\n"
            "E.g. in the phrase 'Jane ate the spaghetti with the fork', "
            "'the fork' would be an additional entity.\n"
            "E.g. in the phrase 'Did Jane speak about Bach with Nina', "
            "'Bach' would be the additional entity."
        ),
    )
    is_informational: bool = Field(
        default=False,
        description=(
            "Is the intent of the phrase translated to this ActionTerm "
            "to actually get information about specific entities?\n"
            "Examples:\n"
            "True: if asking for specific information about an entity, "
            "such as 'What is Mia's phone number?' or 'Where did Jane study?\n"
            "False: if involves actions and interactions between entities, "
            "such as 'What phone number did Mia mention in her note to Jane?'"
        ),
    )


@dataclass
class SearchFilter:
    """
    Specifies the search terms for a search expression.
    Make sure at least one field below is present and not None nor empty.
    entity_search_terms cannot contain entities already in action_search_terms.
    """

    action_search_term: ActionTerm | None = None
    entity_search_terms: list[EntityTerm] | None = None
    search_terms: list[str] | None = Field(
        default=None,
        description=(
            "search_terms:\n"
            "Concepts, topics or other terms that don't fit ActionTerms or EntityTerms.\n"
            "- Do not use noisy searchTerms like 'topic', 'topics', 'subject', "
            "'discussion' etc. even if they are mentioned in the user request.\n"
            "- Phrases like 'email address' or 'first name' are a single term.\n"
            "- Use empty searchTerms array when use asks for summaries."
        ),
    )
    time_range: DateTimeRange | None = Field(
        default=None,
        description=(
            "Use only if request explicitly asks for time range, particular year, month etc.\n"
            "in this time range."
        ),
    )


@dataclass
class SearchExpr:
    rewritten_query: str = CamelCaseField("The rewritten search query")
    filters: list[SearchFilter] = CamelCaseField(
        "List of search filters", default_factory=list
    )


@dataclass
class SearchQuery:
    search_expressions: list[SearchExpr] = CamelCaseField(
        "One expression for each search required by user request. Each SearchExpr runs independently, so make them standalone by resolving references like 'it', 'that', 'them' etc."
    )
