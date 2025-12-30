# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from unsloth import FastLanguageModel
import torch
from knowledgePrompt import get_knowledge_prompt
max_seq_length = 8192 # Choose any! We auto support RoPE Scaling internally!
dtype = None # None for auto detection. Float16 for Tesla T4, V100, Bfloat16 for Ampere+
load_in_4bit = True # Use 4bit quantization to reduce memory usage. Can be False.

# 4bit pre quantized models we support for 4x faster downloading + no OOMs.
fourbit_models = [
    "unsloth/Meta-Llama-3.1-8B-bnb-4bit",      # Llama-3.1 15 trillion tokens model 2x faster!
    "unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit",
    "unsloth/Meta-Llama-3.1-70B-bnb-4bit",
    "unsloth/Meta-Llama-3.1-405B-bnb-4bit",    # We also uploaded 4bit for 405b!
    "unsloth/Mistral-Nemo-Base-2407-bnb-4bit", # New Mistral 12b 2x faster!
    "unsloth/Mistral-Nemo-Instruct-2407-bnb-4bit",
    "unsloth/mistral-7b-v0.3-bnb-4bit",        # Mistral v3 2x faster!
    "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    "unsloth/Phi-3.5-mini-instruct",           # Phi-3.5 2x faster!
    "unsloth/Phi-3-medium-4k-instruct",
    "unsloth/gemma-2-9b-bnb-4bit",
    "unsloth/gemma-2-27b-bnb-4bit",            # Gemma 2x faster!
] # More models at https://huggingface.co/unsloth

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/Phi-4", # Choose any 4bit model from above
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
    # token = "hf_...", # use one if using gated models like meta-llama/Llama-2-7b-hf
)

model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # Choose any number > 0 ! Suggested 8, 16, 32, 64, 128
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj",],
    lora_alpha = 16,
    lora_dropout = 0, # Supports any, but = 0 is optimized
    bias = "none",    # Supports any, but = "none" is optimized
    # [NEW] "unsloth" uses 30% less VRAM, fits 2x larger batch sizes!
    use_gradient_checkpointing = "unsloth", # True or "unsloth" for very long context
    random_state = 3407,
    use_rslora = False,  # We support rank stabilized LoRA
    loftq_config = None, # And LoftQ
)

from datasets import Dataset
import pandas as pd
from unsloth import to_sharegpt
# load an array of JSON objects with properties knowledge and message
import json

# reduce token count by simplifying the knowledge structure
def simplify_knowledge(knowledge):
    # change fields ending in EntityName like subjectEntityName to single words like subject
    for action in knowledge['actions']:
        if 'subjectEntityName' in action:
            action['subject'] = action.pop('subjectEntityName')
        if 'objectEntityName' in action:
            action['object'] = action.pop('objectEntityName')
        if 'indirectObjectEntityName' in action:
            action['indirectObject'] = action.pop('indirectObjectEntityName')
        # also subjectEntityFacet to subjectFacet
        if 'subjectEntityFacet' in action:
            action['subjectFacet'] = action.pop('subjectEntityFacet')
    # remove the inverseActions field if it exists
    if 'inverseActions' in knowledge:
        knowledge.pop('inverseActions')
    # if any fields have value "none", remove those fields
    for action in knowledge['actions']:
        keys_to_remove = [key for key, value in action.items() if value == "none"]
        for key in keys_to_remove:
            action.pop(key)
    return knowledge

with open('/data/gpt4o_train_3200.json') as f:
  rawData = json.load(f)
# loop through the JSON objects and print the properties
data = []
for i in range(len(rawData)):
  simplified = simplify_knowledge(rawData[i]['knowledge'])
  data.append({'output': json.dumps(simplified,separators=(',', ':')), 'instruction': get_knowledge_prompt(rawData[i]['message']), 'input': '', 'text': ''})
# create a hugging face dataset from the JSON objects with the knowledge property becoming the output property and the message property becoming the instruction property
dataset = Dataset.from_pandas(pd.DataFrame(data=data))
print(dataset.column_names)
print(dataset[0])

from unsloth import to_sharegpt
dataset = to_sharegpt(
    dataset,
    merged_prompt = "{instruction}[[\nYour input is:\n{input}]]",
    output_column_name = "output",
    conversation_extension = 1, # Select more to handle longer conversations
)

from unsloth import standardize_sharegpt
dataset = standardize_sharegpt(dataset)

chat_template = """Below are some instructions that describe some tasks. Write responses that appropriately complete each request.

### Instruction:
{INPUT}

### Response:
{OUTPUT}"""

from unsloth import apply_chat_template
dataset = apply_chat_template(
    dataset,
    tokenizer = tokenizer,
    chat_template = chat_template,
    # default_system_message = "You are a helpful assistant", << [OPTIONAL]
)

from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import is_bfloat16_supported
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False, # Can make training 5x faster for short sequences.
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = -1,
        num_train_epochs = 1, # For longer training runs!
        learning_rate = 2e-4,
        fp16 = not is_bfloat16_supported(),
        bf16 = is_bfloat16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
        report_to = "none", # Use this for WandB etc
    ),
)

trainer_stats = trainer.train()
#@title Show final memory and time stats
used_memory = round(torch.cuda.max_memory_reserved() / 1024 / 1024 / 1024, 3)
used_memory_for_lora = round(used_memory, 3)
used_percentage = round(used_memory         /48*100, 3)
lora_percentage = round(used_memory_for_lora/48*100, 3)
print(f"{trainer_stats.metrics['train_runtime']} seconds used for training.")
print(f"{round(trainer_stats.metrics['train_runtime']/60, 2)} minutes used for training.")
print(f"Peak reserved memory = {used_memory} GB.")
print(f"Peak reserved memory for training = {used_memory_for_lora} GB.")
print(f"Peak reserved memory % of max memory = {used_percentage} %.")
print(f"Peak reserved memory for training % of max memory = {lora_percentage} %.")

saveDir = "/data/phi-4-lora-3200"  # Change this to your desired save directory
model.save_pretrained(saveDir)  # Local saving
tokenizer.save_pretrained(saveDir)

#print(tokenizer._ollama_modelfile)
# Save to 8bit Q8_0
#model.save_pretrained_gguf("llama_Q8_0_model", tokenizer,quantization_method = "q8_0")