// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TokenCredential,
    DeviceCodeCredential,
    UsernamePasswordCredential,
    UsernamePasswordCredentialOptions,
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

import registerDebug from "debug";
import chalk from "chalk";
import os from "os";
import { Limiter, createLimiter } from "common-utils";

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
    username?: string;
    password?: string;
}

export interface DynamicObject {
    [key: string]: any;
}

type AuthCacheContent = {
    authRecord: string;
    tokenExpiration: number;
};

export class GraphClient {
    private _settings: AppSettings | undefined = undefined;
    private _deviceCodeCredential: DeviceCodeCredential | undefined = undefined;

    private _userClient: Client | undefined = undefined;
    private AUTH_RECORD_PATH: string = path.join(
        path.join(os.homedir(), ".typeagent"),
        "tokencache.bin",
    );
    private readonly logger = registerDebug("typeagent:graphUtils:graphClient");

    private _usernamePasswordCredential:
        | UsernamePasswordCredential
        | undefined = undefined;

    private _userEmailAddresses: Map<string, string> = new Map<
        string,
        string
    >();

    private graphLock: Limiter;
    private static instance: GraphClient | undefined = undefined;
    private readonly MSGRAPH_AUTH_URL: string =
        "https://graph.microsoft.com/.default";

    private constructor() {
        this.graphLock = createLimiter(1);
    }

    public static async getInstance(): Promise<GraphClient | undefined> {
        if (!GraphClient.instance) {
            const instance = new GraphClient();

            await instance.graphLock(async () => {
                if (!GraphClient.instance) {
                    let loadSettings: boolean = instance.loadMSGraphSettings();

                    if (loadSettings) {
                        let fInitialized =
                            await instance.initializeGraphFromDeviceCode();

                        if (fInitialized && instance._userClient) {
                            GraphClient.instance = instance;
                        }
                    }
                }
            });
        }
        return GraphClient.instance;
    }

    public loadMSGraphSettings(): boolean {
        this._settings = {
            clientId: process.env["MSGRAPH_APP_CLIENTID"] ?? "",
            clientSecret: process.env["MSGRAPH_APP_CLIENTSECRET"] ?? "",
            tenantId: process.env["MSGRAPH_APP_TENANTID"] ?? "",
            username: process.env["MSGRAPH_APP_USERNAME"] ?? "",
            password: process.env["MSGRAPH_APP_PASSWD"] ?? "",
            graphUserScopes: [
                "user.read",
                "mail.read",
                "mail.send",
                "user.read.all",
                "calendars.readwrite",
            ],
        };

        if (
            this._settings.clientId === "" ||
            this._settings.clientSecret === "" ||
            this._settings.tenantId === ""
        ) {
            this.logger(
                chalk.red(
                    "Please provide valid clientId, clientSecret and tenantId",
                ),
            );
            return false;
        }
        return true;
    }

    public readFileSafely(filePath: string): string | undefined {
        try {
            if (existsSync(filePath)) {
                const fileContent = readFileSync(filePath, {
                    encoding: "utf-8",
                });
                return fileContent;
            }
        } catch (error) {
            console.error("Error reading file:", error);
            return undefined;
        }
    }

    public async authenticateUser(): Promise<boolean> {
        try {
            await this.refreshTokenFromDeviceCodeCred();
            return true;
        } catch (error) {
            this.logger(chalk.red(`Error refreshing token:${error}`));
        }
        return false;
    }

    public async authenticateUserFromCache(): Promise<boolean> {
        if (this._deviceCodeCredential) {
            let authRecord: AuthCacheContent | undefined =
                await this.getAuthRecordFromCache();
            if (authRecord != undefined) {
                const currentTime = new Date().getTime();
                if (currentTime >= authRecord.tokenExpiration) {
                    await this.ensureTokenIsValid();
                }
                return true;
            }
        }
        return false;
    }

