# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from transformers import AutoModelForCausalLM
import torch
from dotenv import load_dotenv

class Model:

    model_name: str
    value: any

    def __init__(self, model_name):
        self.model_name = model_name
        self.value = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float32,
            cache_dir="./hf_cache",
            load_in_4bit=True
        )

if __name__ == "__main__":
    load_dotenv(".env")
    model = Model("mistralai/Mixtral-8x7b-v0.1")
    print("Model loaded successfully ✅")