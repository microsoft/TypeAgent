// Copyright (c) Microsoft. All rights reserved.

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

    public string Address { get; set; }
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
