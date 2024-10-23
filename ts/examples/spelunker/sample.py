def create_chunks(text: str, node: ast.AST) -> Chunk:
    """Recursively create chunks for the AST."""
    root_id = generate_id()
    root_text = text
    blobs = [text]
    return Chunk(root_id, blobs, "", 0, [])
