# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from rake_nltk import Rake
import sys
import os
from argparse import ArgumentParser
import nltk
from nltk import word_tokenize, pos_tag, ne_chunk
from nltk.tree import Tree
import spacy
import yake
from keybert import KeyBERT

parser = ArgumentParser(description="Extract keywords from dataset using NLTK-RAKE.")
parser.add_argument("--dataset_path", type=str, default='/data/npr_chunks_no_embedding_seed127_samples5000_test.json', help="Path to the dataset file.")
parser.add_argument("--max_length", type=int, default=3, help="Maximum number of words in a keyword phrase.")
parser.add_argument("--output_file", type=str, default='extraction.txt', help="Path to the output file.")
args = parser.parse_args(sys.argv[1:])
dataset_path = args.dataset_path
max_length = args.max_length
output_file = args.output_file

# Initialize RAKE with max_length configuration
rake = Rake(max_length=max_length)

# Initialize YAKE keyword extractor
# Parameters: language, max_ngram_size, deduplication_threshold, number of keywords
yake_extractor = yake.KeywordExtractor(lan="en", n=max_length, dedupLim=0.9, top=20)

# Initialize KeyBERT model
keybert_model = KeyBERT()

# Load spacy model
nlp = spacy.load("en_core_web_sm")

# Load an array of JSON objects with properties like speaker and content
import json
import time

with open(dataset_path) as f:
    rawData = json.load(f)

def extract_keywords_rake(text):
    """Extract keywords from text using RAKE."""
    rake.extract_keywords_from_text(text)
    
    # Get ranked phrases with scores (already limited by max_length configuration)
    keywords = rake.get_ranked_phrases_with_scores()
    
    return keywords

def extract_keywords_yake(text):
    """Extract keywords from text using YAKE."""
    # YAKE returns (keyword, score) where lower scores are better
    # Reverse to (score, keyword) to match RAKE format
    keywords = [(score, keyword) for keyword, score in yake_extractor.extract_keywords(text)]
    
    return keywords

def extract_keywords_keybert(text):
    """Extract keywords from text using KeyBERT."""
    # KeyBERT returns (keyword, score) where higher scores are better
    # Reverse to (score, keyword) to match RAKE format
    keywords = keybert_model.extract_keywords(text, keyphrase_ngram_range=(1, max_length), top_n=20)
    keywords = [(score, keyword) for keyword, score in keywords]
    
    return keywords

def extract_named_entities(text):
    """Extract named entities from text using NLTK."""
    # Tokenize and tag parts of speech
    tokens = word_tokenize(text)
    pos_tags = pos_tag(tokens)
    
    # Extract named entities
    named_entities = ne_chunk(pos_tags, binary=False)
    
    # Parse the tree to extract entities with their types
    entities = []
    for chunk in named_entities:
        if isinstance(chunk, Tree):
            entity_type = chunk.label()
            entity_text = " ".join([token for token, pos in chunk.leaves()])
            entities.append((entity_text, entity_type))
    
    return entities

def extract_phrases(text):
    """Extract noun phrases and verb phrases from text using spacy."""
    doc = nlp(text)
    
    # Extract noun phrases
    noun_phrases = [chunk.text for chunk in doc.noun_chunks]
    
    # Extract verb phrases (tokens with verb POS and their dependents)
    verb_phrases = []
    for token in doc:
        if token.pos_ == "VERB":
            # Get the verb and its direct object/complement
            phrase_tokens = [token.text]
            for child in token.children:
                if child.dep_ in ("dobj", "attr", "prep", "pobj", "advmod", "aux", "auxpass", "neg"):
                    phrase_tokens.append(child.text)
            if len(phrase_tokens) > 1:
                verb_phrases.append(" ".join(phrase_tokens))
            else:
                verb_phrases.append(token.text)
    
    return noun_phrases, verb_phrases

def extract_dependencies(text):
    """Extract dependency relations from text using spacy with sentence boundaries."""
    doc = nlp(text)
    
    # Process each sentence separately for better dependency analysis
    sentences_deps = []
    for sent in doc.sents:
        sent_deps = []
        for token in sent:
            # Extract: token, POS tag, dependency relation, head token
            dep_info = {
                'token': token.text,
                'pos': token.pos_,
                'dep': token.dep_,
                'head': token.head.text,
                'head_pos': token.head.pos_
            }
            sent_deps.append(dep_info)
        sentences_deps.append({
            'sentence': sent.text,
            'dependencies': sent_deps
        })
    
    return sentences_deps, doc

