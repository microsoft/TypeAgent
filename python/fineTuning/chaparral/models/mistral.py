# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from typing import List, Literal
from dataclasses import dataclass

@dataclass
class MixtralTurn:
    role: Literal["user", "assistant"]
    content: str

@dataclass
class MixtralChat:
    messages: List[MixtralTurn]