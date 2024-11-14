# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
from chaparral.models.knowledge import KnowledgeResponse
from typing import List

@dataclass
class InfoPair:
    message: str
    knowledge: KnowledgeResponse

    @classmethod
    def from_dict(cls, data: dict):

        message = data.get("message", None)
        knowledge = data.get("knowledge", None)

        if not message:
            raise ValueError("Invalid info pair: missing message")
        
        if not knowledge:
            raise ValueError("Invalid info pair: missing knowledge")
        
        knowledge = KnowledgeResponse.from_dict(knowledge)

        return cls(message, knowledge)
    
    def to_dict(self):
        return {
            "message": self.message,
            "knowledge": self.knowledge.to_dict()
        }

@dataclass
class Dataset:
    prompt: str
    info_pairs: list[InfoPair]

    @classmethod
    def from_dict(cls, data: dict):

        prompt = data.get("prompt", None)
        info_pairs = data.get("infoPairs", None)

        if not prompt:
            raise ValueError("Invalid dataset: missing prompt")
        
        if not info_pairs:
            raise ValueError("Invalid dataset: missing info pairs")
        
        info_pairs = [InfoPair.from_dict(pair) for pair in info_pairs]

        return cls(prompt, info_pairs)
    
    @classmethod
    def from_list(cls, data: List):
        prompt = ""
        info_pairs = [InfoPair.from_dict(pair) for pair in data]

        return cls(prompt, info_pairs)
    
    def to_dict(self):
        return {
            "prompt": self.prompt,
            "infoPairs": [pair.to_dict() for pair in self.info_pairs]
        }
    
    def create_train_eval_sets(self, split_ratio: float = 0.8):
        train_size = int(len(self.info_pairs) * split_ratio)

        train_set = Dataset(self.prompt, self.info_pairs[:train_size])
        eval_set = Dataset(self.prompt, self.info_pairs[train_size:])

        return train_set, eval_set