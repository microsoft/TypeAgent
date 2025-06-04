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
from .query import (
    GetScoredMessagesExpr,
    GroupSearchResultsExpr,
    IQueryOpExpr,
    QueryEvalContext,
    is_conversation_searchable,
)


@dataclass
class SearchQueryExpr:
    select_expressions: list[SearchSelectExpr]
    raw_query: str | None = None


@dataclass
class ConversationSearchResult:
    message_matches: list[ScoredMessageOrdinal]
    knowledge_matches: dict[KnowledgeType, SemanticRefSearchResult]
    raw_query_text: str | None = None


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
    # compiler = QueryCompiler(conversation, conversation.secondary_indexes)
    # message_query = await compiler.compile_message_query(
    #     knowledge_matches, options, raw_search_query
    # )
    # message_matches: list[ScoredMessageOrdinal] = run_query(
    #     conversation, options, message_query
    # )
    # TODO: Replace line below with commented-out code above.
    message_matches: list[ScoredMessageOrdinal] = []
    return ConversationSearchResult(
        message_matches, knowledge_matches, raw_search_query
    )


async def search_conversation_knowledge(
    conversation: IConversation,
    search_term_group: SearchTermGroup,
    when_filter: WhenFilter | None = None,
    options: None = None,  # TODO: SearchOptions | None = None
) -> dict[KnowledgeType, SemanticRefSearchResult] | None:
    """Search a conversation for knowledge that matches the given search terms."""
    if not is_conversation_searchable(conversation):
        return None
    compiler = QueryCompiler(conversation, conversation.secondary_indexes)
    knowledge_query = await compiler.compile_knowledge_query(
        search_term_group, when_filter, options
    )
    return run_query(conversation, options, knowledge_query)


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


# TODO: search_conversation_by_text_similarity


async def run_search_query(
    conversation: IConversation,
    query: SearchQueryExpr,
    options: None = None,  # TODO: SearchOptions | None = None
) -> list[ConversationSearchResult] | None:
    results: list[ConversationSearchResult] = []
    for expr in query.select_expressions:
        search_results = await search_conversation(
            conversation,
            expr.search_term_group,
            expr.when,
            options,
            query.raw_query,
        )
        if search_results is not None:
            results.append(search_results)
    return results


def run_query[T](
    conversation: IConversation,
    options: None,  # TODO: SearchOptions | None
    query: IQueryOpExpr[T],
) -> T:
    secondary_indexes = conversation.secondary_indexes
    if secondary_indexes is None:
        # TODO: create an empty secondary indexes object instead of raising.
        raise ValueError("Can't query conversation without secondary indexes.")
    return query.eval(
        QueryEvalContext(
            conversation,
            secondary_indexes.property_to_semantic_ref_index,
            secondary_indexes.timestamp_index,
        )
    )


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
    ) -> GroupSearchResultsExpr:
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
    ) -> GetScoredMessagesExpr:
        raise NotImplementedError(
            "QueryCompiler.compile_message_query() isn't implemented yet."
        )
