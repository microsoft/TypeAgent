// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TokenCredential,
    DeviceCodeCredential,
    UsernamePasswordCredential,
    UsernamePasswordCredentialOptions,
    DeviceCodeCredentialOptions,
    InteractiveBrowserCredential,
    InteractiveBrowserCredentialNodeOptions,
} from "@azure/identity";
import {
    AuthenticationRecord,
    deserializeAuthenticationRecord,
    serializeAuthenticationRecord,
} from "@azure/identity";

import { Client } from "@microsoft/microsoft-graph-client";
import { User } from "@microsoft/microsoft-graph-types";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { useIdentityPlugin } from "@azure/identity";
import { cachePersistencePlugin } from "@azure/identity-cache-persistence";
import { nativeBrokerPlugin } from "@azure/identity-broker";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import path from "path";
import lockfile from "proper-lockfile";
import registerDebug from "debug";
import chalk from "chalk";
import os from "os";
import { EventEmitter } from "node:events";

try {
    useIdentityPlugin(cachePersistencePlugin);
} catch (e: any) {
    console.warn(
        chalk.yellowBright(
            `Failed to load Azure Identity cache persistence plugin:${e.message}`,
        ),
    );
}

// WAM (Web Account Manager) broker plugin. Active only on Windows; on
// other platforms the plugin is a no-op and InteractiveBrowserCredential
// falls back to the regular browser flow. Enables silent SSO when the
// user's Windows session already has a matching work/school account
// (useDefaultBrokerAccount: true below).
try {
    useIdentityPlugin(nativeBrokerPlugin);
} catch (e: any) {
    console.warn(
        chalk.yellowBright(
            `Failed to load Azure Identity native broker plugin:${e.message}`,
        ),
    );
}
export interface ErrorResponse {
    code: string;
    message: string;
}
export interface AppSettings {
    clientId: string;
    tenantId: string;
    clientSecret: string;
    graphUserScopes: string[];
    username?: string | undefined;
    password?: string | undefined;
    authMode: "browser" | "device-code";
    redirectPort: number;
}

export type SignInPrompt =
    | {
          kind: "deviceCode";
          userCode: string;
          verificationUri: string;
          message: string;
      }
    | { kind: "browser"; url?: string; message: string }
    | { kind: "error"; message: string };

export type SignInPromptCallback = (prompt: SignInPrompt) => void;

export interface DynamicObject {
    [key: string]: any;
}

const debugGraph = registerDebug("typeagent:graphUtils:graphClient");
const debugGraphError = registerDebug("typeagent:graphUtils:graphClient:error");

function readFileSafely(filePath: string): string | undefined {
    try {
        if (existsSync(filePath)) {
            const fileContent = readFileSync(filePath, {
                encoding: "utf-8",
            });
            return fileContent;
        }
    } catch (error) {
        debugGraphError("Error reading file:", error);
        return undefined;
    }
}

function writeFileSafety(filePath: string, content: string) {
    try {
        writeFileSync(filePath, content);
    } catch (error) {
        debugGraphError("Error writing file:", error);
    }
}

async function withLockFile<T>(file: string, fn: () => Promise<T>): Promise<T> {
    let release = await lockfile.lock(file);
    try {
        return await fn();
    } finally {
        release();
    }
}

const DEFAULT_REDIRECT_PORT = 6893;

/**
 * Parses a port string and validates it is an integer in the 1–65535 range.
 * Uses `Number()` for strict conversion (rejects partial parses like "123abc").
 * Logs a warning and falls back to `defaultPort` when the value is absent or invalid.
 */
function parseValidPort(raw: string | undefined, defaultPort: number): number {
    if (raw === undefined) {
        return defaultPort;
    }
    const num = Number(raw.trim());
    if (Number.isInteger(num) && num >= 1 && num <= 65535) {
        return num;
    }
    debugGraphError(
        `Invalid port value "${raw}" for MSGRAPH_APP_REDIRECT_PORT; using default port ${defaultPort}.`,
    );
    return defaultPort;
}

const invalidSettings: AppSettings = {
    clientId: "",
    clientSecret: "",
    tenantId: "",
    graphUserScopes: [],
    authMode: "browser",
    redirectPort: DEFAULT_REDIRECT_PORT,
};

