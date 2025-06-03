# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
from pprint import pprint
import readline  # type: ignore  # For its side-effect of turning on line editing in input().
import shutil
import sys
from typing import Any, Literal

from pydantic.dataclasses import dataclass
import typechat

from ..aitools.auth import load_dotenv
from ..knowpro.collections import SemanticRefAccumulator
from ..knowpro.convknowledge import create_typechat_model
from ..knowpro.interfaces import (
    DateRange,
    Datetime,
    IConversation,
    IMessage,
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    SearchTermGroupTypes,
)
from ..knowpro.query import (
    IQueryOpExpr,
    MatchSearchTermExpr,
    MatchTermsAndExpr,
    MatchTermsOrExpr,
    MatchTermsOrMaxExpr,
    QueryEvalContext,
)
from ..knowpro.search import SearchQueryExpr
from ..podcasts.podcast import Podcast

from .search_query_schema import SearchQuery
from .querycompiler import SearchQueryCompiler, date_range_from_datetime_range

cap = min  # More readable name for capping a value at some limit


def main() -> None:
    load_dotenv()
    translator = create_translator()
    file = "testdata/Episode_53_AdrianTchaikovsky_index"
    pod = Podcast.read_from_file(file)
    assert pod is not None, f"Failed to load podcast from {file!r}"
    # TODO: change QueryEvalContext to take [TMessage, TTermToSemanticRefIndex].
    context = QueryEvalContext(conversation=pod)  # type: ignore
    print("TypeAgent demo UI 0.1 (type 'q' to exit)")
    try:
        process_inputs(translator, context, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()


def create_translator() -> typechat.TypeChatJsonTranslator[SearchQuery]:
    model = create_typechat_model()  # TODO: Move out of here.
    schema = SearchQuery  # TODO: Use SearchTermGroup when ready.
    validator = typechat.TypeChatValidator[schema](schema)
    translator = typechat.TypeChatJsonTranslator[schema](model, validator, schema)
    # schema_text = translator._schema_str.rstrip()  # type: ignore  # No other way.
    # print(f"TypeScript schema for {schema.__name__}:\n{schema_text}\n")
    return translator


def process_inputs(
    translator: typechat.TypeChatJsonTranslator[SearchQuery],
    context: QueryEvalContext,
    stream: io.TextIOWrapper,
) -> None:
    conversation = context.conversation
    ps1 = "--> "
    while True:
        query_text = read_one_line(ps1, stream)
        if query_text is None:  # EOF
            break
        if not query_text:
            continue
        if query_text.lower() in ("exit", "quit", "q"):
            break

        # Gradually turn the query text into something we can use to search.

        # TODO: # 0. Recognize @-commands like "@search" and handle them specially.

        # 1. With LLM help, translate to SearchQuery (a tree but not yet usable to query)
        search_query = translate_text_to_search_query(
            conversation, translator, query_text
        )
        if search_query is None:
            print("Failed to translate command to search terms.")
            continue
        print(f"Search query:")
        pprint(search_query, width=cap(200, shutil.get_terminal_size().columns))
        print()

        # 2. Translate the search query into something directly usable as a query.
        query_exprs = translate_search_query(search_query)
        if not query_exprs:
            print("Failed to translate search query to query expressions.")
            continue
        print("Search query expressions:")
        for expr in query_exprs:
            pprint(expr, width=cap(200, shutil.get_terminal_size().columns))
        print()

        # 3. Search!
        # xxx = search_conversation_with_language(conversation, query_text, search_query)

        # query = compile_query(search_terms)
        # if query is None:
        #     print("Failed to compile search terms to query.")
        #     continue
        # print(f"Query: {query}")
        # result: SemanticRefAccumulator | None = eval_query(query, context)
        # if result is None:
        #     print("Query execution failed.")
        #     continue
        # print(f"Results: {result.to_scored_semantic_refs()}")

        print()


def read_one_line(ps1: str, stream: io.TextIOWrapper) -> str | None:
    """Read a single line from the input stream. Return None for EOF."""
    if stream is sys.stdin and stream.isatty():
        try:
            return input(ps1).strip()
        except EOFError:
            print()
            return None
    else:
        if stream.isatty():
            print(ps1, end="", flush=True)
        line = stream.readline()
        if not line:
            print()
            return None
        return line.strip()


def translate_text_to_search_query(
    conversation: IConversation,
    translator: typechat.TypeChatJsonTranslator[SearchQuery],
    text: str,
) -> SearchQuery | None:
    prompt_preamble: list[typechat.PromptSection] = []
    time_range_preamble = get_time_range_prompt_section_for_conversation(conversation)
    if time_range_preamble is not None:
        prompt_preamble.append(time_range_preamble)
    result: typechat.Result[SearchQuery] = asyncio.run(
        translator.translate(text, prompt_preamble=prompt_preamble)
    )
    if isinstance(result, typechat.Failure):
        print(f"Error translating {text!r}: {result.message}")
        return None
    return result.value


def translate_search_query(
    search_query: SearchQuery,
) -> list[SearchQueryExpr]:
    return SearchQueryCompiler().compile_query(search_query)


# TODO: Move to conversation.py
def get_time_range_prompt_section_for_conversation(
    conversation: IConversation,
) -> typechat.PromptSection | None:
    time_range = get_time_range_for_conversation(conversation)
    if time_range is not None:
        return typechat.PromptSection(
            role="system",
            content=f"ONLY IF user request explicitly asks for time ranges, "
            f'THEN use the CONVERSATION TIME RANGE: "{time_range.start} to {time_range.end}"',
        )


# TODO: Move to conversation.py
def get_time_range_for_conversation(
    conversation: IConversation[IMessage, Any],
) -> DateRange | None:
    messages = conversation.messages
    if len(messages) > 0:
        start = messages[0].timestamp
        if start is not None:
            end = messages[-1].timestamp
            return DateRange(
                start=Datetime.fromisoformat(start),
                end=Datetime.fromisoformat(end) if end else None,
            )
    return None


# ---------- From an earlier version ----------


@dataclass
class LanguageQueryExpr:
    query_text: str
    query: SearchQuery
    query_expressions: list[SearchQueryExpr]


def search_conversation_with_language(
    conversation: IConversation, query_text, search_query: SearchQuery
) -> LanguageQueryExpr | None:
    query_expressions = compile_search_query(conversation, search_query)

    return LanguageQueryExpr(query_text, search_query, query_expressions)


def compile_search_query(conversation, search_query) -> list[SearchQueryExpr]:

    return []


# ---------- From an earlier version ----------


def compile_query(
    search_term: SearchTermGroupTypes,
) -> IQueryOpExpr[SemanticRefAccumulator | None] | None:
    if isinstance(search_term, SearchTermGroup):
        table: dict[
            Literal["and", "or", "or_max"],
            type[MatchTermsAndExpr | MatchTermsOrExpr | MatchTermsOrMaxExpr],
        ] = {
            "and": MatchTermsAndExpr,
            "or": MatchTermsOrExpr,
            "or_max": MatchTermsOrMaxExpr,
        }
        txs: list[IQueryOpExpr[SemanticRefAccumulator | None]] = []
        for term in search_term.terms:
            tx = compile_query(term)
            if tx is None:
                print(f"Cannot compile {term} .")
                return None
            txs.append(tx)
        return table[search_term.boolean_op](term_expressions=txs)

    if isinstance(search_term, SearchTerm):
        return MatchSearchTermExpr(search_term)

    assert isinstance(search_term, PropertySearchTerm)
    print("PropertySearchTerm not yet supported")
    return None


def eval_query(
    query: IQueryOpExpr[SemanticRefAccumulator | None], context: QueryEvalContext
) -> SemanticRefAccumulator | None:
    return query.eval(context)


if __name__ == "__main__":
    main()
