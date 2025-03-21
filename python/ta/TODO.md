# TODO

- For secindex.build_secondary_indexes():
  - build_related_terms_index()
  - build_message_index()

- Serialization everywhere (do this last, it is very tedious and may change)

- Remove operations in various indexes (never used, so low priority)

- Settings everywhere (not very important, low priority)

- Various `# type: ignore` comments (usually need to make some I-interface generic in actual message/index/etc.)

- In import_podcast.Podcast:
  - _build_participant_aliases
  - _collect_participant_aliases
  - _build_caches
