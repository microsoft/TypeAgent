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
parser.add_argument("--max_length", type=int, default=1, help="Maximum number of words in a keyword phrase.")
parser.add_argument("--output_file", type=str, default='extraction.txt', help="Path to the output file.")
parser.add_argument("--verbose", action='store_true', help="Enable verbose output (shows all extraction details). Default is non-verbose.")
parser.add_argument("--nogpu", action='store_true', help="Force KeyBERT to use CPU instead of GPU. Default is false (use GPU if available).")
args = parser.parse_args(sys.argv[1:])
dataset_path = args.dataset_path
max_length = args.max_length
output_file = args.output_file
verbose = args.verbose
nogpu = args.nogpu

# Initialize RAKE with max_length configuration
rake = Rake(max_length=max_length)

# Initialize YAKE keyword extractor
# Parameters: language, max_ngram_size, deduplication_threshold, number of keywords
yake_extractor = yake.KeywordExtractor(lan="en", n=max_length, dedupLim=0.9, top=20)

# Initialize KeyBERT model
if nogpu:
    from sentence_transformers import SentenceTransformer
    # Force sentence transformer to use CPU
    model = SentenceTransformer('all-MiniLM-L6-v2', device='cpu')
    keybert_model = KeyBERT(model=model)
    print('Using KeyBERT on CPU')
else:
    keybert_model = KeyBERT()

# Load spacy model with only necessary components
# Keep: tok2vec, tagger, parser, lemmatizer
# Disable: ner, attribute_ruler, and any other unused components
if nogpu:
    # Force spaCy to use CPU
    spacy.require_cpu()
    print('Using spaCy on CPU')
