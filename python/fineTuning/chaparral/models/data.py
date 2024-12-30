# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
from chaparral.models.knowledge import KnowledgeResponse
from chaparral.models.mistral import MixtralFormat
from chaparral.prompts.knowledge import get_knowledge_prompt
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
class ChapparalDataset:
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

        train_set = ChapparalDataset(self.prompt, self.info_pairs[:train_size])
        eval_set = ChapparalDataset(self.prompt, self.info_pairs[train_size:])

        return train_set, eval_set
    
    def format_v2(self, eos_token: str = "\n\n####\n\n") -> dict:
        items = []
        for pair in self.info_pairs:
            items.append({
                "prompt" : get_knowledge_prompt(pair.message)+eos_token,
                "completion" : pair.knowledge.to_str()
            })

        return {
            "items": items
        }

    
    def format(self, model_name: str) -> dict:
        format_map = {
            "mistralai/Mixtral-8x7b-v0.1": MixtralFormat,
            "google/gemma-2-2b": MixtralFormat,
            "meta-llama/Llama-3.1-8B": MixtralFormat,
            "meta-llama/Llama-3.2-3B-Instruct": MixtralFormat,
            "meta-llama/Llama-3.2-1B-Instruct": MixtralFormat
        }

        dataset_type = format_map.get(model_name, None)

        if not dataset_type:
            raise ValueError("Unsupported model name")
        
        return dataset_type.from_dataset(self).to_dict()
    
    def get_filled_prompt(self, message: str) -> str:
        return get_knowledge_prompt(message)
