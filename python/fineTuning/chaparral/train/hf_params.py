# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
import json

@dataclass
class HFTrainerParams:

    output_dir: str
    per_device_train_batch_size: int = 8
    gradient_accumulation_steps: int = 1
    num_train_epochs: int = 3
    learning_rate: float = 1e-4
    optim: str = "adamw_torch"
    warmup_steps: int = 0
    logging_steps: int = 2
    save_strategy: str = "epoch"

    @classmethod
    def from_dict(cls, data: dict) -> "HFTrainerParams":
        return cls(**data)

    def to_dict(self):
        return { x: getattr(self, x) for x in self.__dataclass_fields__.keys() }

@dataclass
class HFParams:

    hf_trainer_params: HFTrainerParams
    cutoff_length: int = 256
    # model_name: str= "google/gemma-2-2b"
    model_name: str= "meta-llama/Llama-3.2-1B-Instruct"
    cache_dir: str = "./hf_cache"
    pad_token: str = "!"
    use_peft: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "HFParams":
        hf_trainer_params = HFTrainerParams.from_dict(data.get("hf_trainer_params", {}))
        data["hf_trainer_params"] = hf_trainer_params
        return cls(**data)
    
    @classmethod
    def from_file(cls, file_path: str) -> "HFParams":
        with open(file_path, "r") as f:
            return cls.from_dict(json.load(f))