def lemmatize_rake_keyphrases_from_doc(rake_keywords, doc):
    """Lemmatize RAKE keyphrases using existing spacy doc by finding token offsets."""
    lemmatized = []
    
    for score, keyphrase in rake_keywords:
        keyphrase_lower = keyphrase.lower()
        keyphrase_tokens = keyphrase_lower.split()
        
        # Try to find matching sequence of tokens in doc
        matched_tokens = []
        doc_tokens = [t for t in doc if not t.is_punct]
        
        for i in range(len(doc_tokens)):
            # Check if we have a match starting at position i
            temp_tokens = []
            
            for j, kp_token in enumerate(keyphrase_tokens):
                if i + j < len(doc_tokens):
                    if doc_tokens[i + j].text.lower() == kp_token:
                        temp_tokens.append(doc_tokens[i + j])
                    else:
                        temp_tokens.clear()
                        break
                else:
                    temp_tokens.clear()
                    break
            
            if len(temp_tokens) == len(keyphrase_tokens):
                matched_tokens = temp_tokens
                break
        
        # Get lemmas from matched tokens
        if matched_tokens:
            lemmas = [token.lemma_ for token in matched_tokens]
            lemmatized_phrase = " ".join(lemmas)
        else:
            # If no match found, just keep the original lowercased
            lemmatized_phrase = keyphrase_lower
        
        lemmatized.append((score, keyphrase, lemmatized_phrase))
    
    return lemmatized

def lemmatize_yake_keyphrases_from_doc(yake_keywords, doc):
    """Lemmatize YAKE keyphrases using existing spacy doc by finding token offsets."""
    lemmatized = []
    
    for score, keyphrase in yake_keywords:
        keyphrase_lower = keyphrase.lower()
        keyphrase_tokens = keyphrase_lower.split()
        
        # Try to find matching sequence of tokens in doc
        matched_tokens = []
        doc_tokens = [t for t in doc if not t.is_punct]
        
        for i in range(len(doc_tokens)):
            # Check if we have a match starting at position i
            temp_tokens = []
            
            for j, kp_token in enumerate(keyphrase_tokens):
                if i + j < len(doc_tokens):
                    if doc_tokens[i + j].text.lower() == kp_token:
                        temp_tokens.append(doc_tokens[i + j])
                    else:
                        temp_tokens.clear()
                        break
                else:
                    temp_tokens.clear()
                    break
            
            if len(temp_tokens) == len(keyphrase_tokens):
                matched_tokens = temp_tokens
                break
        
        # Get lemmas from matched tokens
        if matched_tokens:
            lemmas = [token.lemma_ for token in matched_tokens]
            lemmatized_phrase = " ".join(lemmas)
        else:
            # If no match found, just keep the original lowercased
            lemmatized_phrase = keyphrase_lower
        
        lemmatized.append((score, keyphrase, lemmatized_phrase))
    
    return lemmatized

def analyze_rake_phrase_relationships(rake_keywords, doc):
    """Analyze relationships between RAKE keyphrases using spacy doc."""
    # Extract just the keyword text (not scores)
    rake_phrases = [keyword.lower() for score, keyword in rake_keywords]
    
    # Get noun and verb phrases from doc
    noun_phrases = [chunk.text for chunk in doc.noun_chunks]
    
    verb_phrases = []
    for token in doc:
        if token.pos_ == "VERB":
            phrase_tokens = [token.text]
            for child in token.children:
                if child.dep_ in ("dobj", "attr", "prep", "pobj", "advmod", "aux", "auxpass", "neg"):
                    phrase_tokens.append(child.text)
            if len(phrase_tokens) > 1:
                verb_phrases.append(" ".join(phrase_tokens))
    
    # Find phrases that contain 2+ RAKE keyphrases
    relationships = []
    
    for np in noun_phrases:
        np_lower = np.lower()
        matching_keyphrases = [kp for kp in rake_phrases if kp in np_lower]
        if len(matching_keyphrases) >= 2:
            relationships.append({
                'type': 'noun phrase',
                'phrase': np,
                'keyphrases': matching_keyphrases
            })
    
    for vp in verb_phrases:
        vp_lower = vp.lower()
        matching_keyphrases = [kp for kp in rake_phrases if kp in vp_lower]
        if len(matching_keyphrases) >= 2:
            relationships.append({
                'type': 'verb phrase',
                'phrase': vp,
                'keyphrases': matching_keyphrases
            })
    
    return relationships

