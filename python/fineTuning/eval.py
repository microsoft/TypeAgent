# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from chaparral.util.datareader import DataReader
from chaparral.train.hf_model import HFModel
from chaparral.train.hf_params import HFParams
import argparse
import torch
from unsloth import FastLanguageModel
from transformers import AutoModelForCausalLM, AutoTokenizer, TextStreamer


def parse_args():
    parser = argparse.ArgumentParser(
        description="Fine-tune a model with given dataset.")
    parser.add_argument("--dataset_file", help="Path to the dataset file.")
    parser.add_argument("--model_name", help="Name of the model to fine-tune.")
    parser.add_argument("--params", help="Path to params file")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    dataset_file = args.dataset_file
    params_file = args.params

    # load params
    params = HFParams.from_file(params_file)

    # load dataset
    dataset = DataReader().load_text_file(dataset_file)

    # format data into train and eval sets
    train_set, eval_set = dataset.create_train_eval_sets()


    # model = HFModel(params)
    # Load the model
    """
    model = AutoModelForCausalLM.from_pretrained(
        # "./hf_output_llama_1b_half_epoch/checkpoint-10",
        # "./test_output"
        # "meta-llama/Llama-3.2-1B-Instruct"
        "./llama_peft_1/checkpoint-60"
    )
    """

    model = AutoModelForCausalLM.from_pretrained(
        "./llama_peft_1/checkpoint-20",
        load_in_4bit = True,
    )
    tokenizer = AutoTokenizer.from_pretrained(
        # "google/gemma-2-2b",
        # "meta-llama/Llama-3.2-1B-Instruct"
        "./llama_peft_1/checkpoint-20"
        # "./test_output"
    )

    messages = [                    # Change below!
        {"role": "user", "content": dataset.get_filled_prompt("The quick brown fox jumps over the lazy dog")},
    ]
    input_ids = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt = True,
        return_tensors = "pt",
    ).to("cuda")

    text_streamer = TextStreamer(tokenizer, skip_prompt = True)
    _ = model.generate(input_ids, streamer = text_streamer, max_new_tokens = 128, pad_token_id = tokenizer.eos_token_id)
    exit()

    print("model loaded")

    # Load the tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        # "google/gemma-2-2b",
        # "meta-llama/Llama-3.2-1B-Instruct"
        "./llama_peft_1/checkpoint-60"
        # "./test_output"
    )

    print("Model loaded")

    # Prepare the input text
    # input_text = "[Game Minecraft 1.19.2] Player Asked: How do I craft a bed? Answer:"
    input_text = dataset.get_filled_prompt("The quick brown fox jumps over the lazy dog")

    # Tokenize the input text
    inputs = tokenizer(input_text, return_tensors="pt")

    text_streamer = TextStreamer(tokenizer, skip_prompt = True)

    # Generate output (you can adjust max_length and other parameters as needed)
    _ = model.generate(inputs["input_ids"], streamer=text_streamer, pad_token_id = tokenizer.eos_token_id, max_length=5000)
    exit()

    # Decode the generated tokens to get the output text
    output_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    print("Output Text:", output_text)