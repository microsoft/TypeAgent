// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Net.Mail;

namespace TypeAgent;

public class EmailAddress
{
    public EmailAddress()
    {
    }

    public EmailAddress(string address, string displayName = null)
    {
        Address = address;
        DisplayName = displayName;
    }

    [JsonPropertyName("address")]
    public string Address { get; set; }
    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; }

    public override string ToString()
    {
        if (string.IsNullOrEmpty(DisplayName))
        {
            return Address ?? string.Empty;
        }
        else
        {
            return string.IsNullOrEmpty(Address) ? DisplayName : $"\"{DisplayName}\" <{Address}>";
        }
    }

    public static EmailAddress FromString(string address)
    {
        EmailAddress emailAddress = new EmailAddress();
        if (address.Length > 0)
        {
            emailAddress.DisplayName = address;
            try
            {
                MailAddress mailAddress = new MailAddress(address);
                emailAddress.Address = mailAddress.Address;
                emailAddress.DisplayName = mailAddress.DisplayName;
            }
            catch
            {
            }
        }
        return emailAddress;
    }

    public static List<EmailAddress> ListFromString(string addresses)
    {
        // Outlook interop has a text export bug
        List<EmailAddress> emailAddresses = new List<EmailAddress>();
        if (addresses.Length > 0)
        {
            var addressParts = addresses.Split(";", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in addressParts)
            {
                emailAddresses.Add(FromString(part));
            }

        }
        return emailAddresses;
    }
}

public static class EmailAddressEx
{
    public static string Join(this List<EmailAddress> list)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.Count; ++i)
        {
            var item = list[i];
            if (i > 0)
            {
                sb.Append(", ");
            }
            sb.Append(item.ToString());
        }
        return sb.ToString();
    }
}