def analyze_yake_phrase_relationships(yake_keywords, doc):
    """Analyze relationships between YAKE keyphrases using spacy doc."""
    # Extract just the keyword text (not scores)
    yake_phrases = [keyword.lower() for score, keyword in yake_keywords]
    
    # Get noun and verb phrases from doc
    noun_phrases = [chunk.text for chunk in doc.noun_chunks]
    
    verb_phrases = []
    for token in doc:
        if token.pos_ == "VERB":
            phrase_tokens = [token.text]
            for child in token.children:
                if child.dep_ in ("dobj", "attr", "prep", "pobj", "advmod", "aux", "auxpass", "neg"):
                    phrase_tokens.append(child.text)
            if len(phrase_tokens) > 1:
                verb_phrases.append(" ".join(phrase_tokens))
    
    # Find phrases that contain 2+ YAKE keyphrases
    relationships = []
    
    for np in noun_phrases:
        np_lower = np.lower()
        matching_keyphrases = [kp for kp in yake_phrases if kp in np_lower]
        if len(matching_keyphrases) >= 2:
            relationships.append({
                'type': 'noun phrase',
                'phrase': np,
                'keyphrases': matching_keyphrases
            })
    
    for vp in verb_phrases:
        vp_lower = vp.lower()
        matching_keyphrases = [kp for kp in yake_phrases if kp in vp_lower]
        if len(matching_keyphrases) >= 2:
            relationships.append({
                'type': 'verb phrase',
                'phrase': vp,
                'keyphrases': matching_keyphrases
            })
    
    return relationships

def is_common_phrase(phrase):
    """Check if phrase contains only common words (no proper nouns or unusual words)."""
    doc = nlp(phrase)
    for token in doc:
        # Skip punctuation
        if token.is_punct:
            continue
        # Check if it's a proper noun
        if token.pos_ == "PROPN":
            return False
        # Check if it's an unusual word (not in common vocabulary)
        # Use combination of: not a stop word, and has low frequency rank
        if not token.is_stop and token.is_alpha:
            # If word has very high rank (rare) or no rank info, consider it unusual
            if token.rank > 10000 or token.rank == 0:
                return False
    return True

def print_keywords(keywords, time_taken, file, extractor_name="RAKE", lemmatized_data=None):
    """Write extracted keywords to file."""
    if keywords:
        file.write(f"{extractor_name} Keywords:\n")
        
        if lemmatized_data:
            # Print with lemmatized forms
            for score, original, lemmatized in lemmatized_data:
                lemma_suffix = f" → {lemmatized}" if lemmatized != original.lower() else ""
                file.write(f"  - {original} (score: {score:.2f}){lemma_suffix}\n")
        else:
            # Print without lemmatized forms
            for score, word in keywords:
                file.write(f"  - {word} (score: {score:.2f})\n")
        
        file.write(f"Total keywords: {len(keywords)} extracted in {time_taken:.4f} seconds\n")
    else:
        file.write(f"No {extractor_name} keywords extracted\n")

def print_named_entities(entities, file):
    """Write extracted named entities to file."""
    if entities:
        file.write("\nNamed Entities:\n")
        for entity_text, entity_type in entities:
            file.write(f"  - {entity_text} ({entity_type})\n")
        file.write(f"Total named entities: {len(entities)}\n")
    else:
        file.write("\nNo named entities extracted\n")

