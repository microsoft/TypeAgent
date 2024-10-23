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


IdType = str


@dataclass
class Chunk:
    """A chunk at any level of nesting (root, inner, leaf)."""

    id: IdType
    blobs: list[str]  # Blobs around the placeholders

    # The rest is metadata

    # For inner chunks:
    parent_id: IdType
    parent_slot: int  # Index of preceding blob in parent chunk

    # For outer chunks:
    children: list[IdType]  # len() is one less than len(blobs)


last_id: IdType = ""

def generate_id() -> IdType:
    """Generate a new unique ID.
    
    IDs are really timestamps formatted as YYYY/MM/DD-HH:MM:SS.UUUUUU[-NNN],
    where UUUUUU is microseconds and NNN is optionally added to make IDs unique.
    """
    global last_id
    now = datetime.datetime.now()
    new_id = now.strftime("%Y/%m/%d-%H:%M:%S.%f")
    assert new_id >= last_id[:len(new_id)], "Clock went backwards!"
    template = new_id
    counter = 1
    while new_id <= last_id:
        assert counter < 1000, "Too many IDs in the same microsecond!"
        new_id = f"{template}-{counter:03}"
        counter += 1
    last_id = new_id
    return new_id    


def chunker(text: str) -> Chunk:  # Returns a toplevel chunk for the whole file
    """Chunker for Python code."""
    tree = ast.parse(text)  # TODO: Error handling
    print(ast.dump(tree, indent=4, include_attributes=True))
    return create_chunks(text, tree)


def create_chunks(text: str, node: ast.AST) -> Chunk:
    """Recursively create chunks for the AST."""
    root_id = generate_id()
    root_text = text
    blobs = [text]
    return Chunk(root_id, blobs, "", 0, [])


def test():
    import sys
    if len(sys.argv) != 2:
        print("Usage: python chunker.py <filename>")
        sys.exit(1)
    filename = sys.argv[1]
    with open(filename, "r") as f:
        text = f.read()
    chunk = chunker(text)
    print(chunk)


if __name__ == "__main__":
    test()
