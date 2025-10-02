# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import re

from email import message_from_string
from email.message import Message

from .email_message import EmailMessage, EmailMessageMeta

# Imports an email file (.eml) as a list of EmailMessage objects
def import_email_from_file(email_filePath: str) -> EmailMessage:
    email_string: str = ""
    with open(email_filePath, "r") as f:
        email_string = f.read()

    return import_email_string(email_string)

# Imports a single email MIME string and returns an EmailMessage object
def import_email_string(email_string: str) -> EmailMessage:
    msg: Message = message_from_string(email_string)
    email: EmailMessage = import_email_message(msg)
    return email

# Imports an email.message.Message object and returns an EmailMessage object
def import_email_message(msg: Message) -> EmailMessage:
    # Extract metadata from
    email_meta = EmailMessageMeta(
        sender=msg.get("From"),
        recipients=msg.get_all("To", []),
        cc=msg.get_all("Cc", []),
        bcc=msg.get_all("Bcc", []),
        subject=msg.get("Subject"))
    timestamp: str = msg.get("Date")

    # Get email body
    body = _extract_email_body(msg)
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

# Return all sub-parts of a forwarded email MIME texts
def get_forwarded_email_parts(mime_text: str) -> list[str]:
    # Forwarded emails often start with "From:" lines, so we can split on those
    split_delimiter = re.compile(r'(?=From:)', re.IGNORECASE)
    raw_parts: list[str] = split_delimiter.split(mime_text)

    parts: list[str] = []
    for part in raw_parts:
        part = part.strip()
        if len(part) > 0:
            parts.append(part)

    return parts

# Extracts the plain text body from an email.message.Message object.
def _extract_email_body(msg: Message) -> str:
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
    if payload is None:
        return None
    
    body: str = payload.decode(part.get_content_charset() or "utf-8")
    return body