def print_phrases(noun_phrases, verb_phrases, file):
    """Write extracted phrases to file."""
    file.write("\nNoun Phrases:\n")
    if noun_phrases:
        for phrase in noun_phrases:
            file.write(f"  - {phrase}\n")
        file.write(f"Total noun phrases: {len(noun_phrases)}\n")
    else:
        file.write("  No noun phrases extracted\n")
    
    file.write("\nVerb Phrases:\n")
    if verb_phrases:
        for phrase in verb_phrases:
            file.write(f"  - {phrase}\n")
        file.write(f"Total verb phrases: {len(verb_phrases)}\n")
    else:
        file.write("  No verb phrases extracted\n")

def print_dependencies(sentences_deps, time_taken, file):
    """Write dependency relations to file."""
    file.write(f"\nDependency Relations (extracted in {time_taken:.4f}sec):\n")
    if sentences_deps:
        for i, sent_info in enumerate(sentences_deps, 1):
            file.write(f"\n  Sentence {i}: {sent_info['sentence']}\n")
            for dep in sent_info['dependencies']:
                file.write(f"    {dep['token']} ({dep['pos']}) --[{dep['dep']}]--> {dep['head']} ({dep['head_pos']})\n")
        file.write(f"\nTotal sentences: {len(sentences_deps)}\n")
    else:
        file.write("  No dependencies extracted\n")

def print_rake_relationships(relationships, file):
    """Write RAKE keyphrase relationships to file."""
    file.write("\nRAKE Keyphrase Relationships:\n")
    if relationships:
        for rel in relationships:
            keyphrases_str = ', '.join([f"[{kp}]" for kp in rel['keyphrases']])
            file.write(f"  {rel['type']}: \"{rel['phrase']}\" contains {keyphrases_str}\n")
        file.write(f"Total relationships found: {len(relationships)}\n")
    else:
        file.write("  No relationships found (no phrases contain 2+ RAKE keyphrases)\n")

def print_yake_relationships(relationships, file):
    """Write YAKE keyphrase relationships to file."""
    file.write("\nYAKE Keyphrase Relationships:\n")
    if relationships:
        for rel in relationships:
            keyphrases_str = ', '.join([f"[{kp}]" for kp in rel['keyphrases']])
            file.write(f"  {rel['type']}: \"{rel['phrase']}\" contains {keyphrases_str}\n")
        file.write(f"Total relationships found: {len(relationships)}\n")
    else:
        file.write("  No relationships found (no phrases contain 2+ YAKE keyphrases)\n")

count = 0
rake_total_time = 0
yake_total_time = 0
keybert_total_time = 0
dep_total_time = 0

