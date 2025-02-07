// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import {
    AndroidMobileAction,
    AutomatePhoneUIAction,
    CallPhoneNumberAction,
    SearchNearbyAction,
    SendSMSAction,
    SetAlarmAction,
} from "./androidMobileSchema.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
        validateWildcardMatch,
    };
}

type PhotoActionContext = {
    store: undefined;
};

async function executeAction(
    action: TypeAgentAction<AndroidMobileAction>,
    context: ActionContext<PhotoActionContext>,
) {
    let result = await handlePhotoAction(action, context);
    return result;
}

async function validateWildcardMatch(
    action: AppAction,
    context: SessionContext<PhotoActionContext>,
) {
    return true;
}

async function initializeAgentContext() {
    return {};
}

async function updateAgentContext(
    enable: boolean,
    context: SessionContext<PhotoActionContext>,
): Promise<void> {}

async function handlePhotoAction(
    action: AndroidMobileAction,
    context: ActionContext<PhotoActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "sendSMS": {
            let smsAction = action as SendSMSAction;
            result = createActionResult(
                `Sending SMS to ${smsAction.parameters.phoneNumber} message '${smsAction.parameters.message}'`,
            );
            context.actionIO.takeAction("send-sms", smsAction.parameters);
            break;
        }
        case "callPhoneNumber": {
            let callAction = action as CallPhoneNumberAction;
            result = createActionResult(
                `Calling ${callAction.parameters.phoneNumber}`,
            );
            context.actionIO.takeAction(
                "call-phonenumber",
                callAction.parameters,
            );
            break;
        }
        case "setAlarm": {
            let alarmAction = action as SetAlarmAction;
            result = createActionResult("Setting Alarm");
            context.actionIO.takeAction("set-alarm", alarmAction.parameters);
            break;
        }
        case "searchNearby": {
            let nearbySearchAction = action as SearchNearbyAction;
            result = createActionResult("Local search");
            context.actionIO.takeAction(
                "search-nearby",
                nearbySearchAction.parameters,
            );
            break;
        }
        case "automateUI": {
            let automateAction = action as AutomatePhoneUIAction;
            result = createActionResult("Automating phone UI");
            context.actionIO.takeAction(
                "automate-phone-ui",
                automateAction.parameters,
            );
            break;
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
    return result;
}
