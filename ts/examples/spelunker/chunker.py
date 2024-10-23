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
from collections import deque
from dataclasses import dataclass
import datetime
import json
from typing import Iterator

IdType = str


@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""

    id: IdType
    tree: ast.AST  # The AST node for this chunk
    blobs: list[str]  # Blobs around the placeholders

    # The rest is metadata

    # For inner chunks:
    parent_id: IdType
    parent_slot: int  # Index of preceding blob in parent chunk

    # For outer chunks:
    children: list[IdType]  # len() is one less than len(blobs)

    # For JSON serialization:

    def to_dict(self) -> dict[str, any]:
        return {
            "id": self.id,
            "tree": "",  # TODO
            "blobs": self.blobs,
            "parent_id": self.parent_id,
            "parent_slot": self.parent_slot,
            "children": self.children,
        }

    # For pydantic:
    # class Config:
    #     arbitrary_types_allowed = True  # Needed for ast.AST


# Support for JSON serialization of Chunks

def custom_json(obj):
    if isinstance(obj, Chunk):
        return obj.to_dict()
    else:
        raise TypeError(f"Cannot JSON serialize object of type {type(obj)}")


# TODO: Make this a singleton class?

last_timestamp: IdType = ""
last_counter: int = 0

def generate_id() -> IdType:
    """Generate a new unique ID.
    
    IDs are really timestamps formatted as YYYY-MM-DD-HH-MM-SS.UUUUUU[-NNN],
    where UUUUUU is microseconds and NNN is optionally added to make IDs unique.

    TODO: Tweak the usecs instead of adding another counter.
    """
    global last_timestamp, last_counter
    now = datetime.datetime.now()
    new_timestamp = now.strftime("%Y-%m-%d-%H-%M-%S.%f")
    assert new_timestamp >= last_timestamp, "Clock went backwards!"
    if new_timestamp == last_timestamp:
        assert last_counter < 999, "Too many IDs in one timestamp!"
        last_counter += 1
        return f"{last_timestamp}-{last_counter:03}"
    last_timestamp = new_timestamp
    last_counter = 0
    return last_timestamp


"""Design for recursive chunking.

We start with a tree node. Potentially it is one block.
If it is "statement-like", we walk its descendants that are statement-like,
in pre-order, and if any is a class or function definition, we make it a sub-chunk.
We apply the same thing recursively to the sub-chunk.
When we identify a non-splittable node, we create a Chunk out of it.

There's a recursive function that takes in text and a tree, and returns a list of Chunks,
representing that tree in pre-order (parents preceding children).
"""

# TODO: Turn the recursive chunk creation into a class

def ast_iter_child_statement_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Iterate over the children of a node."""
    for name, field in ast.iter_fields(node):
        if isinstance(field, ast.AST):
            yield field
        elif isinstance(field, list):
            for item in field:
                if isinstance(item, ast.AST):
                    yield item

def ast_walk(node: ast.AST) -> Iterator[ast.AST]:
    """
    Recursively yield all statement-ish nodes in the tree starting at *node*
    (including *node* itself). (Adapted from ast.walk() in the Python stdlib.)
    """
    todo = deque([node])
    while todo:
        node = todo.popleft()
        todo.extend(ast_iter_child_statement_nodes(node))
        yield node  # Yield in pre-order


def extract_text(text: str, node: ast.AST) -> str:
    """Extract the text of a node from the source code."""
    lines = text.splitlines(keepends=True)  # TODO: pre-compute this earlier
    # TODO: Include immediately preceding comment block?
    return "".join(lines[node.lineno - 1 : node.end_lineno - 1])


def create_chunks_recursively(text: str, tree: ast.AST, parent_id: IdType, parent_slot: int) -> list[Chunk]:
    """Recursively create chunks for the AST."""
    chunks = []
    for node in ast_walk(tree):
        if node is tree:
            continue
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.ClassDef):
            node_id = generate_id()
            node_text = extract_text(text, node)
            node_blobs = [node_text]
            chunk = Chunk(node_id, node, node_blobs, parent_id, parent_slot, [])
            chunks.append(chunk)
            chunks.extend(create_chunks_recursively(text, node, node_id, parent_slot))
            parent_slot += 1
            # TODO: Remove from parent blob
    return chunks


def chunker(text: str) -> list[Chunk]:  # Returns a toplevel chunk for the whole file
    """Chunker for Python code."""
    tree = ast.parse(text)  # TODO: Error handling
    # Universal attributes: lineno, col_offset, end_lineno, end_col_offset
    # print(ast.dump(tree, indent=4))
    root_id = generate_id()
    root = Chunk(root_id, tree, [text], "", 0, [])  # Children filled in below
    chunks = create_chunks_recursively(text, tree, root_id, 0)
    root.children = [chunk.id for chunk in chunks]
    chunks.insert(0, root)
    return chunks


def test():
    import sys
    if len(sys.argv) != 2:
        print("Usage: python chunker.py <filename>")
        sys.exit(1)
    filename = sys.argv[1]
    with open(filename, "r") as f:
        text = f.read()
    chunks = chunker(text)
    # for chunk in chunks:
    #     print(chunk)
    print(json.dumps(chunks, indent=4, default=custom_json))


if __name__ == "__main__":
    test()
