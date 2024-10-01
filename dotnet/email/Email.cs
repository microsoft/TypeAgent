// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;
namespace TypeAgent;

public class Email
{
    public Email()
    {
    }

    public Email(MailItem mail)
    {
       Load(mail);
    }

    public EmailAddress From { get; set; }
    public List<EmailAddress> To { get; set; }
    public List<EmailAddress> Cc { get; set; }
    public List<EmailAddress> Bcc { get; set; }

    public string Subject { get; set; }
    public string Body { get; set; }

    public string ToJson()
    {
        return Json.Stringify(this);
    }

    public void Save(string filePath)
    {
        File.WriteAllText(filePath, ToJson());
    }

    public static Email Load(string filePath)
    {
        string json = File.ReadAllText(filePath);
        return Json.Parse<Email>(json);
    }

    public override string ToString()
    {
        StringBuilder sb = new StringBuilder();
        if (From != null)
        {
            sb.AppendLine(From.ToString());
        }
        if (To != null)
        {
            sb.AppendHeader("To", To.Join());
        }
        if (Cc != null)
        {
            sb.AppendHeader("Cc", Cc.Join());
        }
        if (Bcc != null)
        {
            sb.AppendHeader("Bcc", Bcc.Join());
        }
        if (From != null)
        {
            sb.AppendHeader("From", From.ToString());
        }
        if (!string.IsNullOrEmpty(Subject))
        {
            sb.AppendHeader("Subject", Subject);
        }
        if (!string.IsNullOrEmpty(Body))
        {
            sb.AppendLine();
            sb.AppendLine(Body);
        }
        return sb.ToString();
    }

    void Load(MailItem item)
    {
        LoadRecipients(item);
        Subject = item.Subject;
        Body = item.Body;
    }

    void LoadRecipients(MailItem mail)
    {
        Recipients recipients = mail.Recipients;
        try
        {
            foreach (Recipient recipient in recipients)
            {
                try
                {
                    LoadRecipient(recipient);
                }
                finally
                {
                    COMObject.Release(recipient);
                }
            }

        }
        finally
        {
            COMObject.Release(recipients);
            recipients = null;
        }
    }

    bool LoadRecipient(Recipient recipient)
    {
        if (!recipient.Resolve())
        {
            return false;
        }
        EmailAddress emailAddress = new EmailAddress(SmtpAddressOf(recipient) ?? string.Empty, recipient.Name);
        switch (recipient.Type)
        {
            default:
                break;
            case (int)OlMailRecipientType.olTo:
                To ??= new List<EmailAddress>();
                To.Add(emailAddress);
                break;
            case (int)OlMailRecipientType.olCC:
                Cc ??= new List<EmailAddress>();
                Cc.Add(emailAddress);
                break;
            case (int)OlMailRecipientType.olBCC:
                Bcc ??= new List<EmailAddress>();
                Bcc.Add(emailAddress);
                break;
        }
        return true;
    }

    string SmtpAddressOf(Recipient recipient)
    {
        string smtpAddress = null;
        AddressEntry addrEntry = recipient.AddressEntry;
        if (addrEntry != null)
        {
            try
            {
                smtpAddress = addrEntry.AddressEntryUserType != OlAddressEntryUserType.olSmtpAddressEntry
                    ? SmtpAddressOfExchangeUser(addrEntry)
                    : addrEntry.Address;
            }
            finally
            {
                COMObject.Release(addrEntry);
            }
        }

        return smtpAddress;
    }

    string SmtpAddressOfExchangeUser(AddressEntry addrEntry)
    {
        ExchangeUser exchUser = addrEntry.GetExchangeUser();
        try
        {
            return exchUser?.PrimarySmtpAddress;
        }
        finally
        {
            COMObject.Release(exchUser);
            exchUser = null;
        }
    }
}
