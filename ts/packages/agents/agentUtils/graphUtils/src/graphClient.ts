// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TokenCredential,
    DeviceCodeCredential,
    UsernamePasswordCredential,
    UsernamePasswordCredentialOptions,
    DeviceCodeCredentialOptions,
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
import { readFileSync, existsSync, writeFileSync } from "fs";
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
}

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

const invalidSettings = {
    clientId: "",
    clientSecret: "",
    tenantId: "",
    graphUserScopes: [],
};

function loadMSGraphSettings(): AppSettings {
    const settings = {
        clientId: process.env["MSGRAPH_APP_CLIENTID"] ?? "",
        clientSecret: process.env["MSGRAPH_APP_CLIENTSECRET"] ?? "",
        tenantId: process.env["MSGRAPH_APP_TENANTID"] ?? "",
        username: process.env["MSGRAPH_APP_USERNAME"],
        password: process.env["MSGRAPH_APP_PASSWD"],
        graphUserScopes: [
            "user.read",
            "mail.read",
            "mail.send",
            "user.read.all",
            "calendars.readwrite",
        ],
    };

    if (
        settings.clientId === "" ||
        settings.clientSecret === "" ||
        settings.tenantId === ""
    ) {
        debugGraphError(
            chalk.red(
                "Please provide valid clientId, clientSecret and tenantId",
            ),
        );
        return invalidSettings;
    }
    return settings;
}

export type DevicePromptCallback = (prompt: string) => void;

export class GraphClient extends EventEmitter {
    private _userClient: Client | undefined = undefined;
    private AUTH_RECORD_PATH: string = path.join(
        path.join(os.homedir(), ".typeagent"),
        "tokencache.bin",
    );

    private _userEmailAddresses: Map<string, string> = new Map<
        string,
        string
    >();

    private readonly MSGRAPH_AUTH_URL: string =
        "https://graph.microsoft.com/.default";

    private readonly _settings: AppSettings;
    protected constructor(private readonly authCommand: string) {
        super();
        this._settings = loadMSGraphSettings();
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
                    disableAutomaticAuthentication: true,

                    tokenCachePersistenceOptions: {
                        enabled: true,
                        name: "typeagent-tokencache",
                    },
                };
                if (cb) {
                    options.userPromptCallback = (deviceCodeInfo) =>
                        cb(deviceCodeInfo.message);
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
                    // getToken to make sure we can authenticate silently
                    await credential.getToken(this.MSGRAPH_AUTH_URL);
                    if (options.authenticationRecord !== undefined) {
                        return this.createClient(credential);
                    }
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
        if (!settings.username || !settings.password) {
            return await this.initializeGraphFromDeviceCode(cb);
        }
        return await this.initializeGraphFromUserCred();
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
        if (this._userClient !== undefined) {
            this._userClient = undefined;
            this.emit("disconnected");
            return true;
        }
        return false;
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
