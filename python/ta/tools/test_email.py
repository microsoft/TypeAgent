# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import sys
from typeagent.emails.email_import import import_email_file
from typeagent.emails.email_memory import EmailMemory, EmailMessage

# Just simple test code
def main():

    # TODO : Once stable, move creation etc to utool.py
    # conversation: EmailMemory  = EmailMemory.create()
    while True:
        cmd = input("✉>>").strip()
        if len(cmd) == 0:
            continue
        elif cmd == "exit":
            break
        
        file_path: str = cmd
        email_msg: EmailMessage = import_email_file(file_path)

        print("Metadata:", email_msg.metadata)
        print("Timestamp:", email_msg.timestamp)
        print("Text Chunks:", email_msg.text_chunks)

if __name__ == "__main__":
    main()
