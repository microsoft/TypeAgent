# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
from bs4 import BeautifulSoup
import requests
from typing import List
import re
import uuid
from embedding import Embedding

@dataclass
class Chunk:
    id: str
    speaker: str
    content: str
    episode_id: str
    section_id: str
    section_title: str
    embedding: Embedding
    speaker_role: str | None = None

    @classmethod
    def from_dict(cls, chunk_dict: dict) -> "Chunk":
        embedding = Embedding.from_dict(chunk_dict["embedding"])
        return cls(
            chunk_dict["id"], 
            chunk_dict["speaker"], 
            chunk_dict["content"], 
            chunk_dict["episode_id"], 
            chunk_dict["section_id"], 
            chunk_dict["section_title"], 
            embedding, 
            chunk_dict.get("speaker_role")
        )

    def to_dict(self):
        return {
            "id": self.id,
            "speaker": self.speaker,
            "content": self.content,
            "episode_id": self.episode_id,
            "section_id": self.section_id,
            "section_title": self.section_title,
            "speaker_role": self.speaker_role,
            "embedding": self.embedding.to_dict()
        }

@dataclass
class Turn:
    id: str
    speaker: str
    content: str
    speaker_role: str | None = None

    @classmethod
    def from_dict(cls, turn_dict: dict) -> "Turn":
        return cls(
            turn_dict["id"], 
            turn_dict["speaker"], 
            turn_dict["content"], 
            turn_dict.get("speaker_role")
        )
    
    @classmethod
    def from_str(cls, turn_str: str, id: str) -> "Turn":
        tokens = turn_str.split(":")
        speaker = tokens[0].strip().title()
        content = tokens[1].strip()
        return cls(id, speaker, content, None)

    def to_dict(self):
        return {
            "id": self.id,
            "speaker": self.speaker,
            "content": self.content,
            "speaker_role": self.speaker_role
        }

@dataclass
class Section:
    title: str
    transcript: List[Turn]
    id: str

    @classmethod
    def from_link(cls, link: str, episode_id: str, index: int) -> "Section":
        response = requests.get(link)
        soup = BeautifulSoup(response.text, 'html.parser')

        section_id = f"{episode_id}_{index}"

        transcript = soup.find('div', {'class' : 'transcript storytext'}).text
        title = soup.find('h1', {'class' : 'transcript'}).text

        trimmed = transcript.strip().split("\n")[0]
        pattern = r'([A-Z\s,]+)([A-Z]+:)(.*?)(?=\b[A-Z\s,]*[A-Z]+:|$)'

        matches = re.findall(pattern, trimmed, re.DOTALL)

        turns = []
        speaker_role_dict = {}
        for i, match in enumerate(matches):
            speaker = match[0].strip() + match[1].strip()[0]
            content = match[2].strip()

            speaker_role = None
            speaker_tokens = speaker.split(",")
            if len(speaker_tokens) > 1:
                speaker = speaker_tokens[0].strip()
                speaker_role = speaker_tokens[1].strip()
                speaker_role_dict[speaker] = speaker_role
                speaker_role_dict[speaker.split(" ")[-1].strip()] = speaker_role

            turn_id = f"{section_id}_{i}"
            turn = Turn(speaker, content, speaker_role_dict.get(speaker), turn_id)
            turns.append(turn)
        
        return cls(title, turns, section_id)

    @classmethod
    def from_dict(cls, section_dict: dict) -> "Section":
        turns = [Turn.from_dict(turn) for turn in section_dict["transcript"]]
        return cls(section_dict["title"], turns, section_dict["id"])
    
    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "transcript": [turn.to_dict() for turn in self.transcript]
        }

@dataclass
class Episode:
    id: str
    date: str
    sections: List[Section]

    @classmethod
    def from_link(cls, link: str) -> "Episode":
        date = link.split("date")[-1].strip("=")
        episode_id = uuid.uuid4().hex

        response = requests.get(link)
        soup = BeautifulSoup(response.text, 'html.parser')

        section_links = soup.find_all('a', href=True)

        sections = []
        for section_link in section_links:
            section_transcript_link = section_link['href']

            if "transcripts" in section_transcript_link:
                section = Section.from_link(section_transcript_link, episode_id)
                sections.append(section)

        return cls(episode_id, date, sections)

    @classmethod 
    def split_conversation(cls, text: str) -> List[str]:
        # Use regex to split text by each speaker or cue, capturing the delimiter
        turns = re.split(r'(\b[A-Z ]+:\s)', text)
        
        # Reconstruct the turns by combining the speaker and their dialogue
        conversation = []
        for i in range(1, len(turns), 2):  # step by 2 to get pairs (speaker + dialogue)
            turn = turns[i] + turns[i + 1].strip()  # Combine speaker with dialogue
            conversation.append(turn)
        
        return conversation
    
    @classmethod
    def from_text_file(cls, path: str) -> "Episode":

        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            turn_strs = cls.split_conversation(content)
            episode_id = uuid.uuid4().hex

            date = f.read().split("\n")[0]

            sections = [Section(
                title="Full Transcript",
                transcript=[Turn.from_str(x, f"{episode_id}_0_{i}") for i, x in enumerate(turn_strs)],
                id=f"{episode_id}_0"
            )]

            return cls(episode_id, date, sections)

    @classmethod
    def from_dict(cls, episode_dict: dict) -> "Episode":
        sections = [Section.from_dict(section) for section in episode_dict["sections"]]
        return cls(episode_dict["id"], episode_dict["date"], sections)
    
    def to_dict(self):
        return {
            "id": self.id,
            "date": self.date,
            "sections": [section.to_dict() for section in self.sections]
        }