# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pytest

from typeagent.aitools import auth


@pytest.fixture(scope="session")
def needs_auth():
    auth.load_dotenv()
