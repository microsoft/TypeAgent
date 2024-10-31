// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as msal from "@azure/msal-browser";
import { AuthResponseCallback } from "./authRedirect.js";
import { loginRequest, msalConfig, tokenRequest } from "./authConfig.js";

export class SPAAuthPopup {
    private static instance: SPAAuthPopup;
    private static initialized: boolean = false;
    private static initializedCallbacks: Array<AuthResponseCallback> =
        new Array<AuthResponseCallback>();

    public static getInstance = (): SPAAuthPopup => {
        if (!SPAAuthPopup.instance) {
            SPAAuthPopup.instance = new SPAAuthPopup();
        }

        return SPAAuthPopup.instance;
    };

    public static IsInitialized(): boolean {
        return SPAAuthPopup.initialized;
    }

    public static registerInitializationCallback(
        callback: AuthResponseCallback,
    ) {
        if (SPAAuthPopup.initialized) {
            throw new Error("Authentication already initialized");
        }

        this.initializedCallbacks.push(callback);
    }

    // Create the main myMSALObj instance
    // configuration parameters are located at authConfig.js
    private myMSALObj: msal.PublicClientApplication;
    private username: string = "";
    private token: string = "";
    private expires: Date | null = new Date();

    private constructor() {
        this.myMSALObj = new msal.PublicClientApplication(msalConfig);
    }

    async initalize(signInButton: HTMLButtonElement): Promise<void> {
        signInButton.onclick = () => {
            if (this.username.length == 0) {
                this.signIn();
            } else {
                this.signOut();
            }
        };

        await this.myMSALObj.initialize();

        this.myMSALObj.handleRedirectPromise().then((response) => {
            if (response !== null) {
                this.username = response.account.username;
                this.token = response.accessToken;
                this.expires = response.expiresOn;
                // welcomeUser(username);
                // updateTable(response.account);
            } else {
                this.selectAccount();

                /**
                 * If you already have a session that exists with the authentication server, you can use the ssoSilent() API
                 * to make request for tokens without interaction, by providing a "login_hint" property. To try this, comment the
                 * line above and uncomment the section below.
                 */

                // myMSALObj.ssoSilent(silentRequest).
                //     then((response) => {
                //          welcomeUser(response.account.username);
                //          updateTable(response.account);
                //     }).catch(error => {
                //         console.error("Silent Error: " + error);
                //         if (error instanceof msal.InteractionRequiredAuthError) {
                //             signIn();
                //         }
                //     });
            }

            SPAAuthPopup.initialized = true;
        });
    }

    selectAccount() {
        /**
         * See here for more info on account retrieval:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/docs/Accounts.md
         */

        const currentAccounts = this.myMSALObj.getAllAccounts();

        if (!currentAccounts || currentAccounts.length < 1) {
            return;
        } else if (currentAccounts.length > 1) {
            // Add your account choosing logic here
            console.warn("Multiple accounts detected.");
            this.username = currentAccounts[0].username;
            this.token = this.token;
            this.expires = this.expires;
        } else if (currentAccounts.length === 1) {
            this.username = currentAccounts[0].username;
            // welcomeUser(currentAccounts[0].username);
            // updateTable(currentAccounts[0]);
            this.token = this.token;
            this.expires = this.expires;
        }
    }

    signIn() {
        /**
         * You can pass a custom request object below. This will override the initial configuration. For more information, visit:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/request-response-object.md#request
         */

        this.myMSALObj
            .loginPopup(loginRequest)
            .then(async (response) => {
                if (response !== null) {
                    this.username = response.account.username;
                    this.token = response.accessToken;
                    this.expires = response.expiresOn;
                    // welcomeUser(username);
                    // updateTable(response.account);
                } else {
                    this.selectAccount();

                    // /**
                    //  * If you already have a session that exists with the authentication server, you can use the ssoSilent() API
                    //  * to make request for tokens without interaction, by providing a "login_hint" property. To try this, comment the
                    //  * line above and uncomment the section below.
                    //  */
                    // this.myMSALObj.ssoSilent({loginHint: this.username})
                    //     .then((response) => {
                    //         this.username = response.account.username;
                    //         this.token = response.accessToken;
                    //         this.expires = response.expiresOn;

                    //         //  welcomeUser(response.account.username);
                    //         //  updateTable(response.account);
                    //     }).catch(error => {
                    //         console.error("Silent Error: " + error);
                    //         if (error instanceof msal.InteractionRequiredAuthError) {
                    //             this.signIn();
                    //         }
                    //     });

                    // let r = await this.myMSALObj.acquireTokenSilent(tokenRequest);
                    // console.log(r);
                }
            })
            .catch((error) => {
                console.error(error);
            });
    }

    signOut() {
        /**
         * You can pass a custom request object below. This will override the initial configuration. For more information, visit:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/request-response-object.md#request
         */

        // Choose which account to logout from by passing a username.
        const logoutRequest = {
            account: this.myMSALObj.getAccountByUsername(this.username),
            mainWindowRedirectUri: "/",
        };

        this.myMSALObj.logoutPopup(logoutRequest);
    }

    async getToken() {
        //: Promise<msal.AuthenticationResult | undefined | void> {

        if (new Date() < this.expires! && this.token.length > 0) {
            //return this.token;
        }

        try {
            this.myMSALObj.setActiveAccount(this.myMSALObj.getAllAccounts()[0]);
            let r = await this.myMSALObj.acquireTokenSilent(tokenRequest);
            console.log(r);
        } catch (error) {
            if (error instanceof msal.InteractionRequiredAuthError) {
                this.signIn();
            }
        }

        return {
            token: this.token,
            expire: Number(this.expires),
            region: "westus",
            endpoint:
                "/subscriptions/b64471de-f2ac-4075-a3cb-7656bca768d0/resourceGroups/openai_dev/providers/Microsoft.CognitiveServices/accounts/octo-aisystems",
        };
    }
}
