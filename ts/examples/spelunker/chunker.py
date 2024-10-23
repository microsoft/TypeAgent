# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A chunker for Python code using the ast module.

- Basic idea: Chunks can nest!
- Each chunk consists of some text from the file,
  with 0 or more *placeholders* where other chunks are to be inserted.
- Each chunk has an ID and some metadata.
- For an inner chunk, the metadata contains (at least)
  the ID of the outer chunk and the insertion point.
- For an outer chunk, the metadata includes
  a list of inner chunk IDs and their insertion points.
- Sometimes the hierarchy has more than two levels.
- Not every inner chunk is a function or class,
  though that is where we start.
- Both at the top level and within functions and classes,
  we can have additional chunks, e.g. blocks of imports, docstrings,
  blocks of variable definitions, comments, etc.
- The chunker has some freedom of how to break code into chunks,
  in order to keep the chunks manageable in number and size.
- Chunks are not necessarily formed of a whole number of lines.
- CR LF is replaced by LF (that's how Python's IO works, usually).
"""

import ast
from dataclasses import dataclass
import datetime
import json
import sys
from typing import Iterator


@dataclass
class Blob:
    """A sequence of text lines plus some metadata."""

    lines: list[str]
    lineno: int  # 0-based!

    def to_dict(self) -> dict[str, object]:
        return {
            "lines": self.lines,
            "lineno": self.lineno,
        }


IdType = str


@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""

    id: IdType
    treeName: str  # AST node name
    blobs: list[Blob]  # Blobs around the placeholders

    # For inner chunks:
    parent_id: IdType
    parent_slot: int  # Index of preceding blob in parent chunk

    # For outer chunks:
    children: list[IdType]  # len() is one less than len(blobs)

    # Used by custo_json() below.
    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "treeName": self.treeName,
            "blobs": self.blobs,
            "parent_id": self.parent_id,
            "parent_slot": self.parent_slot,
            "children": self.children,
        }

    # Just for fun.
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=custom_json, indent=2)

    # For pydantic:
    # class Config:
    #     arbitrary_types_allowed = True  # Needed for ast.AST


# Support for JSON serialization of Chunks


def custom_json(obj: object) -> dict[str, object]:
    if hasattr(obj, "to_dict"):
        return obj.to_dict()  # type: ignore
    else:
        raise TypeError(f"Cannot JSON serialize object of type {type(obj)}")


last_ts: datetime.datetime = datetime.datetime.now()


def generate_id() -> IdType:
    """Generate a new unique ID.

    IDs are really timestamps formatted as YYYY_MM_DD-HH_MM_SS.UUUUUU,
    where UUUUUU is microseconds.

    To ensure IDs are unique, if the next timestamp isn't greater than the last one,
    we add 1 usec to the last one. This has the advantage of "gracefully" handling
    time going backwards.
    """
    global last_ts
    next_ts = datetime.datetime.now()  # Local time, for now
    if next_ts <= last_ts:
        next_ts = last_ts + datetime.timedelta(microseconds=1)
    last_ts = next_ts
    return next_ts.strftime("%Y_%m_%d-%H_%M_%S.%f")


"""Design for recursive chunking.

We start with a tree node. Potentially it is one block.
If it is "statement-like", we walk its descendants that are statement-like,
in pre-order, and if any is a class or function definition, we make it a sub-chunk.
We apply the same thing recursively to the sub-chunk.
When we identify a non-splittable node, we create a Chunk out of it.

There's a recursive function that takes in text and a tree, and returns a list of Chunks,
representing that tree in pre-order (parents preceding children).
"""

COMPOUND_STATEMENT_NODES = [
    # Nodes that can contain statement nodes.
    # See https://docs.python.org/3/library/ast.html
    "Module",
    "Interactive",
    "If",
    "For",
    "While",
    "Try",
    "TryStar",
    "ExceptHandler",
    "With",
    "Match",
    "match_case",
    "FunctionDef",
    "ClassDef",
]


def ast_iter_child_statement_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Iterate over the children of a node."""
    for name, field in ast.iter_fields(node):
        if isinstance(field, ast.AST):
            if name in COMPOUND_STATEMENT_NODES:
                yield field
        elif isinstance(field, list):
            for item in field:  # type: ignore
                if isinstance(item, ast.AST):
                    if item.__class__.__name__ in COMPOUND_STATEMENT_NODES:
                        yield item


def extract_blob(lines: list[str], node: ast.AST) -> Blob:
    """Extract the text of a node from the source code (as list of lines)."""
    # TODO: Include immediately preceding comment blocks.
    # NOTE: We ignore complaints about lineno/end_lineno being Undefined.
    start: int = node.lineno - 1  # type: ignore
    end: int = node.end_lineno  # type: ignore
    if hasattr(node, "decorator_list"):
        decorators: list[ast.AST] = node.decorator_list  # type: ignore
        if decorators:
            start = decorators[0].lineno - 1  # type: ignore
    return Blob(lines[start:end], start)  # type: ignore


def create_chunks_recursively(
    lines: list[str], tree: ast.AST, parent: Chunk
) -> list[Chunk]:
    """Recursively create chunks for the AST."""
    chunks: list[Chunk] = []
    parent_slot: int = 0

    for node in ast_iter_child_statement_nodes(tree):
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.ClassDef):
            node_name = node.__class__.__name__
            node_id = generate_id()
            node_blob = extract_blob(lines, node)
            node_blobs = [node_blob]
            chunk = Chunk(node_id, node_name, node_blobs, parent.id, parent_slot, [])
            chunks.append(chunk)
            chunks.extend(create_chunks_recursively(lines, node, chunk))
            parent.children.append(node_id)
            parent_slot += 1
            assert len(parent.children) == parent_slot

            # Split last parent.blobs[-1] into two, leaving a gap for the new Chunk
            parent_blob: Blob = parent.blobs.pop()
            parent_start: int = parent_blob.lineno
            parent_end: int = parent_blob.lineno + len(parent_blob.lines)
            first_blob, last_blob = chunk.blobs[0], chunk.blobs[-1]
            first_start = first_blob.lineno
            last_end = last_blob.lineno + len(last_blob.lines)
            if parent_start <= last_end and last_end <= parent_end:
                parent.blobs.append(Blob(lines[parent_start:first_start], parent_start))
                parent.blobs.append(Blob(lines[last_end:parent_end], last_end))
                assert len(parent.blobs) == parent_slot + 1

    return chunks


def chunker(text: str, tree: ast.AST) -> list[Chunk]:
    """Chunker for Python code."""

    lines = text.splitlines(keepends=True)
    # print(ast.dump(tree, indent=4, include_attributes=True))

    # Handcraft the root node
    root_id = generate_id()
    root_name = tree.__class__.__name__
    root = Chunk(root_id, root_name, [Blob(lines, 0)], "", 0, [])

    chunks = create_chunks_recursively(lines, tree, root)
    chunks.insert(0, root)
    return chunks


def test():
    if len(sys.argv) != 2:
        print("Usage: python chunker.py <filename>")
        return 2

    filename = sys.argv[1]
    try:
        with open(filename, "r") as f:
            text = f.read()
    except OSError as e:
        print({"error": e})
        return 1

    try:
        tree = ast.parse(text, filename=filename)
    except SyntaxError as e:
        print({"error": e})
        return 1

    chunks = chunker(text, tree)
    # for chunk in chunks:
    #     print(chunk)
    print(json.dumps(chunks, indent=4, default=custom_json))
    return 0


if __name__ == "__main__":
    exit_code = test()
    sys.exit(exit_code)
