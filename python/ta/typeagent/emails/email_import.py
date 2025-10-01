# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import re
import email

from ..knowpro.convsettings import ConversationSettings
from ..knowpro.interfaces import Datetime
from ..storage.utils import create_storage_provider

from .emailMemory import EmailMessage, EmailMessageMeta
from email.message import Message

def import_email_file(email_filePath: str) -> EmailMessage:
    msg: Message
       
    with open(email_filePath, "r") as f:
        msg = email.message_from_file(f)
    
    # Extract metadata from
    email_meta = EmailMessageMeta(
        sender=msg.get("From"),
        recipients=msg.get_all("To", []),
        cc=msg.get_all("Cc", []),
        bcc=msg.get_all("Bcc", []),
        subject=msg.get("Subject"))
    timestamp: str = msg.get("Date")

    # Get email body
    body = extract_email_body(msg)
    if body is None:
        body = "" 
    if email_meta.subject is not None:
        body = email_meta.subject + "\n\n" + body

    email: EmailMessage = EmailMessage(
        metadata=email_meta, 
        text_chunks=[body], 
        timestamp=timestamp
    )
    return email

def extract_email_body(msg: Message) -> str:
    """Extracts the plain text body from an email.message.Message object."""
    if msg.is_multipart():
        parts: list[str] = []
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                text: str = _decode_email_payload(part)
                if text:
                    parts.append(text)
        return "\n".join(parts)
    else:
        return _decode_email_payload(msg)
    
def _decode_email_payload(part: Message) -> str | None:
    """Decodes the payload of an email part to a string using its charset."""
    payload = part.get_payload(decode=True)
    if payload is not None:
        return None
    return payload.decode(part.get_content_charset() or "utf-8")