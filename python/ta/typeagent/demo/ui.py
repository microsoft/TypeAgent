# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
import sys

import typechat

from typeagent.knowpro.convknowledge import create_typechat_model
from .search_schema import SearchTermGroup
from typeagent.aitools.auth import load_dotenv


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


def main() -> None:
    load_dotenv()
    translator = create_translator()
    print("TypeAgent demo UI 0.1 (type 'exit' to exit)")
    try:
        read_commands(translator, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()


def read_commands(translator, stream: io.TextIOWrapper) -> None:
    while True:
        print("--> ", end="", flush=True)
        line = stream.readline()
        if not line:
            print()
            break
        line = line.strip()
        if not line:
            continue
        if line in ("exit", "quit"):
            break
        query = parse_command(translator, line)
        if query:
            print(query)
            # result = execute_query(query)
            # if result:
            #     print(result)
            # else:
            #     print("Query execution failed.")
        else:
            print("Invalid query.")


def parse_command(translator, command: str):
    result = asyncio.run(
        translator.translate(
            f"Please convert the following user query to a SearchTermGroup, "
            f"making sure to fill in the related terms in SearchQuery objects:\n'''{command}\n'''\n"
        )
    )
    if isinstance(result, typechat.Success):
        return result.value
    else:
        print(f"Error translating {command!r}: {result.message}")
        return None


def execute_query(query):
    pass


if __name__ == "__main__":
    main()
