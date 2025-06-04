# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from ast import Not
from dataclasses import dataclass

from .interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    KnowledgeType,
    ScoredMessageOrdinal,
    SearchSelectExpr,
    SearchTermGroup,
    SemanticRefSearchResult,
    WhenFilter,
)
from .query import IQueryOpExpr, is_conversation_searchable


@dataclass
class SearchQueryExpr:
    select_expressions: list[SearchSelectExpr]
    raw_query: str | None = None


@dataclass
class ConversationSearchResult:
    message_matches: list[ScoredMessageOrdinal]
    knowledge_matches: dict[KnowledgeType, SemanticRefSearchResult]
    raw_query_text: str | None = None


# TODO: This is not functional yet (needs to compile search term group to IQueryExpr).
async def search_conversation(
    conversation: IConversation,
    search_term_group: SearchTermGroup,
    when_filter: WhenFilter | None = None,
    options: None = None,  # TODO: SearchOptions | None = None
    raw_search_query: str | None = None,
) -> ConversationSearchResult | None:
    knowledge_matches = await search_conversation_knowledge(
        conversation, search_term_group, when_filter, options
    )
    if knowledge_matches is None:
        return None
    # Future: Combine knowledge and message queries into single query tree.
    compiler = QueryCompiler(conversation, conversation.secondary_indexes)
    query = await compiler.compile_message_query(
        knowledge_matches, options, raw_search_query
    )
    message_matches: list[ScoredMessageOrdinal] = await run_query(
        conversation, options, query
    )
    return ConversationSearchResult(
        message_matches=message_matches,
        knowledge_matches=knowledge_matches,
        raw_query_text=None,  # TODO:  = raw_search_query
    )


async def search_conversation_knowledge(
    conversation: IConversation,
    search_term_group: SearchTermGroup,
    when_filter: WhenFilter | None = None,
    options: None = None,  # TODO: SearchOptions | None = None
) -> dict[KnowledgeType, SemanticRefSearchResult] | None:
    if not is_conversation_searchable(conversation):
        return None
    return None  # TODO: Implement search logic here.


"""
Rouch sketch of how to search in search_conversation_knowledge():

- search_term_group: SearchTermGroup has a bool-ish op and a list of (SearchTerm | SearchTermGroup).
- for each item in the list:
  - if it's a SearchTermGroup, recursively search to get results.
  - if it's a SearchTerm, it has a term and maybe a list of related terms:
    - for each term or related term:
      - search the conversation for messages matching the term;
      - if a message matches, add it to the results.
  - the results for that list item are one or the arms of the bool-ish op.
- Finally, combine the results according to the bool-ish op.
- Return the combined results.
"""


def run_query[T](
    conversation: IConversation,
    options: None,  # TODO: SearchOptions | None
    query: IQueryOpExpr[T],
) -> T:
    raise NotImplementedError("run_query() isn't implemented yet.")


class QueryCompiler:
    def __init__(
        self,
        conversation: IConversation,
        secondary_indexes: IConversationSecondaryIndexes | None,
    ):
        self.conversation = conversation
        self.secondary_indexes = secondary_indexes

    async def compile_knowledge_query(
        self,
        terms: SearchTermGroup,
        filter: WhenFilter | None = None,
        options: None = None,  # TODO: SearchOptions | None = None
    ) -> SearchQueryExpr:
        raise NotImplementedError(
            "QueryCompiler.compile_knowledge_query() isn't implemented yet."
        )

    async def compile_message_query(
        self,
        knowledge_matches: (
            IQueryOpExpr[dict[KnowledgeType, SemanticRefSearchResult]]
            | dict[KnowledgeType, SemanticRefSearchResult]
        ),
        options: None = None,  # TODO: SearchOptions | None = None,
        raw_query_text: str | None = None,
    ) -> IQueryOpExpr:
        raise NotImplementedError(
            "QueryCompiler.compile_message_query() isn't implemented yet."
        )
