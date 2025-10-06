# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import shlex
import asyncio
import sys
import traceback
from typing import Any, Iterable
from colorama import Fore
from pathlib import Path

from typeagent.aitools import utils

from typeagent.knowpro import kplib
from typeagent.emails.email_import import import_email_from_file, import_emails_from_dir
from typeagent.emails.email_memory import EmailMemory
from typeagent.emails.email_message import EmailMessage

from typeagent.knowpro.convsettings import ConversationSettings
from typeagent.storage.utils import create_storage_provider
            

# Just simple test code
# TODO : Once stable, move creation etc to utool.py
async def main():

    utils.load_dotenv()

    db_path: str = "/data/testChat/knowpro/email/pyEmails.db"
    conversation:EmailMemory = await load_or_create_email_memory(db_path, create_new=False)

    handlers = {
        "@add": add_messages,
        "@build": build_index
    }
    while True:
        line = input("✉>>").strip()
        if len(line) == 0:
            continue
        elif line == "exit":
            break        
        args = shlex.split(line)
        if len(args) < 1:
            continue
        try:
            cmd = args[0].lower()
            if cmd == "@help":
                print_list(Fore.GREEN, handlers.keys(), "Commands")
            else:
                handler = handlers.get(cmd)
                if handler:
                    args.pop(0)
                    await handler(conversation, args)            
        except Exception as e:
            print()
            print(Fore.RED, f"Error\n: {e}")
            traceback.print_exc()

        print(Fore.RESET)

async def add_messages(conversation: EmailMemory, args: list[str]):
    if len(args) < 1:
        print_error("No path provided")
        return
    
    src_path = Path(args[0])
    emails: list[EmailMessage]
    if src_path.is_file():
        emails = [import_email_from_file(str(src_path))]
    else:
        emails = import_emails_from_dir(str(src_path))

    print(Fore.CYAN, f"Importing {len(emails)} emails".capitalize())
    print()

    for email in emails:
        print_email(email)
        print()
        knowledge = email.metadata.get_knowledge()
        print_knowledge(knowledge)

        print("Adding email...")
        await conversation.add_message(email)

async def build_index(conversation: EmailMemory, args: list[str]):
    print(Fore.GREEN, "Building index")
    await conversation.build_index()
    print(Fore.GREEN + "Built index.")


async def load_or_create_email_memory(db_path: str, create_new: bool) -> EmailMemory:
    if create_new:
        print(f"Deleting {db_path}")
        delete_sqlite_db(db_path)

    settings = EmailMemory.create_settings()
    settings.storage_provider = await create_storage_provider(
    settings.message_text_index_settings,
    settings.related_term_index_settings,
    db_path,
    EmailMessage
    )
    return await EmailMemory.create(settings)

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


#
# Printing
#

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

def print_error(msg: str):
    print(Fore.RED + msg)
    print(Fore.RESET)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, BrokenPipeError):
        print()
        sys.exit(1)
