# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import asyncio
import sys
import traceback
from typing import Any, Iterable
from colorama import Fore

from typeagent.aitools import utils

from typeagent.knowpro import kplib
from typeagent.emails.email_import import import_email_from_file
from typeagent.emails.email_memory import EmailMemory
from typeagent.emails.email_message import EmailMessage

from typeagent.knowpro.convsettings import ConversationSettings
from typeagent.storage.utils import create_storage_provider

# Just simple test code
# TODO : Once stable, move creation etc to utool.py
async def main():

    utils.load_dotenv()

    dbPath: str = "/data/testChat/knowpro/email/pyEmails.db"
    delete_sqlite_db(dbPath)

    settings = ConversationSettings()  # Has no storage provider yet
    settings.storage_provider = await create_storage_provider(
        settings.message_text_index_settings,
        settings.related_term_index_settings,
        dbPath,
        EmailMessage,
    )
    conversation:EmailMemory = await EmailMemory.create(settings)
    print(await conversation.messages.size())
    # conversation: EmailMemory  = EmailMemory.create()
    while True:
        cmd = input("✉>>").strip()
        if len(cmd) == 0:
            continue
        elif cmd == "exit":
            break
        
        file_path: str = cmd
        try:
            print("================================")
            email: EmailMessage = import_email_from_file(file_path)
            print_email(email)
            print()
            knowledge = email.metadata.get_knowledge()
            print_knowledge(knowledge)

            print("Adding email...")
            await conversation.add_message(email)
            count = await conversation.messages.size()
            print(Fore.GREEN + f"Added email to conversation. Total messages: {count}")
            await conversation.build_index()
            print(Fore.GREEN + "Built index.")

        except Exception as e:
            print()
            print(Fore.RED, f"Error importing email from {file_path}: {e}")
            traceback.print_exc()

        print(Fore.RESET)


def delete_sqlite_db(db_path: str):
    if os.path.exists(db_path):
        os.remove(db_path)  # Delete existing database for clean test
        # Also delete -shm and -wal files if they exist
        shm_path = db_path + "-shm"
        wal_path = db_path + "-wal"
        if os.path.exists(shm_path):
            os.remove(shm_path)
        if os.path.exists(wal_path):
            os.remove(wal_path)

def print_email(email: EmailMessage):
    print("From:", email.metadata.sender)
    print("To:", ", ".join(email.metadata.recipients))
    if email.metadata.cc:
        print("Cc:", ", ".join(email.metadata.cc))
    if email.metadata.bcc:
        print("Bcc:", ", ".join(email.metadata.bcc))
    if email.metadata.subject:
        print("Subject:", email.metadata.subject)
    print("Date:", email.timestamp)
    
    print("Body:")
    for chunk in email.text_chunks:
        print(Fore.CYAN + chunk)

    print(Fore.RESET)

def print_knowledge(knowledge: kplib.KnowledgeResponse):
    print_list(Fore.GREEN, knowledge.topics, "Topics")
    print()
    print_list(Fore.GREEN, knowledge.entities, "Entities")
    print()
    print_list(Fore.GREEN, knowledge.actions, "Actions")
    print()
    print(Fore.RESET)

def print_list(color, list: Iterable[Any], title: str):
    if title:
        print(color + f"# {title}")
        print()
    for item in list:
        print(color + " -", item)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, BrokenPipeError):
        print()
        sys.exit(1)
