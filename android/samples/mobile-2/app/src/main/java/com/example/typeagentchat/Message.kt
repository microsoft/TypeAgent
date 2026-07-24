package com.example.typeagentchat

import java.util.UUID

data class Message(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val isUser: Boolean,
    val requestId: String? = null,
    val isFinal: Boolean = false
)
