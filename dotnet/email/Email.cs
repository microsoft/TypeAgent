// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.Core;
namespace TypeAgent;

public class Email
{
    public Email()
    {
    }

    public Email(MailItem mail, string? sourcePath = null)
    {
        Load(mail);
        SourcePath = sourcePath;
    }

    public Email(Email email, string body)
    {
        this.Bcc = email.Bcc;
        this.Cc = email.Cc;
        this.From = email.From;
        this.Importance = email.Importance;
        this.ReceivedOn = email.ReceivedOn;
        this.SentOn = email.SentOn;
        this.SourcePath = email.SourcePath;
        this.Subject = email.Subject;
    }

    /*
     * HEADERS
     */
    [JsonPropertyName("from")]
    public EmailAddress From { get; set; }
    [JsonPropertyName("to")]
    public List<EmailAddress> To { get; set; }
    [JsonPropertyName("cc")]
    public List<EmailAddress> Cc { get; set; }
    [JsonPropertyName("bcc")]
    public List<EmailAddress> Bcc { get; set; }
    [JsonPropertyName("subject")]
    public string Subject { get; set; }
    [JsonPropertyName("sentOn")]
    public DateTime SentOn { get; set; }
    [JsonPropertyName("receivedOn")]
    public DateTime ReceivedOn { get; set; }
    [JsonPropertyName("importance")]
    public string Importance { get; set; }
    [JsonPropertyName("threadId")]
    public string ThreadId { get; set; }

    [JsonPropertyName("sourcePath")]
    public string SourcePath { get; set; }

    /*
     * BODY
     */
    [JsonPropertyName("body")]
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
        return ToString(true);
    }

    public string ToString(bool includeBody)
    {
        StringBuilder sb = new StringBuilder();
        if (From != null)
        {
            sb.AppendHeader("From", From.ToString());
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
        sb.AppendHeader("Subject", Subject);
        sb.AppendHeader("Sent", SentOn.ToString());
        sb.AppendHeader("Received", ReceivedOn.ToString());
        sb.AppendHeader("Importance", Importance);
        sb.AppendHeader("SourcePath", SourcePath);
        if (includeBody && !string.IsNullOrEmpty(Body))
        {
            sb.AppendLine();
            sb.AppendLine(Body);
        }
        return sb.ToString();
    }

    void Load(MailItem item)
    {
        LoadRecipients(item);
        From = item.Sender != null ? new EmailAddress(SmtpAddressOf(item.Sender), item.Sender.Name) : null;
        Subject = item.Subject;
        SentOn = item.SentOn;
        ReceivedOn = item.ReceivedTime;
        Importance = GetImportance(item);
        ThreadId = item.ConversationID;
        LoadBody(item);
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

    void LoadBody(MailItem item)
    {
        string body = item.Body;
        body = BodyParser.Default.GetLatest(body);
        Body = body;
    }

    string GetImportance(MailItem item)
    {
        switch (item.Importance)
        {
            default:
                break;
            case OlImportance.olImportanceNormal:
                return "Normal";
            case OlImportance.olImportanceHigh:
                return "High";
            case OlImportance.olImportanceLow:
                return "Low";
        }
        return null;
    }

    string SmtpAddressOf(Recipient recipient)
    {
        AddressEntry addrEntry = recipient.AddressEntry;
        return addrEntry != null ? SmtpAddressOf(addrEntry) : null;
    }


    string SmtpAddressOf(AddressEntry addrEntry)
    {
        try
        {
            return addrEntry.AddressEntryUserType != OlAddressEntryUserType.olSmtpAddressEntry
                ? SmtpAddressOfExchangeUser(addrEntry)
                : addrEntry.Address;
        }
        finally
        {
            COMObject.Release(addrEntry);
        }
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
