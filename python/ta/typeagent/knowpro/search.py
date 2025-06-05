# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
from tkinter import SE
from typing import Callable, Literal, cast

from ..knowpro.kplib import ConcreteEntity

from .collections import SemanticRefAccumulator
from .interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    KnowledgeType,
    PropertySearchTerm,
    ScoredMessageOrdinal,
    ScoredSemanticRefOrdinal,
    SearchSelectExpr,
    SearchTerm,
    SearchTermGroup,
    SemanticRef,
    SemanticRefSearchResult,
    WhenFilter,
)
from .query import (
    GetScopeExpr,
    GetScoredMessagesExpr,
    GroupByKnowledgeTypeExpr,
    GroupSearchResultsExpr,
    IQueryOpExpr,
    MatchPropertySearchTermExpr,
    MatchSearchTermExpr,
    MatchTagExpr,
    MatchTermsAndExpr,
    MatchTermsBooleanExpr,
    MatchTermsOrExpr,
    MatchTermsOrMaxExpr,
    MatchTopicExpr,
    QueryEvalContext,
    SelectTopNKnowledgeGroupExpr,
    WhereSemanticRefExpr,
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


# TODO: Move to compilelib.py
type BooleanOp = Literal["and", "or", "or_max"]


# TODO: Move to compilelib.py
@dataclass
class CompiledTermGroup:
    boolean_op: BooleanOp
    terms: list[SearchTerm]


# NOTE: QueryCompiler instances are stateful, and not thread-safe.
#       Create a new one for each query.
class QueryCompiler:
    def __init__(
        self,
        conversation: IConversation,
        secondary_indexes: IConversationSecondaryIndexes | None,
        entity_term_match_weight: float = 100.0,
        default_term_match_weight: float = 10.0,
        related_is_exact_threshold: float = 0.95,
    ):
        self.conversation = conversation
        self.secondary_indexes = secondary_indexes
        self.entity_term_match_weight = entity_term_match_weight
        self.default_term_match_weight = default_term_match_weight
        self.related_is_exact_threshold = related_is_exact_threshold
        # All SearchTerms used which compiling the 'select' portion of the query.
        self.all_search_terms: list[CompiledTermGroup] = []
        # All search terms used while compiling predicates in the query.
        self.all_predicate_search_terms: list[CompiledTermGroup] = []
        self.all_scope_search_terms: list[CompiledTermGroup] = []

    # NOTE: Everything is async because we sometimes use embeddings.

    async def compile_knowledge_query(
        self,
        terms: SearchTermGroup,
        filter: WhenFilter | None = None,
        options: None = None,  # TODO: SearchOptions | None = None
    ) -> GroupSearchResultsExpr:
        query = await self.compile_query(terms, filter, options)

        exact_match = False
        if not exact_match:
            await self.resolve_related_terms(self.all_search_terms, True)

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

    # TODO: compile_message_similarity_query

    async def compile_query(
        self,
        search_term_group: SearchTermGroup,
        filter: WhenFilter | None = None,
        options: None = None,  # TODO: SearchOptions | None = None
    ) -> IQueryOpExpr[dict[KnowledgeType, SemanticRefAccumulator]]:
        select_expr = self.compile_select(
            search_term_group,
            await self.compile_scope(search_term_group, filter),
            options,
        )
        # Constrain the select with scopes and 'where'.
        if filter:
            select_expr = WhereSemanticRefExpr(
                select_expr,
                self.compile_where(filter),
            )
        # And lastly, select 'TopN' and group knowledge by type.
        tmp = GroupByKnowledgeTypeExpr(select_expr)
        return SelectTopNKnowledgeGroupExpr(
            tmp,
            (
                options.max_knowledge_matches
                if options
                and hasattr(options, "max_knowledge_matches")
                and options.max_knowledge_matches
                else None
            ),
        )

    def compile_select(
        self,
        term_group: SearchTermGroup,
        scope_expr: GetScopeExpr,
        options: None = None,  # TODO: SearchOptions | None = None
    ) -> IQueryOpExpr[SemanticRefAccumulator]:
        search_terms_used, select_expr = self.compile_search_group_terms(
            term_group, scope_expr
        )
        self.all_search_terms.extend(search_terms_used)
        return select_expr

    def compile_search_group_terms(
        self,
        search_group: SearchTermGroup,
        scope_expr: GetScopeExpr | None = None,
    ) -> tuple[list[CompiledTermGroup], IQueryOpExpr[SemanticRefAccumulator]]:
        return self.compile_search_group(
            search_group,
            lambda term_exprs, boolean_op, scope: create_match_terms_boolean_expr(
                term_exprs, boolean_op, scope
            ),
            scope_expr,
        )

    # TODO: compile_search_group_messages

    def compile_search_group(
        self,
        search_group: SearchTermGroup,
        create_op: Callable[
            [list[IQueryOpExpr], BooleanOp, GetScopeExpr | None],
            IQueryOpExpr[SemanticRefAccumulator],
        ],
        scope_expr: GetScopeExpr | None = None,
    ) -> tuple[list[CompiledTermGroup], IQueryOpExpr[SemanticRefAccumulator]]:
        t0_terms: list[SearchTerm] = []
        compiled_terms: list[CompiledTermGroup] = [
            CompiledTermGroup(boolean_op="and", terms=t0_terms)
        ]
        term_expressions: list[IQueryOpExpr[SemanticRefAccumulator | None]] = []
        for term in search_group.terms:
            if isinstance(term, PropertySearchTerm):
                term_expressions.append(self.compile_property_term(term))
                if not isinstance(term.property_name, str):
                    t0_terms.append(term.property_name)
                t0_terms.append(term.property_value)
            elif isinstance(term, SearchTermGroup):
                nested_terms, group_expr = self.compile_search_group(term, create_op)
                compiled_terms.extend(nested_terms)
                term_expressions.append(group_expr)
            else:
                assert isinstance(
                    term, SearchTerm
                ), f"Unexpected term type: {type(term)}"
                term_expressions.append(self.compile_search_term(term))
                t0_terms.append(term)
        bool_expr = create_op(term_expressions, search_group.boolean_op, scope_expr)
        return (compiled_terms, bool_expr)

    def compile_search_term(
        self,
        term: SearchTerm,
    ) -> IQueryOpExpr[SemanticRefAccumulator | None]:
        boost_weight = self.entity_term_match_weight / self.default_term_match_weight
        return MatchSearchTermExpr(
            term,
            lambda term, sr, scored: self.boost_entities(
                term, sr, scored, boost_weight
            ),
        )

    def compile_property_term(
        self,
        term: PropertySearchTerm,
    ) -> IQueryOpExpr[SemanticRefAccumulator | None]:
        match term.property_name:
            case "tag":
                return MatchTagExpr(term.property_value)
            case "topic":
                return MatchTopicExpr(term.property_value)
            case _:
                if term.property_name in ("name", "type"):
                    tpvt = term.property_value.term
                    if tpvt.weight is None:
                        tpvt.weight = self.entity_term_match_weight
                return MatchPropertySearchTermExpr(term)

    # TODO: ...

    def boost_entities(
        self,
        search_term: SearchTerm,
        sr: SemanticRef,
        scored_ref: ScoredSemanticRefOrdinal,
        boost_weight: float,
    ) -> ScoredSemanticRefOrdinal:
        if sr.knowledge_type == "entity" and match_entity_name_or_type(
            search_term, cast(ConcreteEntity, sr)
        ):
            return ScoredSemanticRefOrdinal(
                scored_ref.semantic_ref_ordinal,
                scored_ref.score * boost_weight,
            )
        else:
            return scored_ref


def create_match_terms_boolean_expr(
    term_expressions: list[IQueryOpExpr[SemanticRefAccumulator | None]],
    boolean_op: BooleanOp,
    scope_expr: GetScopeExpr | None = None,
) -> MatchTermsBooleanExpr:
    match boolean_op:
        case "and":
            return MatchTermsAndExpr(term_expressions, scope_expr)
        case "or":
            return MatchTermsOrExpr(term_expressions, scope_expr)
        case "or_max":
            return MatchTermsOrMaxExpr(term_expressions, scope_expr)
        case _:
            raise ValueError(f"Unknown boolean op: {boolean_op}")
