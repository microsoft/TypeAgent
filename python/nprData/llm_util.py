# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from groq import Groq
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import List
import os
from openai import OpenAI

@dataclass
class LLMTurn:
    role: str
    content: str

    def to_dict(self):
        return {
            "role": self.role,
            "content": self.content
        }

class LLMClient:
    def send_message(
            self, 
            role: str, 
            content: str, 
            history: List[LLMTurn] | None = None
        ) -> LLMTurn:
        raise NotImplementedError("Subclasses should implement this method")

# These classes ended up being the same but Anthropic and Perplexity both
# difference so keeping this way for now
class GroqClient(LLMClient):
    def __init__(self):
        groq_api_key = os.environ.get("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY environment variable is not set")

        self.client = Groq(
            api_key=groq_api_key
        )

        groq_model = os.environ.get("GROQ_MODEL")
        if not groq_model:
            raise ValueError("GROQ_MODEL environment variable is not set")
        self.model = groq_model

    def send_message(
            self, 
            role: str, 
            content: str,
            history: List[LLMTurn] | None = None
        ) -> LLMTurn:
        messages = [LLMTurn(role, content)]
        if history:
            messages = history + [LLMTurn(role, content)]
        
        messages = [x.to_dict() for x in messages]
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages
        )
        return LLMTurn(role, response.choices[0].message.content)

class OpenAIClient(LLMClient):
    def __init__(self):
        openai_api_key = os.environ.get("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        
        self.client = OpenAI(
            api_key=openai_api_key
        )

        openai_model = os.environ.get("OPENAI_MODEL")
        if not openai_model:
            raise ValueError("OPENAI_MODEL environment variable is not set")
        self.model = openai_model

    def send_message(
            self, 
            role: str, 
            content: str,
            history: List[LLMTurn] | None = None
        ) -> LLMTurn:
        messages = [LLMTurn(role, content)]
        if history:
            messages = history + [LLMTurn(role, content)]
        
        messages = [x.to_dict() for x in messages]
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages
        )
        return LLMTurn(role, response.choices[0].message.content)

class LLMChat:
    turns: List[LLMTurn]

    # defaults to OpenAI
    def __init__(self, client: str = "openai"):
        client_map = {
            "openai": OpenAIClient,
            "groq": GroqClient
        }
        self.client = client_map[client]()
        self.turns = []

    def add_system_message(self, content: str):
        self.turns += [LLMTurn("system", content)]

    def send_message(self, role: str, content: str) -> LLMTurn:
        new_turn = LLMTurn(role, content)
        response_turn = self.client.send_message(
            role, 
            content, 
            self.turns
        )
        self.turns += [new_turn, response_turn]
        return response_turn

if __name__ == "__main__":
    load_dotenv("./env_vars")
    client = GroqClient()
    chat = LLMChat(client)