    public async initializeGraphFromDeviceCode(): Promise<boolean> {
        let isValidSettings: boolean = this.loadMSGraphSettings();

        if (!isValidSettings || !this._settings) {
            this.logger(chalk.red("Unable to load settings"));
            return false;
        }

        const fileContent = this.readFileSafely(this.AUTH_RECORD_PATH);

        let authRecord: AuthenticationRecord | undefined = undefined;
        if (fileContent) {
            authRecord = deserializeAuthenticationRecord(fileContent);
        }

        if (this._settings === undefined) return false;

        if (authRecord !== undefined) {
            this._deviceCodeCredential = new DeviceCodeCredential({
                clientId: this._settings.clientId,
                tenantId: this._settings.tenantId,
                authenticationRecord: authRecord,
                tokenCachePersistenceOptions: {
                    enabled: true,
                    name: "typeagent-tokencache",
                },
            });
        } else {
            this._deviceCodeCredential = new DeviceCodeCredential({
                clientId: this._settings.clientId,
                tenantId: this._settings.tenantId,
                tokenCachePersistenceOptions: {
                    enabled: true,
                    name: "typeagent-tokencache",
                },
            });
        }

        if (this._deviceCodeCredential) {
            this.createClient(this._deviceCodeCredential);
        }

        return true;
    }

    public async initializeGraphFromUserCred() {
        let isValidSettings: boolean = this.loadMSGraphSettings();

        if (!isValidSettings || !this._settings) {
            this.logger(chalk.red("Unable to load settings"));
        }

        let options: UsernamePasswordCredentialOptions = {
            tokenCachePersistenceOptions: {
                enabled: true,
            },
        };

        if (!this._settings?.username || !this._settings?.password) {
            this.logger(
                chalk.red("Need valid username and password in setting"),
            );
            return;
        }

        this._usernamePasswordCredential = new UsernamePasswordCredential(
            this._settings.tenantId,
            this._settings.clientId,
            this._settings.username,
            this._settings.password,
            options,
        );

        if (this._usernamePasswordCredential) {
            let token = await this._usernamePasswordCredential.getToken(
                this.MSGRAPH_AUTH_URL,
            );
            if (token === undefined) {
                this.logger(chalk.red("Failed to get token"));
                this._usernamePasswordCredential = undefined;
                return;
            }

            await this.refreshTokenFromUsernamePasswdCred();
            this.createClient(this._usernamePasswordCredential);
        }
    }

    private createClient(credential: TokenCredential) {
        if (credential && this._settings?.graphUserScopes) {
            const authProvider = new TokenCredentialAuthenticationProvider(
                credential,
                {
                    scopes: this._settings?.graphUserScopes,
                },
            );

            if (authProvider) {
                this._userClient = Client.initWithMiddleware({
                    authProvider: authProvider,
                });
            }
        }
    }

    public getClient(): Client | undefined {
        return this._userClient;
    }

    private async handleTokenExpiration(): Promise<void> {
        const authRecordPath = this.AUTH_RECORD_PATH;

        if (!existsSync(authRecordPath)) {
            await this.writeAuthRecordToFile();
        } else {
            const fileContent = JSON.parse(
                readFileSync(authRecordPath, "utf8"),
            );
            const tokenExpiration = fileContent.tokenExpiration || 0;

            // Check if the token is expiring within 5 minutes (300,000 ms)
            if (Date.now() >= tokenExpiration - 300000) {
                await this.writeAuthRecordToFile();
            }
        }
    }

    private async writeAuthRecordToFile(): Promise<void> {
        try {
            if (this._deviceCodeCredential !== undefined) {
                const token = await this._deviceCodeCredential.getToken(
                    this.MSGRAPH_AUTH_URL,
                );

                const authRecord =
                    await this._deviceCodeCredential.authenticate(
                        this.MSGRAPH_AUTH_URL,
                    );

                if (authRecord) {
                    const serializedAuthRecord =
                        serializeAuthenticationRecord(authRecord);
                    const content = {
                        authRecord: serializedAuthRecord,
                        tokenExpiration: token.expiresOnTimestamp, // Add token expiration timestamp
                    };
                    writeFileSync(
                        this.AUTH_RECORD_PATH,
                        JSON.stringify(content, null, 2),
                    );
                    this.logger(
                        chalk.green("Token refreshed and expiration saved."),
                    );
                }
            }
        } catch (error) {
            this.logger(
                chalk.red(`Error writing auth record to file: ${error}`),
            );
        }
    }

    public async refreshTokenFromDeviceCodeCred(): Promise<void> {
        const retries = 3;
        if (
            this._deviceCodeCredential !== undefined &&
            this._userClient !== undefined
        ) {
            for (let i = 0; i < retries; i++) {
                try {
                    await this.handleTokenExpiration();
                    return;
                } catch (error) {
                    this.logger(chalk.red(`Error refreshing token:${error}`));
                }
            }
        }
    }

