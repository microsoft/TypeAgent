// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as msal from "@azure/msal-browser";
import { loginRequest, msalConfig, tokenRequest } from "./authConfig";
import { showWelcomeMessage, updateUI } from "./ui";
import { callMSGraph } from "./graph";

export class SPAAuthRedirect {
    // Create the main myMSALObj instance
    // configuration parameters are located at authConfig.js
    private myMSALObj: msal.PublicClientApplication;
    private username: string = "";

    constructor(signInButton: HTMLButtonElement) {
        signInButton.onclick = () => {
            if (this.username.length == 0) {
                this.signIn();
            } else {
                this.signOut();
            }
        }
        this.myMSALObj = new msal.PublicClientApplication(msalConfig);
    }

    async initalize() {
        await this.myMSALObj.initialize();

        /**
         * A promise handler needs to be registered for handling the
         * response returned from redirect flow. For more information, visit:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/acquire-token.md
         */
        this.myMSALObj.handleRedirectPromise()
        .then((response) => {
            if (response !== null) {
                console.log(`Logged in as ${response.account.username}`);
                this.username = response.account.username;                
                showWelcomeMessage(this.username);
            } else {
                this.selectAccount();
            }
        })
        .catch((error) => {
            console.error(error);
        });
    }

    selectAccount() {

        /**
         * See here for more info on account retrieval: 
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/docs/Accounts.md
         */

        const currentAccounts = this.myMSALObj.getAllAccounts();

        if (currentAccounts.length === 0) {
            return;
        } else if (currentAccounts.length > 1) {
            // Add your account choosing logic here
            console.warn("Multiple accounts detected.");
        } else if (currentAccounts.length === 1) {
            console.log(`Logged in as ${currentAccounts[0].username}`);
            this.username = currentAccounts[0].username;
            showWelcomeMessage(this.username);
        }
    }

    signIn() {

        /**
         * You can pass a custom request object below. This will override the initial configuration. For more information, visit:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/request-response-object.md#request
         */

        this.myMSALObj.loginRedirect(loginRequest);
    }

    signOut() {

        /**
         * You can pass a custom request object below. This will override the initial configuration. For more information, visit:
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/request-response-object.md#request
         */

        const logoutRequest = {
            account: this.myMSALObj.getAccountByUsername(this.username),
            postLogoutRedirectUri: msalConfig.auth.redirectUri,
        };

        this.myMSALObj.logoutRedirect(logoutRequest);
    }

    getTokenRedirect(request) {
        /**
         * See here for more info on account retrieval: 
         * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/docs/Accounts.md
         */
        request.account = this.myMSALObj.getAccountByUsername(this.username);

        return this.myMSALObj.acquireTokenSilent(request)
            .catch(error => {
                console.warn("silent token acquisition fails. acquiring token using redirect");
                if (error instanceof msal.InteractionRequiredAuthError) {
                    // fallback to interaction when silent call fails
                    return this.myMSALObj.acquireTokenRedirect(request);
                } else {
                    console.warn(error);   
                }

                return;
            });
    }

    seeProfile() {
        this.getTokenRedirect(loginRequest)
            .then(response => {
                callMSGraph(graphConfig.graphMeEndpoint, response!.accessToken, updateUI);
            }).catch(error => {
                console.error(error);
            });
    }

    readMail() {
        this.getTokenRedirect(tokenRequest)
            .then(response => {
                callMSGraph(graphConfig.graphMailEndpoint, response!.accessToken, updateUI);
            }).catch(error => {
                console.error(error);
            });
    }

    public async getToken(): Promise<msal.AuthenticationResult | undefined | void> {
        return await this.getTokenRedirect(tokenRequest);
    }
}
