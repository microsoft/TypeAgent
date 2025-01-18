# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from typing import List, Literal, Type
from dataclasses import dataclass

@dataclass
class MixtralTurn:
    role: Literal["user", "assistant"]
    content: str

    def to_dict(self):
        return {
            "role": self.role,
            "content": self.content
        }

@dataclass
class MixtralChat:
    messages: List[MixtralTurn]

    def to_dict(self):
        return {
            "messages": [message.to_dict() for message in self.messages]
        }

@dataclass
class MixtralFormat:
    items: List[MixtralChat]

    @classmethod
    def from_dataset(cls, dataset: "Type[ChapparalDataset]") -> "MixtralFormat":
        items = []
        for pair in dataset.info_pairs:
            populated_message = dataset.get_filled_prompt(pair.message)
            knowledge_dict_str = pair.knowledge.to_str()

            user_turn = MixtralTurn("user", populated_message)
            assistant_turn = MixtralTurn("assistant", knowledge_dict_str)

            chat = MixtralChat([user_turn, assistant_turn])
            items.append(chat)
        
        return cls(items)
    
    def to_dict(self):
        return {
            "items": [chat.to_dict() for chat in self.items]
        }