function loadMSGraphSettings(envPrefix: string = "MSGRAPH_APP"): AppSettings {
    const authModeRaw = (
        process.env[`${envPrefix}_AUTH_MODE`] ?? "browser"
    ).toLowerCase();
    const authMode: "browser" | "device-code" =
        authModeRaw === "device-code" || authModeRaw === "devicecode"
            ? "device-code"
            : "browser";
    const redirectPort = parseValidPort(
        process.env[`${envPrefix}_REDIRECT_PORT`],
        DEFAULT_REDIRECT_PORT,
    );

    const settings: AppSettings = {
        clientId: process.env[`${envPrefix}_CLIENTID`] ?? "",
        clientSecret: process.env[`${envPrefix}_CLIENTSECRET`] ?? "",
        tenantId: process.env[`${envPrefix}_TENANTID`] ?? "",
        username: process.env[`${envPrefix}_USERNAME`],
        password: process.env[`${envPrefix}_PASSWD`],
        graphUserScopes: [
            "user.read",
            "mail.read",
            "mail.send",
            "user.readbasic.all",
            "calendars.readwrite",
        ],
        authMode,
        redirectPort,
    };

    // clientSecret is optional now — only the username/password ROPC path uses
    // it. Both DeviceCodeCredential and InteractiveBrowserCredential are
    // public-client flows that don't need a secret.
    if (settings.clientId === "" || settings.tenantId === "") {
        debugGraphError(
            chalk.red("Please provide valid clientId and tenantId"),
        );
        return invalidSettings;
    }
    return settings;
}

/**
 * Back-compat alias. The shape changed from `(prompt: string) => void` to
 * `(prompt: SignInPrompt) => void`; existing callers in the providers were
 * updated to handle the structured form.
 */
export type DevicePromptCallback = SignInPromptCallback;

/**
 * Optional per-subclass overrides for the MS Graph auth plumbing.
 *
 * All fields default to the legacy single-app values used by
 * CalendarClient / MailClient, so subclasses that don't pass options
 * behave exactly as before. Subclasses targeting a different AAD app
 * supply an `envPrefix` plus matching scopes and a distinct cache name
 * so their tokens don't collide with the default cache.
 */
export interface GraphClientOptions {
    /**
     * Env var prefix used to look up clientId/tenantId/etc.
     * E.g. `"MSGRAPH_OTHER_APP"` reads `MSGRAPH_OTHER_APP_CLIENTID`,
     * `MSGRAPH_OTHER_APP_TENANTID`, etc. Default: `"MSGRAPH_APP"`.
     */
    envPrefix?: string;
    /**
     * Filename (under `~/.typeagent/`) for the persisted authentication
     * record. Use a distinct value per AAD app to avoid clobbering the
     * calendar/email cache. Default: `"tokencache.bin"`.
     */
    authRecordFile?: string;
    /**
     * Name passed to Azure Identity's `tokenCachePersistenceOptions`.
     * Pair with `authRecordFile` to fully isolate per-app tokens.
     * Default: `"typeagent-tokencache"`.
     */
    tokenCacheName?: string;
    /**
     * Scopes used when acquiring tokens. Pass a specific scope list
     * for apps that don't have `.default` consent.
     * Default: `"https://graph.microsoft.com/.default"`.
     */
    scopes?: string | string[];
}

export class GraphClient extends EventEmitter {
    /**
     * All live GraphClient instances. Used by logout() to broadcast a
     * cross-instance clear: calendar+email share an MS Graph identity
     * (single tenant, single persisted auth record), so logging out from
     * one needs to invalidate the other's in-memory client too — otherwise
     * a subsequent action on the other agent would silently keep working
     * against the stale cached client.
     */
    private static _instances: Set<GraphClient> = new Set();

    private _userClient: Client | undefined = undefined;
    private AUTH_RECORD_PATH: string;

    private _userEmailAddresses: Map<string, string> = new Map<
        string,
        string
    >();

    private readonly MSGRAPH_AUTH_URL: string | string[];
    private readonly _tokenCacheName: string;

