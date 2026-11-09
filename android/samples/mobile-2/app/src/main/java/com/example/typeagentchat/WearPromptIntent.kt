package com.example.typeagentchat

import android.content.Intent

internal fun Intent.toWearLinkFields(): WearLinkFields {
    val uri = data
    val hierarchicalUri = uri?.takeIf { it.isHierarchical }
    return WearLinkFields(
        scheme = uri?.scheme,
        host = uri?.host,
        promptQuery = hierarchicalUri?.getQueryParameter(WEAR_PROMPT_PARAM),
        executeQuery = hierarchicalUri?.getQueryParameter(WEAR_EXECUTE_PARAM),
        promptExtra = getStringExtra(WEAR_PROMPT_PARAM)
    )
}