    public async refreshTokenFromUsernamePasswdCred(): Promise<void> {
        const retries = 3;

        if (
            this._usernamePasswordCredential !== undefined &&
            this._userClient !== undefined
        ) {
            for (let i = 0; i < retries; i++) {
                try {
                    if (this._userClient !== undefined) {
                        try {
                            let response = await this._userClient
                                ?.api("/me")
                                .select([
                                    "displayName",
                                    "mail",
                                    "userPrincipalName",
                                ])
                                .get();
                            if (
                                response === undefined ||
                                response.userPrincipalName === undefined
                            )
                                throw new Error(
                                    "Unable to query graph with client",
                                );
                        } catch (error) {
                            this._userClient = undefined;
                        } finally {
                            this._userClient = undefined;
                            await this._usernamePasswordCredential.getToken(
                                this.MSGRAPH_AUTH_URL,
                            );

                            if (this._settings) {
                                this.createClient(
                                    this._usernamePasswordCredential,
                                );
                            }
                            return;
                        }
                    }
                    return;
                } catch (error) {
                    this.logger(chalk.red(`Error refreshing token:${error}`));
                }
            }
        }
    }

    public async getAuthRecordFromCache(): Promise<
        AuthCacheContent | undefined
    > {
        const authRecordPath = path.join(process.cwd(), this.AUTH_RECORD_PATH);
        if (!existsSync(authRecordPath)) {
            return undefined;
        }

        const fileContent = readFileSync(authRecordPath, { encoding: "utf-8" });
        try {
            const content: AuthCacheContent = JSON.parse(fileContent);
            return content;
        } catch (error) {
            this.logger(
                chalk.red(`Error reading auth record from cache:${error}`),
            );
            return undefined;
        }
    }

    public async getUserTokenAsync(): Promise<string> {
        if (!this._settings?.graphUserScopes) {
            this.logger(chalk.red(`Setting "scopes" cannot be undefined`));
        }

        if (this._deviceCodeCredential && this._settings?.graphUserScopes) {
            let token = await this._deviceCodeCredential.getToken(
                this._settings?.graphUserScopes,
            );
            console.log(token);
        }

        if (
            this._usernamePasswordCredential &&
            this._settings?.graphUserScopes
        ) {
            let token = await this._usernamePasswordCredential.getToken(
                this._settings?.graphUserScopes,
            );
            console.log(token);
        }

        return "";
    }

    public async ensureTokenIsValid(): Promise<void> {
        if (!this._userClient) {
            this.logger(
                chalk.red("Graph has not been initialized for user auth"),
            );
        }
        this._deviceCodeCredential
            ? await this.refreshTokenFromDeviceCodeCred()
            : await this.refreshTokenFromUsernamePasswdCred();
    }

    public async getUserAsync(): Promise<User> {
        this.ensureTokenIsValid();
        return this._userClient
            ?.api("/me")
            .select(["displayName", "mail", "userPrincipalName"])
            .get();
    }

    public async getUserInfo(nameHint: string): Promise<any[]> {
        this.ensureTokenIsValid();
        try {
            const response = await this._userClient
                ?.api("/users")
                .filter(`startsWith(displayName, '${nameHint}')`)
                .select("displayName,mail")
                .get();
            return response.value;
        } catch (error) {
            this.logger(chalk.red(`Error finding events${error}`));
        }
        return [];
    }

    public async loadUserEmailAddresses(): Promise<void> {
        await this.ensureTokenIsValid();
        try {
            const response = await this._userClient
                ?.api("/users")
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
            this.logger(
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
            this.logger(chalk.red(`Error fetching email addresses:${error}`));
        }
        return emailAddresses;
    }

    public async getEmailAddressesOfUsernames(
        usernames: string[],
    ): Promise<string[]> {
        await this.ensureTokenIsValid();
        let emailAddresses: string[] = [];
        try {
            for (const username of usernames) {
                const response = await this._userClient
                    ?.api("/users")
                    .filter(`startsWith(displayName, '${username}')`)
                    .select("displayName,userPrincipalName ")
                    .get();

                const user = response.value[0];
                if (user && user.userPrincipalName) {
                    emailAddresses.push(user.userPrincipalName);
                }
            }
        } catch (error) {
            this.logger(chalk.red(`Error fetching email addresses:${error}`));
        }
        return emailAddresses;
    }
}