with open(output_file, 'w', encoding='utf-8') as f:
    for item in rawData:
        # Get message text
        message = item['speaker'] + ": " + item['content']
        
        # Time RAKE extraction
        rake_start = time.time()
        rake_keywords = extract_keywords_rake(message)
        rake_end = time.time()
        rake_time = rake_end - rake_start
        rake_total_time += rake_time
        
        # Time YAKE extraction
        yake_start = time.time()
        yake_keywords = extract_keywords_yake(message)
        yake_end = time.time()
        yake_time = yake_end - yake_start
        yake_total_time += yake_time
        
        # Time KeyBERT extraction
        keybert_start = time.time()
        keybert_keywords = extract_keywords_keybert(message)
        keybert_end = time.time()
        keybert_time = keybert_end - keybert_start
        keybert_total_time += keybert_time
        
        # Time dependency extraction (also returns doc for analysis)
        dep_start = time.time()
        dependencies, spacy_doc = extract_dependencies(message)
        dep_end = time.time()
        dep_time = dep_end - dep_start
        dep_total_time += dep_time
        
        # Lemmatize RAKE keyphrases using the already-computed spacy doc
        rake_lemmatized = lemmatize_rake_keyphrases_from_doc(rake_keywords, spacy_doc)
        
        # Lemmatize YAKE keyphrases using the already-computed spacy doc
        yake_lemmatized = lemmatize_yake_keyphrases_from_doc(yake_keywords, spacy_doc)
        
        # Analyze RAKE keyphrase relationships using the spacy doc
        rake_relationships = analyze_rake_phrase_relationships(rake_keywords, spacy_doc)
        
        # Analyze YAKE keyphrase relationships using the spacy doc
        yake_relationships = analyze_yake_phrase_relationships(yake_keywords, spacy_doc)
        
        # Extract named entities
        # entities = extract_named_entities(message)
        
        # Extract noun and verb phrases
        #noun_phrases, verb_phrases = extract_phrases(message)
        
        # Write original message
        f.write(f"\n{'='*80}\n")
        f.write(f"Message {count + 1}:\n")
        f.write(message + "\n")
        f.write('-' * 80 + "\n")
        
        # Write RAKE keywords with lemmatization
        print_keywords(rake_keywords, rake_time, f, "RAKE", lemmatized_data=rake_lemmatized)
        
        # Write YAKE keywords with lemmatization
        f.write("\n")
        print_keywords(yake_keywords, yake_time, f, "YAKE", lemmatized_data=yake_lemmatized)
        
        # Write KeyBERT keywords
        f.write("\n")
        print_keywords(keybert_keywords, keybert_time, f, "KeyBERT")
        
        # Write dependencies
        print_dependencies(dependencies, dep_time, f)
        
        # Write RAKE keyphrase relationships
        print_rake_relationships(rake_relationships, f)
        
        # Write YAKE keyphrase relationships
        print_yake_relationships(yake_relationships, f)
        
        # Write timing comparison
        f.write(f"\nTiming Comparison:\n")
        f.write(f"  RAKE: {rake_time:.4f}sec\n")
        f.write(f"  YAKE: {yake_time:.4f}sec\n")
        f.write(f"  KeyBERT: {keybert_time:.4f}sec\n")
        f.write(f"  Dependencies: {dep_time:.4f}sec\n")
        times = {'RAKE': rake_time, 'YAKE': yake_time, 'KeyBERT': keybert_time, 'Dependencies': dep_time}
        fastest = min(times, key=times.get)
        f.write(f"  Fastest: {fastest}\n")
        
        # Write named entities
        #print_named_entities(entities, f)
        
        # Write phrases
        #print_phrases(noun_phrases, verb_phrases, f)
        
        count += 1
        
        # Print progress indicator every 50 messages
        if count % 50 == 0:
            print(f"Progress: Processed {count} messages...")
    
    # Write overall timing summary
    f.write(f"\n\n{'='*80}\n")
    f.write(f"OVERALL TIMING SUMMARY ({count} messages):\n")
    f.write(f"{'='*80}\n")
    f.write(f"Total RAKE time: {rake_total_time:.4f}sec (avg: {rake_total_time/count:.4f}sec per message)\n")
    f.write(f"Total YAKE time: {yake_total_time:.4f}sec (avg: {yake_total_time/count:.4f}sec per message)\n")
    f.write(f"Total KeyBERT time: {keybert_total_time:.4f}sec (avg: {keybert_total_time/count:.4f}sec per message)\n")
    f.write(f"Total Dependency time: {dep_total_time:.4f}sec (avg: {dep_total_time/count:.4f}sec per message)\n")
    
    total_times = {'RAKE': rake_total_time, 'YAKE': yake_total_time, 'KeyBERT': keybert_total_time, 'Dependencies': dep_total_time}
    fastest = min(total_times, key=total_times.get)
    slowest = max(total_times, key=total_times.get)
    f.write(f"\nOverall fastest: {fastest}\n")
    f.write(f"Overall slowest: {slowest}\n")
    speedup = total_times[slowest] / total_times[fastest]
    f.write(f"Speedup factor (fastest vs slowest): {speedup:.2f}x\n")

print(f"Extraction complete. Results written to {output_file}")
print(f"Processed {count} messages")
print(f"RAKE total time: {rake_total_time:.4f}sec (avg: {rake_total_time/count:.4f}sec)")
print(f"YAKE total time: {yake_total_time:.4f}sec (avg: {yake_total_time/count:.4f}sec)")
print(f"KeyBERT total time: {keybert_total_time:.4f}sec (avg: {keybert_total_time/count:.4f}sec)")
print(f"Dependency time: {dep_total_time:.4f}sec (avg: {dep_total_time/count:.4f}sec)")
total_times = {'RAKE': rake_total_time, 'YAKE': yake_total_time, 'KeyBERT': keybert_total_time, 'Dependencies': dep_total_time}
fastest = min(total_times, key=total_times.get)
print(f"Overall fastest: {fastest}")