    private readonly _settings: AppSettings;
    protected constructor(
        private readonly authCommand: string,
        options: GraphClientOptions = {},
    ) {
        super();
        this._settings = loadMSGraphSettings(options.envPrefix);
        this.AUTH_RECORD_PATH = path.join(
            path.join(os.homedir(), ".typeagent"),
            options.authRecordFile ?? "tokencache.bin",
        );
        this._tokenCacheName = options.tokenCacheName ?? "typeagent-tokencache";
        this.MSGRAPH_AUTH_URL =
            options.scopes ?? "https://graph.microsoft.com/.default";
        GraphClient._instances.add(this);
    }

    private async initializeGraphFromDeviceCode(
        cb?: DevicePromptCallback,
    ): Promise<Client> {
        return withLockFile(
            existsSync(this.AUTH_RECORD_PATH)
                ? this.AUTH_RECORD_PATH
                : path.dirname(this.AUTH_RECORD_PATH),
            async () => {
                const options: DeviceCodeCredentialOptions = {
                    clientId: this._settings.clientId,
                    tenantId: this._settings.tenantId,
                    // Only disable automatic auth for silent login attempts
                    disableAutomaticAuthentication: cb === undefined,

                    tokenCachePersistenceOptions: {
                        enabled: true,
                        name: this._tokenCacheName,
                    },
                };
                if (cb) {
                    options.userPromptCallback = (deviceCodeInfo) =>
                        cb({
                            kind: "deviceCode",
                            userCode: deviceCodeInfo.userCode,
                            verificationUri: deviceCodeInfo.verificationUri,
                            message: deviceCodeInfo.message,
                        });
                }

                if (existsSync(this.AUTH_RECORD_PATH)) {
                    const fileContent = readFileSafely(this.AUTH_RECORD_PATH);
                    if (fileContent !== undefined && fileContent != "") {
                        const authRecord: AuthenticationRecord =
                            deserializeAuthenticationRecord(fileContent);
                        if (authRecord.authority !== undefined) {
                            options.authenticationRecord = authRecord;
                        }
                    }
                }

                const credential = new DeviceCodeCredential(options);
                if (cb === undefined) {
                    // Silent auth - only possible if we have a cached auth record
                    if (options.authenticationRecord === undefined) {
                        throw new Error(
                            `No cached credentials. Run ${this.authCommand} to authenticate.`,
                        );
                    }
                    // getToken to make sure we can authenticate silently
                    try {
                        await credential.getToken(this.MSGRAPH_AUTH_URL);
                    } catch (e: any) {
                        // Token cache may be expired - need interactive auth
                        throw new Error(
                            `Cached credentials expired. Run ${this.authCommand} to re-authenticate.`,
                        );
                    }
                    return this.createClient(credential);
                }

                // This will ask for user interaction
                const authRecord = await credential.authenticate(
                    this.MSGRAPH_AUTH_URL,
                );

                if (authRecord) {
                    const serializedAuthRecord =
                        serializeAuthenticationRecord(authRecord);
                    writeFileSafety(
                        this.AUTH_RECORD_PATH,
                        serializedAuthRecord,
                    );
                    debugGraph("Authenticated");
                }
                return this.createClient(credential);
            },
        );
    }

