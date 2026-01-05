from argparse import ArgumentParser
import sys
parser = ArgumentParser(description="Extract keywords from dataset using NLTK-RAKE.")
parser.add_argument("--dataset_path", type=str, default='/data/npr/npr_chunks_no_embedding.json', 
help="Path to the dataset file.")
# output_file
parser.add_argument("--output_file", type=str, default='baseExtraction.txt', 
help="Path to the output file.")
args = parser.parse_args(sys.argv[1:])
dataset_path = args.dataset_path
output_file = args.output_file

import json
import re
import time
from dataclasses import dataclass, field

@dataclass
class Message:
    content: str
    speaker: str

@dataclass
class Section:
    title: str
    messages: list[Message] = field(default_factory=list)
    words: set[str] = field(default_factory=set)
    total_words: int = 0

def read_and_count_messages(file_path):
    """Read the JSON file and return the array and its count."""
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    count = len(data)
    print(f"Total messages in dataset: {count}")
    
    return data, count

# Start timing
start_time = time.time()

# Read the dataset
messages, message_count = read_and_count_messages(dataset_path)

# Create dictionary of sections and process messages
print("Processing messages and extracting words...")
word_pattern = re.compile(r'\b\w+\b')
sections = {}
total_words = 0
all_unique_words = set()

for i, message in enumerate(messages):
    section_title = message['section_title']
    if section_title not in sections:
        sections[section_title] = Section(title=section_title)
    
    content = message['content']
    speaker = message['speaker']
    msg = Message(content=content, speaker=speaker)
    sections[section_title].messages.append(msg)
    
    # Extract words from this message
    words = word_pattern.findall(content.lower())
    word_count = len(words)
    total_words += word_count
    sections[section_title].total_words += word_count
    sections[section_title].words.update(words)
    all_unique_words.update(words)
    
print(f"Processing complete.")

# Print statistics
section_count = len(sections)
total_messages = sum(len(section.messages) for section in sections.values())
avg_messages_per_section = total_messages / section_count if section_count > 0 else 0
avg_words_per_section = sum(len(section.words) for section in sections.values()) / section_count if section_count > 0 else 0

# Calculate word density ratio for each section
word_density_ratios = []
for section in sections.values():
    if section.total_words > 0:
        ratio = len(section.words) / section.total_words
        word_density_ratios.append(ratio)

avg_word_density = sum(word_density_ratios) / len(word_density_ratios) if word_density_ratios else 0

print(f"Total sections: {section_count}")
print(f"Average messages per section: {avg_messages_per_section:.2f}")
print(f"Total words: {total_words}")
print(f"Unique words across all messages: {len(all_unique_words)}")
print(f"Average unique words per section: {avg_words_per_section:.2f}")
print(f"Average word density ratio (unique/total per section): {avg_word_density:.4f}")

# Print elapsed time
elapsed_time = time.time() - start_time
print(f"\nTotal processing time: {elapsed_time:.2f} seconds")