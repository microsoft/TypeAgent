# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
import sys

import pydantic
import typechat

from typeagent.knowpro import convknowledge
from typeagent.aitools.auth import load_dotenv

@pydantic.dataclasses.dataclass
class ExampleSchema:
    name: str
    value: int

def create_translator() -> typechat.TypeChatJsonTranslator[ExampleSchema]:

    model = convknowledge.create_typechat_model()
    schema = ExampleSchema
    type_name = "ExampleSchema"
    validator = typechat.TypeChatValidator[ExampleSchema](schema)
    translator = typechat.TypeChatJsonTranslator[ExampleSchema](
        model, validator, ExampleSchema
    )
    schema_text = translator._schema_str.rstrip()
    print(f"TypeScript schema for {type_name}:\n{schema_text}\n")
    return translator

def main() -> None:
    load_dotenv()
    translator = create_translator()
    print("TypeAgent UI 0.1 (type 'exit' to exit)")
    try:
        read_commands(translator, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()

def read_commands(translator, stream: io.TextIOWrapper) -> None:
    while True:
        print("--> ", end="", flush=True)
        line = stream.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        if line in ("exit", "quit"):
            break
        query = parse_command(translator, line)
        if query:
            print(query)
            result = execute_query(query)
            if result:
                print(result)
            else:
                print("Query execution failed.")
        else:
            print("Invalid query.")

def parse_command(translator, command: str):
    result = asyncio.run(translator.translate(command))
    if isinstance(result, typechat.Success):
        return result.value
    else:
        print(f"Error translating {command!r}: {result.message}")
        return None

def execute_query(query):
    pass

if __name__ == "__main__":
    main()