    private async initializeGraphFromInteractiveBrowser(
        cb?: DevicePromptCallback,
    ): Promise<Client> {
        return withLockFile(
            existsSync(this.AUTH_RECORD_PATH)
                ? this.AUTH_RECORD_PATH
                : path.dirname(this.AUTH_RECORD_PATH),
            async () => {
                const options: InteractiveBrowserCredentialNodeOptions = {
                    clientId: this._settings.clientId,
                    tenantId: this._settings.tenantId,
                    redirectUri: `http://localhost:${this._settings.redirectPort}`,
                    // Silent if cb is not provided; only authenticate when
                    // explicitly requested via login().
                    disableAutomaticAuthentication: cb === undefined,
                    tokenCachePersistenceOptions: {
                        enabled: true,
                        name: this._tokenCacheName,
                    },
                };

                // On Windows, route through WAM (Web Account Manager) so a
                // user already signed in to their work/school account in
                // Windows can SSO silently — no browser popup, no consent
                // prompt. parentWindowHandle is required by the SDK whenever
                // brokerOptions.enabled is true; an empty Uint8Array means
                // "no parent window" (the broker dialog, if shown, appears
                // as a top-level system window). Falls back to interactive
                // browser when no default account matches the tenant.
                //
                // Requires the WAM redirect URI on the AAD app registration:
                //   ms-appx-web://Microsoft.AAD.BrokerPlugin/<clientId>
                if (process.platform === "win32") {
                    options.brokerOptions = {
                        enabled: true,
                        useDefaultBrokerAccount: true,
                        parentWindowHandle: new Uint8Array(0),
                    };
                }

                if (existsSync(this.AUTH_RECORD_PATH)) {
                    const fileContent = readFileSafely(this.AUTH_RECORD_PATH);
                    if (fileContent !== undefined && fileContent != "") {
                        const authRecord: AuthenticationRecord =
                            deserializeAuthenticationRecord(fileContent);
                        if (authRecord.authority !== undefined) {
                            options.authenticationRecord = authRecord;
                        }
                    }
                }

                const credential = new InteractiveBrowserCredential(options);

                if (cb === undefined) {
                    // Silent path — only works if we have a cached auth record.
                    if (options.authenticationRecord === undefined) {
                        throw new Error(
                            `No cached credentials. Run ${this.authCommand} to authenticate.`,
                        );
                    }
                    try {
                        await credential.getToken(this.MSGRAPH_AUTH_URL);
                    } catch {
                        throw new Error(
                            `Cached credentials expired. Run ${this.authCommand} to re-authenticate.`,
                        );
                    }
                    return this.createClient(credential);
                }

                // Notify the caller that auth is in flight. The credential
                // takes over from here: on Windows with WAM, silent SSO via
                // the user's signed-in Windows account often succeeds with
                // no UI at all; on cache miss it falls back to the system
                // account picker. On other platforms the SDK opens the
                // system browser via the `open` package.
                cb({
                    kind: "browser",
                    message:
                        process.platform === "win32"
                            ? "Signing in to Microsoft (using your Windows account if available)..."
                            : "Opening your browser to sign in to Microsoft. Complete sign-in in the browser window.",
                });

                const authRecord = await credential.authenticate(
                    this.MSGRAPH_AUTH_URL,
                );

                if (authRecord) {
                    const serializedAuthRecord =
                        serializeAuthenticationRecord(authRecord);
                    writeFileSafety(
                        this.AUTH_RECORD_PATH,
                        serializedAuthRecord,
                    );
                    debugGraph("Authenticated (interactive browser)");
                }
                return this.createClient(credential);
            },
        );
    }

    private async initializeGraphFromUserCred(): Promise<Client> {
        const settings = this._settings;
        if (!settings.username || !settings.password) {
            throw new Error("Need valid username and password in setting");
        }

        const options: UsernamePasswordCredentialOptions = {
            tokenCachePersistenceOptions: {
                enabled: true,
            },
        };
        const credential = new UsernamePasswordCredential(
            settings.tenantId,
            settings.clientId,
            settings.username,
            settings.password,
            options,
        );

        const token = await credential.getToken(this.MSGRAPH_AUTH_URL);
        if (token === undefined) {
            throw new Error("Failed to get token");
        }

        return this.createClient(credential);
    }

    private async createClient(credential: TokenCredential): Promise<Client> {
        const authProvider = new TokenCredentialAuthenticationProvider(
            credential,
            {
                scopes: this._settings.graphUserScopes,
            },
        );

        const client = Client.initWithMiddleware({
            authProvider,
        });

        // Make sure the credential is valid
        const response = await client
            .api("/me")
            .select(["displayName", "mail", "userPrincipalName"])
            .get();
        if (
            response === undefined ||
            response.userPrincipalName === undefined
        ) {
            throw new Error("Unable to query graph with client");
        }
        this._userClient = client;
        this.emit("connected", client);
        return client;
    }

    private async initialize(cb?: DevicePromptCallback): Promise<Client> {
        if (this._userClient !== undefined) {
            return this._userClient;
        }

        const settings = this._settings;
        if (settings === invalidSettings) {
            throw new Error("Missing graph settings in environment variables");
        }
        if (settings.username && settings.password) {
            return await this.initializeGraphFromUserCred();
        }
        return settings.authMode === "browser"
            ? await this.initializeGraphFromInteractiveBrowser(cb)
            : await this.initializeGraphFromDeviceCode(cb);
    }

    public async login(cb?: DevicePromptCallback): Promise<boolean> {
        try {
            await this.initialize(cb);
            return true;
        } catch (e: any) {
            if (cb === undefined) {
                return false;
            }
            throw e;
        }
    }

