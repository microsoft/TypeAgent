from unsloth import FastLanguageModel
import sys
import os
from knowledgePrompt import get_knowledge_prompt
from argparse import ArgumentParser
parser = ArgumentParser(description="Run batch inference with a language model.")
parser.add_argument("--model_path", type=str, default = "/data/phi-4-lora-3200",help="Path to the pre-trained model.")
parser.add_argument("--dataset_path", type=str, default = '/data/npr_chunks_no_embedding_seed127_samples5000_test.json', help="Path to the dataset file.")
parser.add_argument("--output_file", type=str, default = 'batchOutput.txt', help="Path to the output file.")
args = parser.parse_args(sys.argv[1:])
model_path = args.model_path
dataset_path = args.dataset_path
output_file = args.output_file
model, tokenizer = FastLanguageModel.from_pretrained(
  model_name = model_path,
  max_seq_length = 8192,
  dtype = None,
  load_in_4bit = True,
)
        
FastLanguageModel.for_inference(model) # Enable native 2x faster inference


# load an array of JSON objects with properties knowledge and message
import json
from datasets import Dataset
import pandas as pd

with open(dataset_path) as f:
  rawData = json.load(f)
chats = []
for i in range(len(rawData)):
    message = rawData[i]['speaker']+": "+rawData[i]['content']
    chats.append([{"role": "user", "content": get_knowledge_prompt(message)}])

def print_responses(responses, time_taken, file):
    for response in responses:
        # find string 'Response:' and print the text after it
        start = response.find('Response:')
        if start != -1:
            text = response[start + len('Response:'):].strip()
            if text:
                file.write(text + "\n")
                token_count = len(tokenizer.encode(text))
                # print token count and tokens per second
                file.write(f"Token count: {token_count} at {token_count / time_taken:.2f} tokens/sec\n")

import time

count = 0
with open(output_file, 'w', encoding='utf-8') as f:
    for message in chats:
        # record start time
        start = time.time()
        model_inputs = tokenizer.apply_chat_template(
            [message],
            add_generation_prompt = True,
            return_tensors = "pt",
        ).to("cuda")

        output = model.generate(model_inputs, max_new_tokens = 1024, pad_token_id = tokenizer.eos_token_id)
        output_text = tokenizer.decode(output[0], skip_special_tokens = True)
        # record end time
        end = time.time()
        f.write(rawData[count]['speaker']+": "+rawData[count]['content'] + "\n")
        count += 1
        print_responses([output_text], end-start, f)
        # print end time with two decimal places
        f.write("Time taken: {:.2f}sec\n".format(end - start))
        f.write("\n" + "="*80 + "\n\n")

print(f"Batch inference complete. Results written to {output_file}")
print(f"Processed {count} messages")
