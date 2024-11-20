# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from transformers import (
    AutoModelForCausalLM, 
    AutoTokenizer, 
    Trainer, 
    TrainingArguments, 
    DataCollatorForLanguageModeling
)
from peft import LoraConfig, get_peft_model
from chaparral.models.data import Dataset
import torch
from dotenv import load_dotenv

class HFModel:

    model_name: str
    model: AutoModelForCausalLM
    tokenizer: AutoTokenizer
    train_set: Dataset | None = None

    def __init__(self, model_name):
        self.model_name = model_name

    def init_peft(self):
        LORA_R = 8
        LORA_ALPHA = 2 * LORA_R
        LORA_DROPOUT = 0.1

        config = LoraConfig(
            r=LORA_R,
            lora_alpha=LORA_ALPHA,
            target_modules=[ "w1", "w2", "w3"],  #Only Training the "expert" layers
            lora_dropout=LORA_DROPOUT,
            bias="none",
            task_type="CAUSAL_LM"
        )

        self.model = get_peft_model(self.model, config)

    def load_model(self):
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            torch_dtype=torch.float32,
            cache_dir="./hf_cache",
            load_in_4bit=True,
            device_map="auto"
        )

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_name,
            cache_dir="./hf_cache"
        )

        self.init_peft()

    def load_training_data(self, dataset: Dataset):
        self.train_set = dataset

    def tokenize(self, text: str):
        return self.tokenizer(
            text + self.tokenizer.eos_token,
            truncation=True,
            padding="max_length"
        )

    def train(self):

        if not self.train_set:
            raise ValueError("No training data loaded")

        data_dict = self.train_set.format(self.model_name)
        training_data = list(map(lambda x: self.tokenize(str(x)), data_dict["infoPairs"]))

        trainer = Trainer(
            model = self.model,
            train_dataset = training_data,
            args = TrainingArguments(
                per_device_train_batch_size=2,
                gradient_accumulation_steps=4,
                num_train_epochs=6,
                learning_rate=1e-4,
                logging_steps=2,
                optim="adamw_torch",
                save_strategy="epoch",
                output_dir="hf_output"
            ),
            data_collator = DataCollatorForLanguageModeling(self.tokenizer, mlm=False)
        )
        
        self.model.config.use_cache = False
        trainer.train()

    def print_trainable_parameters(self):
        trainable_params = sum(p.numel() for p in self.model.parameters() if p.requires_grad)
        all_params = sum(p.numel() for p in self.model.parameters())
        print(f"trainable params: {trainable_params} || all params: {all_params} || trainable%: {100 * trainable_params / all_params}")

if __name__ == "__main__":
    load_dotenv(".env")
    model = HFModel("mistralai/Mixtral-8x7b-v0.1")
    print("Model loaded successfully ✅")
    model.print_trainable_parameters()