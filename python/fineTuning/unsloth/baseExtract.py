# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from argparse import ArgumentParser
import sys
parser = ArgumentParser(description="Extract keywords from dataset using NLTK-RAKE.")
parser.add_argument("--dataset_path", type=str, default='/data/npr/npr_chunks_no_embedding.json', 
help="Path to the dataset file.")
# output_file
parser.add_argument("--output_file", type=str, default='reformatted_data.txt', 
help="Path to the output file.")
parser.add_argument("--maxMsgPct", type=float, default=0.005,
help="Maximum message percentage threshold for filtering words (0.0-1.0). Words appearing in more than this percentage of messages will be filtered out. Default: 0.1")
args = parser.parse_args(sys.argv[1:])
dataset_path = args.dataset_path
output_file = args.output_file
maxMsgPct = args.maxMsgPct

# Validate maxMsgPct
if not 0.0 <= maxMsgPct <= 1.0:
    print(f"Error: maxMsgPct must be between 0.0 and 1.0, got {maxMsgPct}")
    sys.exit(1)

import json
import re
import time
from dataclasses import dataclass, field
import matplotlib.pyplot as plt
import tiktoken

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
    proper_nouns: set[str] = field(default_factory=set)
    total_words: int = 0
    total_chars: int = 0
    total_tokens: int = 0

@dataclass
class Word:
    word: str
    messages: list[Message] = field(default_factory=list)

def extract_proper_nouns(text):
    """Extract proper nouns (capitalized words not at sentence start).
    Prefers 2-word proper nouns over 1-word. Excludes pronoun 'I' and its contractions.
    Handles quoted dialogue to avoid capturing sentence-initial words within quotes."""
    # Split into sentences (simple approach)
    sentences = re.split(r'[.!?]+\s+', text)
    proper_nouns = set()
    
    # Words to exclude: pronoun "I" and its contractions
    excluded_words = {"I", "I'd", "I'll", "I'm", "I've"}
    
    for sentence in sentences:
        words = sentence.split()
        i = 1  # Start from index 1 to skip sentence-initial capitalization
        
        while i < len(words):
            # Clean word of punctuation
            word1 = re.sub(r'[^\w\']+$', '', words[i])
            word1_clean = re.sub(r'^[^\w\']+', '', word1)
            
            # Check if previous word ends with opening quote (indicating quoted sentence start)
            is_quote_start = False
            if i > 0:
                prev_word = words[i - 1]
                # Check if previous word ends with quote marks
                if prev_word and prev_word[-1] in ['"', '"', '"', '\'']:
                    is_quote_start = True
            
            # Check if capitalized and not an excluded word or quote-initial word
            if word1_clean and word1_clean[0].isupper() and word1_clean not in excluded_words and not is_quote_start:
                # Check for 2-word proper noun
                if i + 1 < len(words):
                    word2 = re.sub(r'[^\w\']+$', '', words[i + 1])
                    word2_clean = re.sub(r'^[^\w\']+', '', word2)
                    if word2_clean and word2_clean[0].isupper() and word2_clean not in excluded_words:
                        # Found 2-word proper noun
                        proper_nouns.add(f"{word1_clean} {word2_clean}")
                        i += 2
                        continue
                
                # Single-word proper noun
                proper_nouns.add(word1_clean)
            i += 1
    
    return proper_nouns

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

# Initialize tiktoken encoder
print("Initializing tokenizer...")
encoder = tiktoken.encoding_for_model("gpt-4")

# Create dictionary of sections and process messages
print("Processing messages and extracting words...")
word_pattern = re.compile(r"\b[\w']+\b")
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
    
    # Extract proper nouns
    proper_nouns = extract_proper_nouns(content)
    sections[section_title].proper_nouns.update(proper_nouns)
    
    # Build set of words to exclude (all words from proper nouns, lowercased)
    words_to_exclude = set()
    for proper_noun in proper_nouns:
        words_to_exclude.update(word.lower() for word in proper_noun.split())
    
    # Extract words from this message
    words = word_pattern.findall(content.lower())
    # Filter out numbers less than 100 and proper noun words
    words = [w for w in words if not (w.isdigit() and int(w) < 100) and w not in words_to_exclude]
    word_count = len(words)
    char_count = len(content)
    token_count = len(encoder.encode(content))
    total_words += word_count
    sections[section_title].total_words += word_count
    sections[section_title].total_chars += char_count
    sections[section_title].total_tokens += token_count
    sections[section_title].words.update(words)
    all_unique_words.update(words)
    
    # Track which messages contain each word
    unique_message_words = set(words)
    for word in unique_message_words:
        if word not in word_dict:
            word_dict[word] = Word(word=word)
        word_dict[word].messages.append(msg)
    
