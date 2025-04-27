# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import sys

from fixtures import needs_auth


def test_import_podcast(needs_auth):
    from typeagent.podcasts.__main__ import main

    old_argv = sys.argv
    sys.argv = ["testdata/Episode_53_AdrianTchaikovsky_index"]
    try:
        asyncio.run(main())
    finally:
        sys.argv = old_argv
