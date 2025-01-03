# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from transformers import TextStreamer
from peft.mapping import get_peft_model
from peft.peft_model import PeftModel
from peft.tuners.lora import LoraConfig
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    PreTrainedTokenizer,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
    PreTrainedModel,
)
from trl import SFTTrainer
from chaparral.train.hf_params import HFParams
import torch
from dotenv import load_dotenv
from chaparral.models.data import ChapparalDataset
from unsloth import to_sharegpt, standardize_sharegpt, apply_chat_template
from datasets import load_dataset

class HFModel:

    model_name: str
    model: PreTrainedModel
    tokenizer: PreTrainedTokenizer
    params: HFParams
    train_set: ChapparalDataset | None = None
    peft_model: PeftModel | None = None

    def __init__(self, params: HFParams):
        self.params = params
        self.model_name = params.model_name

    def init_peft(self):
        LORA_R = 16
        LORA_ALPHA = 16
        LORA_DROPOUT = 0

        config = LoraConfig(
            r=LORA_R,
            lora_alpha=LORA_ALPHA,
            # Only Training the "expert" layers
            # target_modules=["w1", "w2", "w3"],
            target_modules = [
                "q_proj", 
                "k_proj", 
                "v_proj", 
                "o_proj",
                "gate_proj", 
                "up_proj", 
                "down_proj",
            ],
            lora_dropout=LORA_DROPOUT,
            bias="none",
            task_type="CAUSAL_LM"
        )
        peft_model = get_peft_model(self.model, config)
        if not isinstance(peft_model, PeftModel):
            raise ValueError("PEFT model not initialized properly")

        self.peft_model = peft_model

    def save_model(self, path: str):
        self.model.save_pretrained(path)
        self.tokenizer.save_pretrained(path)

    def load_local_model(self, path: str):
        self.model = AutoModelForCausalLM.from_pretrained(
            path,
            torch_dtype=torch.float32,
            cache_dir=self.params.cache_dir,
            load_in_4bit=True if self.params.use_peft else False,
            device_map="auto",
        )

        self.tokenizer = AutoTokenizer.from_pretrained(
            path,
            cache_dir=self.params.cache_dir
        )

        self.tokenizer.pad_token = self.params.pad_token
        if self.params.use_peft:
            self.init_peft()

    def prep_dataset(self, dataset: ChapparalDataset):
        data_dict = dataset.format_v2()
        print(data_dict["items"][0])
        training_data = list(map(lambda x: self.tokenize(str(x)), data_dict["items"]))
        return training_data

    def predict(self, dataset: ChapparalDataset):
        test_data = self.prep_dataset(dataset)

        trainer = Trainer(
            model=self.model,
            data_collator=DataCollatorForLanguageModeling(
                self.tokenizer, mlm=False)
        )

        # this needs to be a pytorch dataset?
        # instead of a huggingface dataset.
        # adding the ignore flag here because the type
        # is correct
        return trainer.predict(test_data) #type: ignore

    def evaluate(self, dataset: ChapparalDataset):
        eval_data = self.prep_dataset(dataset)

        trainer = Trainer(
            model=self.model,
            eval_dataset=eval_data,
            data_collator=DataCollatorForLanguageModeling(
                self.tokenizer, mlm=False)
        )

        return trainer.evaluate()

    def generate(self, prompt: str, max_length: int = 3000):
        encoding = self.tokenizer.encode_plus(prompt, return_tensors="pt")
        print(encoding)
        input_ids = encoding.input_ids
        # move the input tensor to the device
        input_ids = input_ids.to(self.model.device)
        output = self.model.generate(input_ids, max_length=max_length,
                                     attention_mask=encoding.attention_mask.to(
                                         self.model.device),
                                     pad_token_id=self.tokenizer.eos_token_id)
        return self.tokenizer.decode(output[0], skip_special_tokens=True)
    
    def generate_v2(self, message: str):
        messages = [
            {"role": "user", "content": message},
        ]
        input_ids = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt = True,
            return_tensors = "pt",
        ).to("cuda")

        text_streamer = TextStreamer(self.tokenizer, skip_prompt = True)
        _ = self.model.generate(input_ids, streamer = text_streamer, max_new_tokens = 128, pad_token_id = tokenizer.eos_token_id)

    def load_model(self):
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            torch_dtype=torch.float32,
            cache_dir=self.params.cache_dir,
            # load_in_4bit=True if self.params.use_peft else False,
            # device_map="auto",
        )

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_name,
            cache_dir=self.params.cache_dir
        )

        self.tokenizer.pad_token = self.tokenizer.eos_token
        if self.params.use_peft:
            self.init_peft()

    def load_training_data(self, dataset: ChapparalDataset):
        self.train_set = dataset

    def init_data(self):
        dataset = load_dataset("hlucco/npr_gpt4o_train_200")["train"]
        print(dataset.column_names)

        dataset = to_sharegpt(
            dataset,
            merged_prompt = "{instruction}",
            output_column_name = "output",
            conversation_extension = 3, # Select more to handle longer conversations
        )

        dataset = standardize_sharegpt(dataset)

        chat_template = """Below are some instructions that describe some tasks. Write responses that appropriately complete each request.

### Instruction:
{INPUT}

### Response:
{OUTPUT}"""

        dataset = apply_chat_template(
            dataset,
            tokenizer = self.tokenizer,
            chat_template = chat_template,
            # default_system_message = "You are a helpful assistant", << [OPTIONAL]
        )

        self.dataset = dataset

    def tokenize(self, text: str):
        eos_token = self.tokenizer.eos_token
        if not isinstance(eos_token, str):
            eos_token = self.tokenizer.decode(eos_token)

        return self.tokenizer(
            text + eos_token,
            truncation=True,
        )
    
    def sft_train(self):
        trainer = SFTTrainer(
            model = self.model,
            tokenizer = self.tokenizer,
            train_dataset = self.dataset,
            dataset_text_field = "text",
            max_seq_length = 8024,
            dataset_num_proc = 2,
            packing = False, # Can make training 5x faster for short sequences.
            args = TrainingArguments(
                per_device_train_batch_size = 2,
                gradient_accumulation_steps = 4,
                warmup_steps = 5,
                max_steps = 10,
                # num_train_epochs = 1, # For longer training runs!
                learning_rate = 2e-4,
                fp16 = True,
                bf16 = False,
                logging_steps = 1,
                optim = "adamw_8bit",
                weight_decay = 0.01,
                lr_scheduler_type = "linear",
                seed = 3407,
                output_dir = "outputs",
                report_to = "none", # Use this for WandB etc
            ),
        )
        self.model.config.use_cache = False
        print("training has started...")
        trainer.train()

    def train(self):

        # training_data = self.prep_dataset(self.train_set)

        print("initialization of trainer")
        trainer = Trainer(
            model=self.model,
            tokenizer=self.tokenizer,
            # train_dataset=training_data,
            train_dataset=self.dataset,
            dataset_text_field = "text",
            max_seq_length = 8024,
            args=TrainingArguments(
                fp16=True,
                max_steps=20,
                weight_decay=0.01,
                lr_scheduler_type="linear",
                seed=3407,
                per_device_train_batch_size=self.params.hf_trainer_params.per_device_train_batch_size,
                gradient_accumulation_steps=self.params.hf_trainer_params.gradient_accumulation_steps,
                num_train_epochs=self.params.hf_trainer_params.num_train_epochs,
                learning_rate=self.params.hf_trainer_params.learning_rate,
                logging_steps=self.params.hf_trainer_params.logging_steps,
                optim=self.params.hf_trainer_params.optim,
                save_strategy=self.params.hf_trainer_params.save_strategy,
                output_dir=self.params.hf_trainer_params.output_dir
            ),
            data_collator=DataCollatorForLanguageModeling(
                self.tokenizer, mlm=False)
        )

        self.model.config.use_cache = False
        print("training has started...")
        trainer.train()

    def print_trainable_parameters(self):
        trainable_params = sum(p.numel()
                               for p in self.model.parameters() if p.requires_grad)
        all_params = sum(p.numel() for p in self.model.parameters())
        print(f"trainable params: {trainable_params} || all params: {all_params} || trainable%: {100 * trainable_params / all_params}")


if __name__ == "__main__":
    load_dotenv(".env")
    params = HFParams.from_file("params.json")
    model = HFModel(params)
    print("Model loaded successfully ✅")
    model.print_trainable_parameters()
