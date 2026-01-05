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
import matplotlib.pyplot as plt

@dataclass
class Message:
    content: str
    speaker: str
    section: 'Section' = None

@dataclass
class Section:
    title: str
    messages: list[Message] = field(default_factory=list)
    words: set[str] = field(default_factory=set)
    total_words: int = 0

@dataclass
class Word:
    word: str
    messages: list[Message] = field(default_factory=list)

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
all_messages = []
word_dict = {}
total_words = 0
all_unique_words = set()

for i, message in enumerate(messages):
    section_title = message['section_title']
    if section_title not in sections:
        sections[section_title] = Section(title=section_title)
    
    content = message['content']
    speaker = message['speaker']
    msg = Message(content=content, speaker=speaker, section=sections[section_title])
    sections[section_title].messages.append(msg)
    all_messages.append(msg)
    
    # Extract words from this message
    words = word_pattern.findall(content.lower())
    word_count = len(words)
    total_words += word_count
    sections[section_title].total_words += word_count
    sections[section_title].words.update(words)
    all_unique_words.update(words)
    
    # Track which messages contain each word
    unique_message_words = set(words)
    for word in unique_message_words:
        if word not in word_dict:
            word_dict[word] = Word(word=word)
        word_dict[word].messages.append(msg)
    
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

total_message_references = sum(len(word.messages) for word in word_dict.values())
avg_messages_per_word = total_message_references / len(word_dict) if word_dict else 0

print(f"Total sections: {section_count}")
print(f"Average messages per section: {avg_messages_per_section:.2f}")
print(f"Total words: {total_words}")
print(f"Unique words across all messages: {len(all_unique_words)}")
print(f"Average unique words per section: {avg_words_per_section:.2f}")
print(f"Average word density ratio (unique/total per section): {avg_word_density * 100:.3f}%")
print(f"Overall word density ratio (unique/total across all messages): {len(all_unique_words) / total_words * 100:.3f}%")
print(f"Average messages per unique word: {avg_messages_per_word:.2f}")

# Analyze message count distribution
message_counts = [len(word.messages) for word in word_dict.values()]
message_counts_sorted = sorted(message_counts, reverse=True)

# Get top 5 words by message count
top_words = sorted(word_dict.values(), key=lambda w: len(w.messages), reverse=True)[:5]
print(f"\nTop 5 words by message count:")
for i, word_obj in enumerate(top_words, 1):
    print(f"  {i}. '{word_obj.word}': {len(word_obj.messages)} messages")

# Calculate statistics
import statistics
median_messages = statistics.median(message_counts) if message_counts else 0
max_messages = max(message_counts) if message_counts else 0
min_messages = min(message_counts) if message_counts else 0

print(f"\nMessage count statistics per word:")
print(f"  Min: {min_messages}")
print(f"  Median: {median_messages:.2f}")
print(f"  Max: {max_messages}")

# Count words appearing in 4 or fewer messages
words_4_or_fewer = sum(1 for count in message_counts if count <= 4)
percentage_4_or_fewer = (words_4_or_fewer / len(message_counts) * 100) if message_counts else 0
print(f"  Words appearing in ≤4 messages: {words_4_or_fewer} ({percentage_4_or_fewer:.2f}%)")

# Count words appearing in 16 or fewer messages
words_16_or_fewer = sum(1 for count in message_counts if count <= 16)
percentage_16_or_fewer = (words_16_or_fewer / len(message_counts) * 100) if message_counts else 0
print(f"  Words appearing in ≤16 messages: {words_16_or_fewer} ({percentage_16_or_fewer:.2f}%)")

# Plot distribution of messages per word
print("\nCreating distribution plot...")
message_counts = [len(word.messages) for word in word_dict.values()]

plt.figure(figsize=(12, 6))
plt.hist(message_counts, bins=50, edgecolor='black', alpha=0.7)
plt.xlabel('Number of Messages per Word')
plt.ylabel('Number of Words')
plt.title('Distribution of Message Counts per Unique Word')
plt.yscale('log')  # Use log scale for y-axis since distribution is likely skewed
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('word_message_distribution.png', dpi=150)
print(f"Distribution plot saved to word_message_distribution.png")

# Print elapsed time
elapsed_time = time.time() - start_time
print(f"\nTotal processing time: {elapsed_time:.2f} seconds")