# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A chunker for Python code using the ast module.

- Basic idea: Chunks can nest!
- Each chunk consists of some text from the file,
  with 0 or more *placeholders* where other chunks are to be inserted.
- Each chunk has an ID and some metadata.
- For an inner (child) chunk, the metadata contains (at least)
  the ID of the parent chunk.
- For a parent chunk, the metadata includes
  a list of inner chunk IDs.
- Reconstruction of the full text is done using line numbers.
- Sometimes the hierarchy has more than two levels.
- Not every inner chunk needs to be a function or class,
  though that is where we start.
- Both at the top level and within functions and classes,
  we could have additional chunks, e.g. blocks of imports, docstrings,
  blocks of variable definitions, comments, etc.
- The chunker has some freedom of how to break code into chunks,
  in order to keep the chunks manageable in number and size.
"""

import ast
from dataclasses import dataclass
import datetime
import json
import os
import sys
from typing import Any, Iterator


ChunkId = str


@dataclass
class Blob:
    """A sequence of text lines plus some metadata."""

    start: int  # 0-based!
    lines: list[str]
    breadcrumb: ChunkId | None = None  # Chunk id if breadcrumb

    def to_dict(self) -> dict[str, object]:
        result: dict[str, Any] = {
            "start": self.start,
            "lines": self.lines,
        }
        if self.breadcrumb:
            result["breadcrumb"] = self.breadcrumb
        return result


@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""

    chunkId: ChunkId
    treeName: str  # AST node name
    codeName: str  # function/class/module name (TODO: dotted names)
    blobs: list[Blob]  # Blobs around the placeholders

    # For inner chunks:
    parentId: ChunkId

    # For outer chunks:
    children: list[ChunkId]  # len() is one less than len(blobs)

    # Used by custom_json() below.
    def to_dict(self) -> dict[str, object]:
        return {
            "chunkId": self.chunkId,
            "treeName": self.treeName,
            "codeName": self.codeName,
            "blobs": self.blobs,
            "parentId": self.parentId,
            "children": self.children,
        }


@dataclass
class ChunkedFile:
    """A file with chunks."""

    fileName: str
    chunks: list[Chunk]

    def to_dict(self) -> dict[str, object]:
        return {
            "fileName": self.fileName,
            "chunks": self.chunks,
        }


@dataclass
class ErrorItem:
    """An error item."""

    error: str
    fileName: str
    output: str | None = None

    def to_dict(self) -> dict[str, str]:
        result = {"error": self.error, "filename": self.fileName}
        if self.output:
            result["output"] = self.output
        return result


# Support for JSON serialization of Chunks


def custom_json(obj: object) -> dict[str, object]:
    if hasattr(obj, "to_dict"):
        return obj.to_dict()  # type: ignore
    else:
        raise TypeError(f"Cannot JSON serialize object of type {type(obj)}")


last_ts: datetime.datetime = datetime.datetime.now()


def generate_id() -> ChunkId:
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
    return next_ts.strftime("%Y%m%d-%H%M%S.%f")


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


def extract_code_name(node: ast.AST) -> str:
    """Extract  function or class name of a node."""
    if isinstance(node, ast.FunctionDef):
        return node.name
    elif isinstance(node, ast.ClassDef):
        return node.name
    return ""


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
    return Blob(start, lines[start:end])  # type: ignore


def summarize_chunk(chunk: Chunk, node: ast.AST) -> list[str]:
    """Summarize a chunk into a summary to insert in the parent chunk."""
    summary: list[str] = []
    indent: str = node.col_offset * " "  # type: ignore
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
        decorators: list[ast.AST] = node.decorator_list  # type: ignore
        for d in decorators:
            if isinstance(d, ast.Name) and d.id == "property":
                summary.append(f"{indent}@property")
    if isinstance(node, ast.FunctionDef):
        summary.append(f"{indent}def {node.name}...")
    elif isinstance(node, ast.ClassDef):
        summary.append(f"{indent}class {node.name}...")
    return summary


def create_chunks_recursively(
    lines: list[str], tree: ast.AST, parent: Chunk
) -> list[Chunk]:
    """Recursively create chunks for the AST."""
    chunks: list[Chunk] = []

    for node in ast_iter_child_statement_nodes(tree):
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.ClassDef):
            node_name = node.__class__.__name__
            code_name = extract_code_name(node)
            node_id = generate_id()
            node_blob = extract_blob(lines, node)
            node_blobs = [node_blob]
            chunk = Chunk(node_id, node_name, code_name, node_blobs, parent.chunkId, [])
            chunks.append(chunk)
            chunks.extend(create_chunks_recursively(lines, node, chunk))
            parent.children.append(node_id)

            # Split last parent.blobs[-1] into two, leaving a gap for the new Chunk
            # and put a breadcrumb blob in between.
            parent_blob: Blob = parent.blobs.pop()
            parent_start: int = parent_blob.start
            parent_end: int = parent_blob.start + len(parent_blob.lines)
            first_blob, last_blob = chunk.blobs[0], chunk.blobs[-1]
            first_start = first_blob.start
            last_end = last_blob.start + len(last_blob.lines)
            if parent_start <= last_end and last_end <= parent_end:
                parent.blobs.append(Blob(parent_start, lines[parent_start:first_start]))
                summary = summarize_chunk(chunk, node)
                if summary:
                    parent.blobs.append(Blob(first_start, summary, breadcrumb=node_id))
                parent.blobs.append(Blob(last_end, lines[last_end:parent_end]))

    return chunks


def chunker(text: str, tree: ast.AST, module_name: str) -> list[Chunk]:
    """Chunker for Python code."""

    lines = text.splitlines(keepends=True)
    # print(ast.dump(tree, indent=4, include_attributes=True))

    # Handcraft the root node
    root_id = generate_id()
    root_name = tree.__class__.__name__
    root = Chunk(root_id, root_name, module_name, [Blob(0, lines)], "", [])

    chunks = create_chunks_recursively(lines, tree, root)
    chunks.insert(0, root)
    return chunks


def chunkify(text: str, filename: str) -> list[Chunk] | ErrorItem:
    try:
        tree = ast.parse(text, filename=filename)
    except SyntaxError as e:
        return ErrorItem(repr(e), filename)

    module_name = os.path.basename(filename)
    if module_name.endswith(".py"):
        module_name = module_name[:-3]
    chunks = chunker(text, tree, module_name)

    # Remove leading and trailing blank lines from blobs,
    # only keeping non-empty blobs.
    # Need to do this last because blob lists are mutated above.
    for chunk in chunks:
        blobs = chunk.blobs
        new_blobs: list[Blob] = []
        for blob in blobs:
            lines = blob.lines
            while lines and lines[-1].isspace():
                lines.pop()
            while lines and lines[0].isspace():
                blob.start += 1
                lines.pop(0)
            if lines:
                new_blobs.append(blob)
        chunk.blobs = new_blobs

    return chunks


def main():
    if len(sys.argv) < 2:
        print("Usage: python chunker.py FILE [FILE] ...")
        return 2

    items: list[ErrorItem | ChunkedFile] = []
    for filename in sys.argv[1:]:
        try:
            with open(filename) as f:
                text = f.read()
        except IOError as err:
            items.append(ErrorItem(str(err), filename))
        else:
            result = chunkify(text, filename)
            if isinstance(result, ErrorItem):
                items.append(result)
            else:
                # Only keep non-empty chunks, and the root node (empty parentId).
                chunks = [
                    chunk for chunk in result if chunk.blobs or not chunk.parentId
                ]
                items.append(ChunkedFile(filename, chunks))

    print(json.dumps(items, default=custom_json, indent=2))
    return 0


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
