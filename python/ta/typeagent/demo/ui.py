# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
import sys

import typechat

from typeagent.knowpro.query import GroupSearchResultsExpr
from typeagent.knowpro.convknowledge import create_typechat_model
from .search_schema import SearchTermGroup
from typeagent.aitools.auth import load_dotenv


def main() -> None:
    load_dotenv()
    translator = create_translator()
    print("TypeAgent demo UI 0.1 (type 'q' to exit)")
    try:
        read_commands(translator, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()


def create_translator() -> typechat.TypeChatJsonTranslator[SearchTermGroup]:
    model = create_typechat_model()
    schema = SearchTermGroup
    type_name = "SearchTermGroup"
    validator = typechat.TypeChatValidator[SearchTermGroup](schema)
    translator = typechat.TypeChatJsonTranslator[SearchTermGroup](
        model, validator, SearchTermGroup
    )
    schema_text = translator._schema_str.rstrip()
    print(f"TypeScript schema for {type_name}:\n{schema_text}\n")
    return translator


def read_commands(translator, stream: io.TextIOWrapper) -> None:
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
        if query:
            print(query)
            # result = execute_query(query)
            # if result:
            #     print(result)
            # else:
            #     print("Query execution failed.")
        else:
            print("Invalid query.")


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


def translate_command(translator, command: str) -> GroupSearchResultsExpr | None:
    result = asyncio.run(
        translator.translate(
            f"Please convert the following user query to a SearchTermGroup:"
            f"\n'''{command}\n'''\n"
        )
    )
    if isinstance(result, typechat.Success):
        return GroupSearchResultsExpr(result.value)
    else:
        print(f"Error translating {command!r}: {result.message}")
        return None


def execute_query(query):
    pass


if __name__ == "__main__":
    main()
