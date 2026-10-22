// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio.Bridge;

internal sealed class BridgeCredential
{
    public BridgeCredential(string credentialId, byte[] secret)
    {
        CredentialId = credentialId;
        Secret = secret;
    }

    public string CredentialId { get; }
    public byte[] Secret { get; }
}

internal sealed class DiscoveryAuthContext
{
    public DiscoveryAuthContext(JObject auth, string nonce)
    {
        Auth = auth;
        Nonce = nonce;
    }

    public JObject Auth { get; }
    public string Nonce { get; }
}

internal sealed class ClientHelloContext
{
    public ClientHelloContext(JObject message, string clientInstanceId, string clientNonce)
    {
        Message = message;
        ClientInstanceId = clientInstanceId;
        ClientNonce = clientNonce;
    }

    public JObject Message { get; }
    public string ClientInstanceId { get; }
    public string ClientNonce { get; }
}

internal sealed class AuthenticatedBridgeSession
{
    public AuthenticatedBridgeSession(
        string sessionId,
        long expiresAt,
        byte[] clientToServerKey,
        byte[] serverToClientKey)
    {
        SessionId = sessionId;
        ExpiresAt = expiresAt;
        ClientToServerKey = clientToServerKey;
        ServerToClientKey = serverToClientKey;
    }

    public string SessionId { get; }
    public long ExpiresAt { get; }
    public byte[] ClientToServerKey { get; }
    public byte[] ServerToClientKey { get; }
}

internal sealed class VerifiedSecureFrame
{
    public VerifiedSecureFrame(string id, long sequence, JObject payload)
    {
        Id = id;
        Sequence = sequence;
        Payload = payload;
    }

    public string Id { get; }
    public long Sequence { get; }
    public JObject Payload { get; }
}

internal static class BridgeAuthentication
{
    public const int ProtocolVersion = 1;
    public const string VisualStudioAgentName = "visualStudio";
    public const string VisualStudioAgentRole = "default";
    public const string CredentialPathOverrideEnvironmentVariable =
        "TYPEAGENT_VS_BRIDGE_CREDENTIAL_PATH";

