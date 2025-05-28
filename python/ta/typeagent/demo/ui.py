# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
import sys
from typing import cast

import typechat

from ..aitools.auth import load_dotenv
from ..knowpro.convknowledge import create_typechat_model
from ..knowpro.query import QueryEvalContext
from ..podcasts.podcast import Podcast
from .search_schema import SearchTermGroup as LimitedSearchTermGroup
from ..knowpro.interfaces import SearchTermGroup
from ..knowpro.search import ConversationSearchResult, search_conversation


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
        read_commands(translator, context, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()


def create_translator() -> typechat.TypeChatJsonTranslator[SearchTermGroup]:
    model = create_typechat_model()  # TODO: Move out of here.
    schema = LimitedSearchTermGroup  # TODO: Use SearchTermGroup when ready.
    type_name = schema.__name__
    validator = typechat.TypeChatValidator[schema](schema)
    translator = typechat.TypeChatJsonTranslator[schema](model, validator, schema)
    schema_text = translator._schema_str.rstrip()
    print(f"TypeScript schema for {type_name}:\n{schema_text}\n")
    return cast(typechat.TypeChatJsonTranslator[SearchTermGroup], translator)


def read_commands(
    translator: typechat.TypeChatJsonTranslator[SearchTermGroup],
    context: QueryEvalContext,
    stream: io.TextIOWrapper,
) -> None:
    ps1 = "--> "
    while True:
        line = read_one_line(ps1, stream)
        if line is None:  # EOF
            break
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            break
        query = translate_command(translator, line)
        if query is None:
            print("Failed to translate command.")
            continue
        print(query)
        result = run_query(query, context)
        if result is None:
            print("Query execution failed.")
            continue
        print(result)


def read_one_line(ps1: str, stream: io.TextIOWrapper) -> str | None:
    """Read a single line from the input stream. Return None for EOF."""
    if stream is sys.stdin:
        import readline  # For its side-effect of turning on line editing and history in input().

        try:
            return input(ps1).strip()
        except EOFError:
            print()
            return None
    else:
        print(ps1, end="", flush=True)
        line = stream.readline()
        if not line:
            print()
            return None
        return line.strip()


def translate_command(
    translator: typechat.TypeChatJsonTranslator[SearchTermGroup], command: str
) -> SearchTermGroup | None:
    result: typechat.Result[SearchTermGroup] = asyncio.run(
        translator.translate(
            f"Please convert the following user query to a SearchTermGroup:"
            f"\n'''{command}\n'''\n"
        )
    )
    if isinstance(result, typechat.Failure):
        print(f"Error translating {command!r}: {result.message}")
        return None
    return result.value


def run_query(
    query: SearchTermGroup, context: QueryEvalContext
) -> ConversationSearchResult | None:
    """Run the query against the conversation and return the results."""

    return asyncio.run(search_conversation(context.conversation, query))


if __name__ == "__main__":
    main()