print(f"Processing complete.")

# Filter words based on maxMsgPct
print(f"\nFiltering words with message percentage > {maxMsgPct * 100:.1f}%...")
total_message_count = len(all_messages)
max_messages_threshold = maxMsgPct * total_message_count

# Filter overall word_dict
words_before_filter = len(word_dict)
filtered_word_dict = {word: word_obj for word, word_obj in word_dict.items() 
                      if len(word_obj.messages) < max_messages_threshold}
words_filtered = words_before_filter - len(filtered_word_dict)
print(f"  Filtered {words_filtered} words from overall word list ({words_before_filter} -> {len(filtered_word_dict)})")

# Filter each section's word set
for section in sections.values():
    words_to_remove = {word for word in section.words 
                       if word not in filtered_word_dict}
    section.words -= words_to_remove

# Update word_dict to filtered version
word_dict = filtered_word_dict
all_unique_words = set(word_dict.keys())

print(f"Filtering complete.")

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

# Calculate token statistics
import statistics
token_counts = [section.total_tokens for section in sections.values()]
median_tokens_per_section = statistics.median(token_counts) if token_counts else 0
mean_tokens_per_section = statistics.mean(token_counts) if token_counts else 0

# Calculate proper noun statistics
all_unique_proper_nouns = set()
for section in sections.values():
    all_unique_proper_nouns.update(section.proper_nouns)

avg_proper_nouns_per_section = sum(len(section.proper_nouns) for section in sections.values()) / section_count if section_count > 0 else 0

print(f"Total sections: {section_count}")
print(f"Average messages per section: {avg_messages_per_section:.2f}")
print(f"Total words: {total_words}")
print(f"Unique words across all messages: {len(all_unique_words)}")
print(f"Average unique words per section: {avg_words_per_section:.2f}")
print(f"Total unique proper nouns across all messages: {len(all_unique_proper_nouns)}")
print(f"Average unique proper nouns per section: {avg_proper_nouns_per_section:.2f}")
print(f"Average word density ratio (unique/total per section): {avg_word_density * 100:.3f}%")
print(f"Overall word density ratio (unique/total across all messages): {len(all_unique_words) / total_words * 100:.3f}%")
print(f"Average messages per unique word: {avg_messages_per_word:.2f}")
print(f"Mean tokens per section: {mean_tokens_per_section:.2f}")
print(f"Median tokens per section: {median_tokens_per_section:.2f}")

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

# Plot distribution for words with 50 or fewer messages
message_counts_50_or_less = [count for count in message_counts if count <= 50]
plt.figure(figsize=(12, 6))
plt.hist(message_counts_50_or_less, bins=50, edgecolor='black', alpha=0.7)
plt.xlabel('Number of Messages per Word')
plt.ylabel('Number of Words')
plt.title('Distribution of Message Counts per Unique Word (≤50 messages)')
plt.yscale('log')
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('word_message_distribution_50_or_less.png', dpi=150)
print(f"Zoomed distribution plot saved to word_message_distribution_50_or_less.png")

# Write data to output file
print(f"\nWriting data to {output_file}...")
output_data = []
for section in sections.values():
    section_data = {
        "title": section.title,
        "messages": [
            {
                "content": msg.content,
                "speaker": msg.speaker
            }
            for msg in section.messages
        ],
        "words": sorted(list(section.words)),
        "proper_nouns": sorted(list(section.proper_nouns)),
        "word_count": section.total_words,
        "char_count": section.total_chars,
        "token_count": section.total_tokens
    }
    output_data.append(section_data)

with open(output_file, 'w') as f:
    json.dump(output_data, f, indent=2)
print(f"Data written to {output_file}")

# Print elapsed time
elapsed_time = time.time() - start_time
print(f"\nTotal processing time: {elapsed_time:.2f} seconds")