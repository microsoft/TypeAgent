#!/usr/bin/env python
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
import time
from typing import Any, Protocol
import os

from azure.identity import DefaultAzureCredential
import dotenv


class IAccessToken(Protocol):
    @property
    def token(self) -> str: ...
    @property
    def expires_on(self) -> int:  # Posix timestamp
        ...


@dataclass
class AzureTokenProvider:
    # Note that the Python library has no async support!

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.access_token: IAccessToken | None = None

    def get_token(self) -> str:
        if self.needs_refresh():
            return self.refresh_token()
        else:
            assert self.access_token is not None
            return self.access_token.token

    def refresh_token(self) -> str:
        self.access_token = self.credential.get_token(
            "https://cognitiveservices.azure.com/.default"
        )
        assert self.access_token is not None
        return self.access_token.token

    def needs_refresh(self) -> bool:
        return (
            self.access_token is None
            or self.access_token.expires_on - time.time() <= 300
        )


_shared_token_provider: AzureTokenProvider | None = None


def get_shared_token_provider() -> AzureTokenProvider:
    global _shared_token_provider
    if _shared_token_provider is None:
        _shared_token_provider = AzureTokenProvider()
    return _shared_token_provider


def load_dotenv() -> None:
    dirname = os.path.dirname
    here = dirname(__file__)
    typeagent = dirname(here)
    package = dirname(typeagent)
    python = dirname(package)
    repo_top = dirname(python)
    env_path = os.path.join(repo_top, "ts", ".env")
    dotenv.load_dotenv(env_path)
    # for k, v in os.environ.items():
    #     if "KEY" in k:
    #         print(f"{k}={v!r}")
    # print(f"Loaded {env_path}")


if __name__ == "__main__":
    # Usage: eval `./typeagent/aitools/aith.py`
    print(f"export AZURE_OPENAI_API_KEY={AzureTokenProvider().get_token()}")
