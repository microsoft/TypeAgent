package com.example.typeagentchat

internal fun parseYesNoInput(raw: String): Boolean? {
    return when (raw.trim().lowercase()) {
        "y", "yes" -> true
        "n", "no" -> false
        else -> null
    }
}

internal fun parseSingleChoiceIndex(raw: String, optionCount: Int): Int? {
    if (optionCount <= 0) {
        return null
    }
    val value = raw.trim().toIntOrNull() ?: return null
    val zeroBased = value - 1
    return zeroBased.takeIf { it in 0 until optionCount }
}