    public logout() {
        // Real logout has three pieces: drop the in-memory client on every
        // GraphClient instance (calendar + email share an identity), delete
        // the persisted authentication record so silent re-auth can't pick
        // up where we left off, and clear the in-memory user-email cache.
        // Without all three, the next action on either agent would
        // silently re-authenticate from cache and the user wouldn't
        // actually be logged out.
        let wasAuthenticated = false;
        for (const instance of GraphClient._instances) {
            if (instance._userClient !== undefined) {
                wasAuthenticated = true;
                instance._userClient = undefined;
                instance.emit("disconnected");
            }
            instance._userEmailAddresses.clear();
        }
        try {
            if (existsSync(this.AUTH_RECORD_PATH)) {
                unlinkSync(this.AUTH_RECORD_PATH);
                debugGraph("Deleted persisted auth record");
            }
        } catch (error: any) {
            debugGraphError(`Failed to delete auth record: ${error.message}`);
        }
        return wasAuthenticated;
    }

    public isAuthenticated() {
        return this._userClient !== undefined;
    }

    protected async ensureClient(cb?: DevicePromptCallback): Promise<Client> {
        try {
            return await this.initialize(cb);
        } catch (error: any) {
            if (cb === undefined) {
                debugGraphError(`Error initializing graph: ${error.message}`);
                throw new Error(
                    `Not authenticated. Use ${this.authCommand} to log into MS Graph and try your request again.`,
                );
            }
            throw error;
        }
    }
    protected async getClient(): Promise<Client | undefined> {
        try {
            return await this.initialize();
        } catch (error: any) {
            debugGraphError(`Error initializing graph: ${error.message}`);
            return undefined;
        }
    }

    public async getUserAsync(): Promise<User> {
        const client = await this.ensureClient();
        return client
            .api("/me")
            .select(["displayName", "mail", "userPrincipalName"])
            .get();
    }

    public async getUserInfo(nameHint: string): Promise<any[]> {
        const client = await this.ensureClient();
        try {
            const response = await client
                .api("/users")
                .filter(`startsWith(displayName, '${nameHint}')`)
                .select("displayName,mail")
                .get();
            return response.value;
        } catch (error) {
            debugGraphError(chalk.red(`Error finding events${error}`));
        }
        return [];
    }

    public async loadUserEmailAddresses(): Promise<void> {
        const client = await this.ensureClient();
        try {
            const response = await client
                .api("/users")
                .select("displayName,userPrincipalName")
                .get();

            if (response.value) {
                for (const user of response.value) {
                    if (user.displayName && user.userPrincipalName) {
                        this._userEmailAddresses.set(
                            user.displayName,
                            user.userPrincipalName,
                        );
                    }
                }
            }
        } catch (error) {
            debugGraphError(
                chalk.red(`Error loading user email addresses:${error}`),
            );
        }
    }

    public async getEmailAddressesOfUsernamesLocal(
        usernames: string[],
    ): Promise<string[]> {
        let emailAddresses: string[] = [];
        try {
            if (this._userEmailAddresses.size === 0) {
                await this.loadUserEmailAddresses();
            }

            for (const username of usernames) {
                for (const [name, addr] of this._userEmailAddresses.entries()) {
                    if (name.toLowerCase().includes(username.toLowerCase())) {
                        emailAddresses.push(addr);
                        break;
                    }
                }
            }
        } catch (error) {
            debugGraphError(
                chalk.red(`Error fetching email addresses:${error}`),
            );
        }
        return emailAddresses;
    }

    public async getEmailAddressesOfUsernames(
        usernames: string[],
    ): Promise<string[]> {
        const client = await this.ensureClient();
        let emailAddresses: string[] = [];
        try {
            for (const username of usernames) {
                const response = await client
                    .api("/users")
                    .filter(`startsWith(displayName, '${username}')`)
                    .select("displayName,userPrincipalName ")
                    .get();

                const user = response.value[0];
                if (user && user.userPrincipalName) {
                    emailAddresses.push(user.userPrincipalName);
                }
            }
        } catch (error) {
            debugGraphError(`Error fetching email addresses:${error}`);
        }
        return emailAddresses;
    }
}
