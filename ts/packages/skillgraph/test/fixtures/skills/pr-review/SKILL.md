---
name: pr-review
description: Review a PR, address comments, and reply to reviewers.
---

# PR review

1. Fetch open comments:

   ```bash
   python scripts/fetch_comments.py --pr 123 --since 7d
   ```

2. Apply [the checklist](references/checklist.md#correctness).
3. Draft replies per [replies](references/replies.md) using skill://sounds-human.
4. Post: `node scripts/post_reply.js --pr 123 --body-file reply.md`
5. Confirm state:

   ```bash
   gh pr comments 123
   git log --oneline --graph -n 5
   ```

6. Polish tone with skill://tone-police.
