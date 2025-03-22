# TODO

- For secindex.build_secondary_indexes():
  - build_related_terms_index()
    - Requires implementing term_to_related_terms_index -- relatedtermsindex.py (500 lines)
  - build_message_index() -- messageindex.py (180 lines)

- Serialization everywhere (do this last, it is very tedious and may change)

- Remove operations in various indexes (never used, so low priority)

- Settings everywhere (not very important, low priority)

- Various `# type: ignore` comments (usually need to make some I-interface generic in actual message/index/etc.)
