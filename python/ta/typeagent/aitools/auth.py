#!/usr/bin/env python
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
import time
from typing import Any, NamedTuple

from azure.identity import DefaultAzureCredential


@dataclass
class TokenProvider:
    # Note that the Python library has no async support!

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.access_token: Any | None = (
            None  # AccessToken | None, but pyright complains.
        )

    def get_token(self) -> str:
        if self.access_token and self.access_token.expires_on >= time.time() + 300:
            return self.access_token.token
        return self.refresh_token()

    def refresh_token(self) -> str:
        self.access_token = self.credential.get_token(
            "https://cognitiveservices.azure.com/.default"
        )
        assert self.access_token is not None
        return self.access_token.token


if __name__ == "__main__":
    print(f"export AZURE_OPENAI_API_TOKEN={TokenProvider().get_token()}")