nlp = spacy.load("en_core_web_sm", disable=["ner"])

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
        verb_relations = []
        nouns_in_verb_relations = set()
        
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
            
            # If token is a verb, extract its NOUN and ADV dependencies
            if token.pos_ == "VERB":
                nouns = []
                advs = []
                for child in token.children:
                    if child.pos_ == "NOUN" or child.pos_ == "PROPN":
                        nouns.append(child.text)
                        nouns_in_verb_relations.add(child.text)
                    elif child.pos_ == "ADV":
                        advs.append(child.text)
                
                verb_relations.append({
                    'verb': token.text,
                    'nouns': nouns,
                    'advs': advs
                })
        
        # Find nouns that are NOT dependent on any verb
        independent_nouns = []
        for token in sent:
            if (token.pos_ == "NOUN" or token.pos_ == "PROPN") and token.text not in nouns_in_verb_relations:
                noun_info = {
                    'noun': token.text,
                    'dep': token.dep_,
                    'head': token.head.text,
                    'head_pos': token.head.pos_
                }
                
                # If the noun depends on a preposition, also show what the preposition depends on
                if token.head.pos_ == "ADP":
                    noun_info['prep_head'] = token.head.head.text
                    noun_info['prep_head_pos'] = token.head.head.pos_
                    noun_info['prep_dep'] = token.head.dep_
                
                independent_nouns.append(noun_info)
        
        sentences_deps.append({
            'sentence': sent.text,
            'dependencies': sent_deps,
            'verb_relations': verb_relations,
            'independent_nouns': independent_nouns
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

def extract_keyword_relations(doc, message):
    """Extract all NOUNS and VERBS as keywords, with up to 2 most important related words each."""
    # Process each sentence separately
    sentence_keywords = []
    
    for sent in doc.sents:
        keywords_data = []
        
        for token in sent:
            # Only process NOUNS, PROPN, and VERBS
            if token.pos_ not in ['NOUN', 'PROPN', 'VERB']:
                continue
            
            keyword_info = {
                'keyword': token.text,
                'pos': token.pos_,
                'lemma': token.lemma_,
                'relations': []
            }
            
            # Collect potential related words with priority scores
            candidates = []
            
            if token.pos_ == 'VERB':
                # For verbs, prioritize: subject, object, adverbs, prepositional objects
                for child in token.children:
                    if child.dep_ in ['nsubj', 'nsubjpass']:  # Subject
                        candidates.append((3, child, child.dep_, 'subject'))
                    elif child.dep_ in ['dobj', 'attr']:  # Direct object
                        candidates.append((3, child, child.dep_, 'object'))
                    elif child.dep_ == 'advmod':  # Adverb
                        candidates.append((2, child, child.dep_, 'adverb'))
                    elif child.dep_ == 'prep':  # Preposition
                        # Get the object of the preposition
                        for pchild in child.children:
                            if pchild.dep_ == 'pobj':
                                candidates.append((2, pchild, f'{child.text}_{pchild.dep_}', 'prep_obj'))
                    elif child.dep_ in ['iobj', 'dative']:  # Indirect object
                        candidates.append((2, child, child.dep_, 'indirect_obj'))
            
            elif token.pos_ in ['NOUN', 'PROPN']:
                # For nouns, prioritize: adjectives, compound nouns, prep phrases, possessives
                for child in token.children:
                    if child.dep_ == 'amod':  # Adjective modifier
                        candidates.append((3, child, child.dep_, 'adjective'))
                    elif child.dep_ == 'compound':  # Compound noun
                        candidates.append((3, child, child.dep_, 'compound'))
                    elif child.dep_ == 'prep':  # Preposition
                        # Get the object of the preposition
                        for pchild in child.children:
                            if pchild.dep_ == 'pobj':
                                candidates.append((2, pchild, f'{child.text}_{pchild.dep_}', 'prep_obj'))
                    elif child.dep_ in ['poss', 'nmod']:  # Possessive or nominal modifier
                        candidates.append((2, child, child.dep_, 'modifier'))
                
                # Also check if this noun is dependent on something important
                if token.head.pos_ == 'VERB':
                    if token.dep_ in ['nsubj', 'nsubjpass', 'dobj', 'attr']:
                        candidates.append((1, token.head, token.dep_, 'verb_relation'))
                elif token.head.pos_ == 'ADP':  # Preposition
                    # Find what the preposition connects to
                    if token.head.head.pos_ in ['NOUN', 'PROPN', 'VERB']:
                        candidates.append((1, token.head.head, f'via_{token.head.text}', 'prep_head'))
            
            # Sort by priority (higher first) and take top 2
            candidates.sort(key=lambda x: x[0], reverse=True)
            for priority, related_token, relation, rel_type in candidates[:2]:
                keyword_info['relations'].append({
                    'word': related_token.text,
                    'lemma': related_token.lemma_,
                    'relation': relation,
                    'type': rel_type,
                    'pos': related_token.pos_
                })
            
            keywords_data.append(keyword_info)
        
        if keywords_data:
            sentence_keywords.append({
                'sentence': sent.text,
                'keywords': keywords_data
            })
    
    return sentence_keywords

def filter_keywords_by_stopwords(keyword_relations):
    """
    Filter out common/generic keywords using an expanded stop word list.
    Always keeps proper nouns (PROPN).
    
    Args:
        keyword_relations: List of sentence dicts with keywords
    
    Returns:
        Filtered keyword_relations without generic keywords
    """
    # Common verbs to exclude
    stop_verbs = {
        'be', 'have', 'do', 'say', 'get', 'make', 'go', 'know', 'take', 'see',
        'come', 'think', 'look', 'want', 'give', 'use', 'find', 'tell', 'ask',
        'work', 'seem', 'feel', 'try', 'leave', 'call', 'need', 'become', 'show',
        'mean', 'keep', 'let', 'begin', 'help', 'talk', 'turn', 'start', 'run',
        'move', 'like', 'live', 'believe', 'hold', 'bring', 'happen', 'write',
        'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
        'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop',
        'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk',
        'win', 'offer', 'remember', 'consider', 'appear', 'buy', 'wait', 'serve',
        'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill',
        'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report', 'decide'
    }
    
    # Common nouns to exclude
    stop_nouns = {
        'thing', 'time', 'year', 'way', 'day', 'man', 'people', 'person', 'woman',
        'life', 'child', 'world', 'hand', 'part', 'place', 'case', 'week', 'company',
        'system', 'program', 'question', 'work', 'number', 'night', 'point', 'home',
        'water', 'room', 'mother', 'area', 'money', 'story', 'fact', 'month', 'lot',
        'right', 'study', 'book', 'eye', 'job', 'word', 'issue', 'side', 'kind',
        'head', 'house', 'service', 'friend', 'father', 'power', 'hour', 'game',
        'line', 'end', 'member', 'law', 'car', 'city', 'community', 'name', 'president',
        'team', 'minute', 'idea', 'body', 'information', 'back', 'parent', 'face',
        'others', 'level', 'office', 'door', 'health', 'art', 'war', 'history',
        'party', 'result', 'change', 'morning', 'reason', 'research', 'girl', 'guy',
        'moment', 'air', 'teacher', 'force', 'education'
    }
    
    filtered_relations = []
    for sent_info in keyword_relations:
        filtered_keywords = []
        for kw in sent_info['keywords']:
            kept = False
            # Always keep proper nouns
            if kw['pos'] == 'PROPN':
                filtered_keywords.append(kw)
                kept = True
            # Filter verbs against stop list
            elif kw['pos'] == 'VERB' and kw['lemma'].lower() not in stop_verbs:
                filtered_keywords.append(kw)
                kept = True
            # Filter nouns against stop list
            elif kw['pos'] == 'NOUN' and kw['lemma'].lower() not in stop_nouns:
                filtered_keywords.append(kw)
                kept = True
        
        if filtered_keywords:
            filtered_relations.append({
                'sentence': sent_info['sentence'],
                'keywords': filtered_keywords
            })
    
    return filtered_relations

def extract_sentence_word_lists(filtered_keyword_relations):
    """
    Extract flat lists of words per sentence from filtered keywords.
    Returns lemmatized keywords + their related words, filtered to remove pronouns and stop words.
    
    Args:
        filtered_keyword_relations: Filtered list of sentence dicts with keywords
    
    Returns:
        List of dicts with 'sentence' and 'words' (list of unique lemmas)
    """
    # Common verbs to exclude
    stop_verbs = {
        'be', 'have', 'do', 'say', 'get', 'make', 'go', 'know', 'take', 'see',
        'come', 'think', 'look', 'want', 'give', 'use', 'find', 'tell', 'ask',
        'work', 'seem', 'feel', 'try', 'leave', 'call', 'need', 'become', 'show',
        'mean', 'keep', 'let', 'begin', 'help', 'talk', 'turn', 'start', 'run',
        'move', 'like', 'live', 'believe', 'hold', 'bring', 'happen', 'write',
        'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
        'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop',
        'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk',
        'win', 'offer', 'remember', 'consider', 'appear', 'buy', 'wait', 'serve',
        'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill',
        'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report', 'decide'
    }
    
    # Common nouns to exclude
    stop_nouns = {
        'thing', 'time', 'year', 'way', 'day', 'man', 'people', 'person', 'woman',
        'life', 'child', 'world', 'hand', 'part', 'place', 'case', 'week', 'company',
        'system', 'program', 'question', 'work', 'number', 'night', 'point', 'home',
        'water', 'room', 'mother', 'area', 'money', 'story', 'fact', 'month', 'lot',
        'right', 'study', 'book', 'eye', 'job', 'word', 'issue', 'side', 'kind',
        'head', 'house', 'service', 'friend', 'father', 'power', 'hour', 'game',
        'line', 'end', 'member', 'law', 'car', 'city', 'community', 'name', 'president',
        'team', 'minute', 'idea', 'body', 'information', 'back', 'parent', 'face',
        'others', 'level', 'office', 'door', 'health', 'art', 'war', 'history',
        'party', 'result', 'change', 'morning', 'reason', 'research', 'girl', 'guy',
        'moment', 'air', 'teacher', 'force', 'education'
    }
    
    # Pronouns to exclude (lemmatized forms)
    pronouns = {
        'i', 'you', 'he', 'she', 'it', 'we', 'they',
        'me', 'him', 'her', 'us', 'them',
        'my', 'your', 'his', 'her', 'its', 'our', 'their',
        'mine', 'yours', 'hers', 'ours', 'theirs',
        'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
        'this', 'that', 'these', 'those',
        'who', 'whom', 'whose', 'which', 'what',
        'anybody', 'anyone', 'anything', 'everybody', 'everyone', 'everything',
        'nobody', 'nothing', 'somebody', 'someone', 'something'
    }
    
    sentence_lists = []
    
    for sent_info in filtered_keyword_relations:
        words = set()
        
        for kw in sent_info['keywords']:
            lemma_lower = kw['lemma'].lower()
            pos = kw['pos']
            
            # Skip pronouns
            if pos == 'PRON' or lemma_lower in pronouns:
                continue
            
            # Skip stop words (but keep PROPN)
            if pos == 'PROPN':
                words.add(kw['lemma'])
            elif pos == 'VERB' and lemma_lower not in stop_verbs:
                words.add(kw['lemma'])
            elif pos == 'NOUN' and lemma_lower not in stop_nouns:
                words.add(kw['lemma'])
            
            # Add filtered related words
            for rel in kw['relations']:
                rel_lemma_lower = rel['lemma'].lower()
                rel_pos = rel['pos']
                
                # Skip pronouns
                if rel_pos == 'PRON' or rel_lemma_lower in pronouns:
                    continue
                
                # Skip stop words (but keep PROPN)
                if rel_pos == 'PROPN':
                    words.add(rel['lemma'])
                elif rel_pos == 'VERB' and rel_lemma_lower not in stop_verbs:
                    words.add(rel['lemma'])
                elif rel_pos == 'NOUN' and rel_lemma_lower not in stop_nouns:
                    words.add(rel['lemma'])
                # Also keep adjectives and adverbs
                elif rel_pos in ['ADJ', 'ADV']:
                    words.add(rel['lemma'])
        
        sentence_lists.append({
            'sentence': sent_info['sentence'],
            'words': sorted(list(words))  # Sort for consistent output
        })
    
    return sentence_lists

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
            
            # Print all dependencies first
            file.write("  Dependencies:\n")
            for dep in sent_info['dependencies']:
                file.write(f"    {dep['token']} ({dep['pos']}) --[{dep['dep']}]--> {dep['head']} ({dep['head_pos']})\n")
            
            # Print verb relations (verb with its noun and adverb dependencies)
            if sent_info.get('verb_relations'):
                file.write("  Verb Relations:\n")
                for vr in sent_info['verb_relations']:
                    nouns_str = ', '.join(vr['nouns']) if vr['nouns'] else 'none'
                    advs_str = ', '.join(vr['advs']) if vr['advs'] else 'none'
                    file.write(f"    VERB: {vr['verb']} | NOUNs: {nouns_str} | ADVs: {advs_str}\n")
            
            # Print independent nouns (not dependent on any verb)
            if sent_info.get('independent_nouns'):
                file.write("  Independent NOUNs (not verb-dependent):\n")
                for noun_info in sent_info['independent_nouns']:
                    file.write(f"    {noun_info['noun']} --[{noun_info['dep']}]--> {noun_info['head']} ({noun_info['head_pos']})")
                    # If noun depends on preposition, show what preposition depends on
                    if 'prep_head' in noun_info:
                        file.write(f" --[{noun_info['prep_dep']}]--> {noun_info['prep_head']} ({noun_info['prep_head_pos']})")
                    file.write("\n")
            
        file.write(f"\nTotal sentences: {len(sentences_deps)}\n")
    else:
        file.write("  No dependencies extracted\n")

def print_keyword_relationships(keyword_relations, file, header="Keyword Relationships (All NOUNs and VERBs)"):
    """Write keyword relationship analysis to file."""
    file.write(f"\n{header}:\n")
    
    if not keyword_relations:
        file.write("  No keywords found\n")
        return
    
    for sent_info in keyword_relations:
        file.write(f"\n  Sentence: {sent_info['sentence']}\n")
        file.write(f"  Keywords with relations:\n")
        
        for kw in sent_info['keywords']:
            related_words = []
            for rel in kw['relations']:
                related_words.append(f"{rel['lemma']}({rel['type']})")
            
            related_str = ', '.join(related_words) if related_words else 'none'
            file.write(f"    {kw['lemma']} [{kw['pos']}]: {related_str}\n")

count = 0
rake_total_time = 0
yake_total_time = 0
keybert_total_time = 0
dep_total_time = 0
total_keyword_density = 0.0
all_keywords = set()  # Track unique keywords across all messages
total_words = 0  # Track total words across all messages

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
        
        # Find keyword relationships for indexing
        keyword_relationships = extract_keyword_relations(spacy_doc, message)
        
        # Filter keywords using stop words
        filtered_keyword_relationships = filter_keywords_by_stopwords(keyword_relationships)
        
        # Extract named entities
        # entities = extract_named_entities(message)
        
        # Extract noun and verb phrases
        #noun_phrases, verb_phrases = extract_phrases(message)
        
        # Write original message
        f.write(f"\n{'='*80}\n")
        f.write(f"Message {count + 1}:\n")
        f.write(message + "\n")
        f.write('-' * 80 + "\n")
        
        if verbose:
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
            
            # Write keyword relationships for indexing (unfiltered)
            print_keyword_relationships(keyword_relationships, f)
            
            # Write filtered keyword relationships for indexing
            print_keyword_relationships(filtered_keyword_relationships, f, header="Filtered Keywords (Stop Words Removed)")
        
        # Extract and print flat word lists per sentence
        sentence_word_lists = extract_sentence_word_lists(filtered_keyword_relationships)
        f.write(f"\nSentence Word Lists (Keywords + Relations):\n")
        for sent_list in sentence_word_lists:
            f.write(f"  {sent_list['words']}\n")
        
        # Calculate and print word statistics
        # Count unique words across all sentence lists
        all_keywords_this_message = set()
        for sent_list in sentence_word_lists:
            all_keywords_this_message.update(sent_list['words'])
        
        # Update global tracking
        all_keywords.update(all_keywords_this_message)
        
        # Count total words in original message
        message_word_count = len(message.split())
        total_words += message_word_count
        unique_keyword_count = len(all_keywords_this_message)
        
        f.write(f"\nWord Statistics:\n")
        f.write(f"  Total words in message: {message_word_count}\n")
        f.write(f"  Unique filtered keywords: {unique_keyword_count}\n")
        if message_word_count > 0:
            percentage = (unique_keyword_count / message_word_count) * 100
            f.write(f"  Keyword density: {percentage:.1f}%\n")
            total_keyword_density += percentage
      
        # Write timing comparison (only if verbose)
        if verbose:
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
    
    avg_keyword_density = total_keyword_density / count if count > 0 else 0
    f.write(f"\nAverage keyword density: {avg_keyword_density:.1f}%\n")
    f.write(f"\nTotal words across all messages: {total_words}\n")
    f.write(f"Unique keywords across all messages: {len(all_keywords)}\n")
    if total_words > 0:
        overall_density = (len(all_keywords) / total_words) * 100
        f.write(f"Overall keyword density: {overall_density:.1f}%\n")
    
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
