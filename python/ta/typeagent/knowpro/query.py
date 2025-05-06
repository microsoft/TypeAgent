# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from typing import Callable, Protocol

from .collections import (
    PropertyTermSet,
    SemanticRefAccumulator,
    TermSet,
    TextRangesInScope,
)
from .interfaces import (
    IConversation,
    IPropertyToSemanticRefIndex,
    ITimestampToTextRangeIndex,
    ScoredSemanticRefOrdinal,
    SearchTerm,
    SemanticRef,
)


def is_conversation_searchable(conversation: IConversation) -> bool:
    """Determine if a conversation is searchable.

    A conversation is searchable if it has a semantic reference index
    and semantic references initialized.
    """
    return (
        conversation.semantic_ref_index is not None
        and conversation.semantic_refs is not None
    )


@dataclass
class QueryEvalContext:
    """Context for evaluating a query within a conversation.

    This class provides the necessary context for query evaluation, including
    the conversation being queried, optional indexes for properties and timestamps,
    and structures for tracking matched terms and text ranges in scope.

    Attributes:
        conversation: The conversation being queried.
        property_index: Optional index for mapping properties to semantic references.
        timestamp_index: Optional index for mapping timestamps to text ranges.
        matched_terms: A set of terms matched during query evaluation.
        match_property_terms: A set of property terms matched during query evaluation.
        text_ranges_in_scope: Text ranges currently in scope for the query.
    """

    conversation: IConversation
    property_index: IPropertyToSemanticRefIndex | None = None
    timestamp_index: ITimestampToTextRangeIndex | None = None
    matched_terms: TermSet = field(init=False, default_factory=TermSet)
    match_property_terms: PropertyTermSet = field(
        init=False, default_factory=PropertyTermSet
    )
    text_ranges_in_scope: TextRangesInScope | None = field(
        init=False, default_factory=TextRangesInScope
    )

    def __post_init__(self):
        if not is_conversation_searchable(self.conversation):
            raise ValueError(
                f"{self.conversation.name_tag} "
                + "is not initialized and cannot be searched."
            )


class IQueryOpExpr[T](Protocol):
    """Protocol for query operation expressions that can be evaluated in a context."""

    def eval(self, context: QueryEvalContext) -> T:
        raise NotImplementedError


class QueryOpExpr[T](IQueryOpExpr[T]):
    """Base class for query operation expressions."""

    def eval(self, context: QueryEvalContext) -> T:
        raise NotImplementedError


class MatchTermExpr(QueryOpExpr[SemanticRefAccumulator | None]):
    """Expression for matching terms in a query.

    This class evaluates a query expression to accumulate matches
    in the form of a SemanticRefAccumulator. If no matches are found,
    it returns None.
    """

    def eval(self, context: QueryEvalContext) -> SemanticRefAccumulator | None:
        matches = SemanticRefAccumulator()
        self._accumulate_matches(context, matches)
        if len(matches) > 0:
            return matches
        return None

    # Subclass can override.
    def _accumulate_matches(
        self, context: QueryEvalContext, matches: SemanticRefAccumulator
    ) -> None:
        return


class MatchSearchTermExpr(MatchTermExpr):
    def __init__(
        self,
        search_term: SearchTerm,
        score_booster: (
            Callable[
                [SearchTerm, SemanticRef, ScoredSemanticRefOrdinal],
                ScoredSemanticRefOrdinal,
            ]
            | None
        ) = None,
    ) -> None:
        super().__init__()
        self.search_term = search_term
        self.score_booster = score_booster
