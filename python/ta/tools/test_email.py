# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import sys
from colorama import Fore

from typeagent.aitools import utils
from typeagent.emails.email_import import import_email_from_file
from typeagent.emails.email_memory import EmailMemory, EmailMessage

from typeagent.knowpro.convsettings import ConversationSettings
from typeagent.storage.utils import create_storage_provider

# Just simple test code
# TODO : Once stable, move creation etc to utool.py
async def main():

    utils.load_dotenv()

    settings = ConversationSettings()  # Has no storage provider yet
    settings.storage_provider = await create_storage_provider(
        settings.message_text_index_settings,
        settings.related_term_index_settings,
        "emails",
        EmailMessage,
    )

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
        except Exception as e:
            print(f"Error importing email from {file_path}: {e}")


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
        print(Fore.CYAN +       chunk)
    

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, BrokenPipeError):
        print()
        sys.exit(1)