    // Handshake and discovery proofs are deliberately short-lived. Verification
    // also caps the sender-selected window and permits only small clock skew.
    private const long AuthWindowMilliseconds = 15_000;
    private const long MaxAuthWindowMilliseconds = 30_000;
    private const long ClockSkewMilliseconds = 5_000;
    private const long SessionLifetimeMilliseconds = 10 * 60_000;
    private static readonly Regex IdPattern = new Regex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant);
    private static readonly Regex NoncePattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex ProofPattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

    public static BridgeCredential LoadCredential()
    {
        string credentialPath = GetCredentialPath();
        string directory = Path.GetDirectoryName(credentialPath)
            ?? throw new InvalidOperationException("Credential path has no directory");
        ValidatePrivatePath(directory, isDirectory: true);
        ValidatePrivatePath(credentialPath, isDirectory: false);

        var root = JObject.Parse(File.ReadAllText(credentialPath, Encoding.UTF8));
        int? version = root.Value<int?>("version");
        string? credentialId = root.Value<string>("credentialId");
        string? secretText = root.Value<string>("secret");
        if (version != ProtocolVersion
            || credentialId is null
            || !IdPattern.IsMatch(credentialId)
            || secretText is null
            || !ProofPattern.IsMatch(secretText))
        {
            throw new InvalidOperationException("Visual Studio bridge credential is malformed");
        }

        byte[] secret = FromHex(secretText);
        string expectedId = ToHex(Sha256(secret)).Substring(0, 32);
        if (!FixedTimeEquals(credentialId, expectedId))
        {
            throw new InvalidOperationException("Visual Studio bridge credential identifier mismatch");
        }
        return new BridgeCredential(credentialId, secret);
    }

    public static string CreateClientInstanceId() => ToHex(RandomBytes(16));

    public static DiscoveryAuthContext CreateDiscoveryRequest(
        BridgeCredential credential,
        string agentName,
        string role,
        long? nowOverride = null)
    {
        long now = nowOverride ?? CurrentUnixMilliseconds();
        long expiresAt = now + AuthWindowMilliseconds;
        string nonce = ToHex(RandomBytes(32));
        var auth = new JObject
        {
            ["version"] = ProtocolVersion,
            ["credentialId"] = credential.CredentialId,
            ["nonce"] = nonce,
            ["issuedAt"] = now,
            ["expiresAt"] = expiresAt,
            ["proof"] = CreateProof(
                credential.Secret,
                "typeagent-vs-discovery-request-v1",
                agentName,
                NormalizeRole(agentName, role),
                credential.CredentialId,
                nonce,
                FormatLong(now),
                FormatLong(expiresAt)),
        };
        return new DiscoveryAuthContext(auth, nonce);
    }

    public static bool VerifyDiscoveryResponse(
        BridgeCredential credential,
        DiscoveryAuthContext request,
        string agentName,
        string role,
        int? port,
        string? url,
        JObject? auth,
        long? nowOverride = null)
    {
        if (auth is null)
        {
            return false;
        }
        int? version = auth.Value<int?>("version");
        string? credentialId = auth.Value<string>("credentialId");
        string? requestNonce = auth.Value<string>("requestNonce");
        string? serverNonce = auth.Value<string>("serverNonce");
        long? issuedAt = auth.Value<long?>("issuedAt");
        long? expiresAt = auth.Value<long?>("expiresAt");
        string? proof = auth.Value<string>("proof");
        long now = nowOverride ?? CurrentUnixMilliseconds();
        if (version != ProtocolVersion
            || credentialId is null
            || !FixedTimeEquals(credentialId, credential.CredentialId)
            || requestNonce is null
            || !FixedTimeEquals(requestNonce, request.Nonce)
            || serverNonce is null
            || !NoncePattern.IsMatch(serverNonce)
            || issuedAt is null
            || expiresAt is null
            || proof is null
            || !ProofPattern.IsMatch(proof)
            || !IsFresh(issuedAt.Value, expiresAt.Value, now, MaxAuthWindowMilliseconds))
        {
            return false;
        }

        string expected = CreateProof(
            credential.Secret,
            "typeagent-vs-discovery-response-v1",
            agentName,
            NormalizeRole(agentName, role),
            credential.CredentialId,
            request.Nonce,
            serverNonce,
            FormatLong(issuedAt.Value),
            FormatLong(expiresAt.Value),
            port is null ? "null" : FormatLong(port.Value),
            url ?? string.Empty);
        return FixedTimeEquals(proof, expected);
    }

    public static ClientHelloContext CreateClientHello(
        BridgeCredential credential,
        string clientInstanceId,
        long? nowOverride = null)
    {
        long now = nowOverride ?? CurrentUnixMilliseconds();
        long expiresAt = now + AuthWindowMilliseconds;
        string clientNonce = ToHex(RandomBytes(32));
        var message = new JObject
        {
            ["type"] = "clientHello",
            ["version"] = ProtocolVersion,
            ["credentialId"] = credential.CredentialId,
            ["clientInstanceId"] = clientInstanceId,
            ["clientNonce"] = clientNonce,
            ["issuedAt"] = now,
            ["expiresAt"] = expiresAt,
            ["proof"] = CreateProof(
                credential.Secret,
                "typeagent-vs-client-hello-v1",
                credential.CredentialId,
                clientInstanceId,
                clientNonce,
                FormatLong(now),
                FormatLong(expiresAt)),
        };
        return new ClientHelloContext(message, clientInstanceId, clientNonce);
    }

    public static AuthenticatedBridgeSession? VerifyServerHello(
        BridgeCredential credential,
        ClientHelloContext request,
        JObject value,
        long? nowOverride = null)
    {
        string? type = value.Value<string>("type");
        int? version = value.Value<int?>("version");
        string? credentialId = value.Value<string>("credentialId");
        string? clientNonce = value.Value<string>("clientNonce");
        string? serverNonce = value.Value<string>("serverNonce");
        string? sessionId = value.Value<string>("sessionId");
        long? issuedAt = value.Value<long?>("issuedAt");
        long? expiresAt = value.Value<long?>("expiresAt");
        string? proof = value.Value<string>("proof");
        long now = nowOverride ?? CurrentUnixMilliseconds();
        if (type != "serverHello"
            || version != ProtocolVersion
            || credentialId is null
            || !FixedTimeEquals(credentialId, credential.CredentialId)
            || clientNonce is null
            || !FixedTimeEquals(clientNonce, request.ClientNonce)
            || serverNonce is null
            || !NoncePattern.IsMatch(serverNonce)
            || sessionId is null
            || !IdPattern.IsMatch(sessionId)
            || issuedAt is null
            || expiresAt is null
            || proof is null
            || !ProofPattern.IsMatch(proof)
            || !IsFresh(issuedAt.Value, expiresAt.Value, now, SessionLifetimeMilliseconds))
        {
            return null;
        }

        string expected = CreateProof(
            credential.Secret,
            "typeagent-vs-server-hello-v1",
            credential.CredentialId,
            request.ClientInstanceId,
            request.ClientNonce,
            serverNonce,
            sessionId,
            FormatLong(issuedAt.Value),
            FormatLong(expiresAt.Value));
        if (!FixedTimeEquals(proof, expected))
        {
            return null;
        }

        string[] keyFields =
        {
            credential.CredentialId,
            request.ClientInstanceId,
            request.ClientNonce,
            serverNonce,
            sessionId,
        };
        // Direction-specific domain labels prevent a valid request MAC from
        // being reflected as a response MAC (or vice versa).
        return new AuthenticatedBridgeSession(
            sessionId,
            expiresAt.Value,
            CreateMac(
                credential.Secret,
                "typeagent-vs-session-client-to-server-v1",
                keyFields),
            CreateMac(
                credential.Secret,
                "typeagent-vs-session-server-to-client-v1",
                keyFields));
    }

    public static JObject CreateSecureFrame(
        string sessionId,
        long sequence,
        string kind,
        string id,
        JObject payload,
        byte[] key)
    {
        string encodedPayload = Convert.ToBase64String(
            Encoding.UTF8.GetBytes(payload.ToString(Formatting.None)));
        return new JObject
        {
            ["type"] = "secureFrame",
            ["version"] = ProtocolVersion,
            ["sessionId"] = sessionId,
            ["sequence"] = sequence,
            ["kind"] = kind,
            ["id"] = id,
            ["payload"] = encodedPayload,
            ["proof"] = CreateProof(
                key,
                "typeagent-vs-secure-frame-v1",
                sessionId,
                FormatLong(sequence),
                kind,
                id,
                encodedPayload),
        };
    }

    public static VerifiedSecureFrame? VerifySecureFrame(
        JObject value,
        AuthenticatedBridgeSession session,
        long expectedSequence,
        string expectedKind,
        byte[] key,
        long? nowOverride = null)
    {
        string? type = value.Value<string>("type");
        int? version = value.Value<int?>("version");
        string? sessionId = value.Value<string>("sessionId");
        long? sequence = value.Value<long?>("sequence");
        string? kind = value.Value<string>("kind");
        string? id = value.Value<string>("id");
        string? payloadText = value.Value<string>("payload");
        string? proof = value.Value<string>("proof");
        long now = nowOverride ?? CurrentUnixMilliseconds();
        if (type != "secureFrame"
            || version != ProtocolVersion
            || sessionId is null
            || !FixedTimeEquals(sessionId, session.SessionId)
            || sequence != expectedSequence
            || kind != expectedKind
            || id is null
            || !IdPattern.IsMatch(id)
            || payloadText is null
            || proof is null
            || !ProofPattern.IsMatch(proof)
            || now > session.ExpiresAt)
        {
            return null;
        }

        string expected = CreateProof(
            key,
            "typeagent-vs-secure-frame-v1",
            session.SessionId,
            FormatLong(sequence.Value),
            kind,
            id,
            payloadText);
        if (!FixedTimeEquals(proof, expected))
        {
            return null;
        }

        try
        {
            string payloadJson = Encoding.UTF8.GetString(Convert.FromBase64String(payloadText));
            var payload = JObject.Parse(payloadJson);
            return new VerifiedSecureFrame(id, sequence.Value, payload);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static string CreateRequestId() => ToHex(RandomBytes(16));

    public static long CurrentUnixMilliseconds() =>
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    internal static string GetCredentialPath()
    {
        string? overridePath = Environment.GetEnvironmentVariable(
            CredentialPathOverrideEnvironmentVariable);
        if (overridePath is not null)
        {
            return CanonicalizeCredentialPathOverride(overridePath);
        }

        string userProfile = Environment.GetFolderPath(
            Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(userProfile))
        {
            throw new InvalidOperationException(
                "Current user profile path is unavailable");
        }
        return Path.GetFullPath(Path.Combine(
            userProfile,
            ".typeagent",
            "visual-studio",
            "bridge-credential.json"));
    }

    private static string CanonicalizeCredentialPathOverride(string value)
    {
        if (value.Length == 0
            || !string.Equals(value, value.Trim(), StringComparison.Ordinal)
            || value.Contains('\0')
            || !IsFullyQualifiedPath(value))
        {
            throw new InvalidOperationException(
                $"{CredentialPathOverrideEnvironmentVariable} must be a canonicalizable absolute path without surrounding whitespace");
        }
        try
        {
            return Path.GetFullPath(value);
        }
        catch (Exception ex)
            when (ex is ArgumentException
                || ex is NotSupportedException
                || ex is PathTooLongException)
        {
            throw new InvalidOperationException(
                $"{CredentialPathOverrideEnvironmentVariable} is invalid",
                ex);
        }
    }

    private static bool IsFullyQualifiedPath(string value)
    {
        if (value.StartsWith(@"\\", StringComparison.Ordinal)
            || value.StartsWith("//", StringComparison.Ordinal))
        {
            return true;
        }
        return value.Length >= 3
            && char.IsLetter(value[0])
            && value[1] == ':'
            && (value[2] == Path.DirectorySeparatorChar
                || value[2] == Path.AltDirectorySeparatorChar);
    }

    private static void ValidatePrivatePath(string targetPath, bool isDirectory)
    {
        if (!OperatingSystemIsWindows())
        {
            throw new PlatformNotSupportedException(
                "Visual Studio bridge credentials require Windows ACL validation");
        }

        FileAttributes attributes = File.GetAttributes(targetPath);
        if ((attributes & FileAttributes.ReparsePoint) != 0
            || isDirectory != ((attributes & FileAttributes.Directory) != 0))
        {
            throw new InvalidOperationException("Visual Studio bridge credential path is unsafe");
        }

        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        SecurityIdentifier currentSid = identity.User
            ?? throw new InvalidOperationException("Current Windows identity has no SID");
        var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        FileSystemSecurity security = isDirectory
            ? (FileSystemSecurity)new DirectoryInfo(targetPath).GetAccessControl(
                AccessControlSections.Owner | AccessControlSections.Access)
            : new FileInfo(targetPath).GetAccessControl(
                AccessControlSections.Owner | AccessControlSections.Access);
        if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner
            || !owner.Equals(currentSid)
            || !security.AreAccessRulesProtected)
        {
            throw new InvalidOperationException("Visual Studio bridge credential ACL is invalid");
        }

        bool currentUserAllowed = false;
        AuthorizationRuleCollection rules = security.GetAccessRules(
            includeExplicit: true,
            includeInherited: true,
            targetType: typeof(SecurityIdentifier));
        foreach (FileSystemAccessRule rule in rules.Cast<FileSystemAccessRule>())
        {
            var sid = (SecurityIdentifier)rule.IdentityReference;
            if (rule.IsInherited
                || rule.AccessControlType != AccessControlType.Allow
                || (!sid.Equals(currentSid) && !sid.Equals(systemSid))
                || (rule.FileSystemRights & FileSystemRights.FullControl) != FileSystemRights.FullControl)
            {
                throw new InvalidOperationException("Visual Studio bridge credential ACL is invalid");
            }
            if (sid.Equals(currentSid))
            {
                currentUserAllowed = true;
            }
        }
        if (!currentUserAllowed)
        {
            throw new InvalidOperationException("Visual Studio bridge credential ACL is invalid");
        }
    }

    private static bool OperatingSystemIsWindows() =>
        Environment.OSVersion.Platform == PlatformID.Win32NT;

    private static bool IsFresh(long issuedAt, long expiresAt, long now, long maxWindow) =>
        expiresAt > issuedAt
        && expiresAt - issuedAt <= maxWindow
        && issuedAt <= now + ClockSkewMilliseconds
        && expiresAt >= now - ClockSkewMilliseconds;

    private static string NormalizeRole(string agentName, string role) =>
        // Discovery historically permits an omitted Visual Studio role. Both
        // runtimes authenticate that spelling as the canonical "default" tuple.
        agentName == VisualStudioAgentName && string.IsNullOrEmpty(role)
            ? VisualStudioAgentRole
            : role;

    private static string CreateProof(byte[] key, string domain, params string[] fields) =>
        ToHex(CreateMac(key, domain, fields));

    private static byte[] CreateMac(byte[] key, string domain, params string[] fields)
    {
        // This is the cross-runtime canonical encoding: UTF-8 domain label,
        // followed by each ordered field prefixed with LF. Domain separation
        // keeps proofs from one protocol phase valid in another.
        using var hmac = new HMACSHA256(key);
        var input = new StringBuilder(domain);
        foreach (string field in fields)
        {
            input.Append('\n');
            input.Append(field);
        }
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(input.ToString()));
    }

    private static byte[] Sha256(byte[] value)
    {
        using var sha256 = SHA256.Create();
        return sha256.ComputeHash(value);
    }

    private static byte[] RandomBytes(int count)
    {
        var value = new byte[count];
        using var random = RandomNumberGenerator.Create();
        random.GetBytes(value);
        return value;
    }

    private static string FormatLong(long value) =>
        value.ToString(CultureInfo.InvariantCulture);

    private static string ToHex(byte[] value)
    {
        var builder = new StringBuilder(value.Length * 2);
        foreach (byte b in value)
        {
            builder.Append(b.ToString("x2", CultureInfo.InvariantCulture));
        }
        return builder.ToString();
    }

    private static byte[] FromHex(string value)
    {
        var bytes = new byte[value.Length / 2];
        for (int i = 0; i < bytes.Length; i++)
        {
            bytes[i] = byte.Parse(
                value.Substring(i * 2, 2),
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture);
        }
        return bytes;
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        // Do not short-circuit on a differing byte or length; peer-provided
        // identifiers and proofs must not expose comparison timing.
        byte[] leftBytes = Encoding.UTF8.GetBytes(left);
        byte[] rightBytes = Encoding.UTF8.GetBytes(right);
        int difference = leftBytes.Length ^ rightBytes.Length;
        int length = Math.Max(leftBytes.Length, rightBytes.Length);
        for (int i = 0; i < length; i++)
        {
            byte leftByte = i < leftBytes.Length ? leftBytes[i] : (byte)0;
            byte rightByte = i < rightBytes.Length ? rightBytes[i] : (byte)0;
            difference |= leftByte ^ rightByte;
        }
        return difference == 0;
    }
}
