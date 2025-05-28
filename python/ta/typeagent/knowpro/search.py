# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass

from .interfaces import (
    IConversation,
    KnowledgeType,
    ScoredMessageOrdinal,
    SearchTermGroup,
    SemanticRefSearchResult,
)
from .query import is_conversation_searchable


@dataclass
class ConversationSearchResult:
    message_matches: list[ScoredMessageOrdinal]
    knowledge_matches: dict[KnowledgeType, SemanticRefSearchResult]
    raw_search_query: str | None = None


async def search_conversation(
    conversation: IConversation,
    search_term_group: SearchTermGroup,
    # TODO: when_filter, options, raw_search_query
) -> ConversationSearchResult | None:
    knowledge_matches = await search_conversation_knowledge(
        conversation, search_term_group  # TODO: when_filter, options
    )
    if knowledge_matches is None:
        return None
    # TODO: message_matches = ...
    return ConversationSearchResult(
        message_matches=[],
        knowledge_matches=knowledge_matches,
        raw_search_query=None,  # TODO:  = raw_search_query
    )


async def search_conversation_knowledge(
    conversation: IConversation,
    search_term_group: SearchTermGroup,
) -> dict[KnowledgeType, SemanticRefSearchResult] | None:
    if not is_conversation_searchable(conversation):
        return None
    return None  # TODO: Implement search logic here.


"""
Rouch sketch of how to search:

- search_term_group: SearchTermGroup has a bool=ish op and a list of (SearchTerm | SearchTermGroup).
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
