package com.example.typeagentchat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.example.typeagentchat.ui.theme.TypeAgentChatTheme

class MainActivity : ComponentActivity() {

    private val webSocketManager = WebSocketManager()
    private val tunnelUrl = BuildConfig.TYPEAGENT_SERVER_URL.trim()
    private val tunnelToken = BuildConfig.TYPEAGENT_TUNNEL_TOKEN.trim().ifBlank { null }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        webSocketManager.connect(
            url = tunnelUrl,
            tunnelToken = tunnelToken
        )

        setContent {
            TypeAgentChatTheme {
                ChatApp(
                    webSocketManager = webSocketManager,
                    tunnelUrl = tunnelUrl,
                    tunnelToken = tunnelToken
                )
            }
        }
    }

    override fun onDestroy() {
        webSocketManager.disconnect()
        super.onDestroy()
    }
}

@Composable
private fun ChatApp(
    webSocketManager: WebSocketManager,
    tunnelUrl: String,
    tunnelToken: String?
) {
    val messages by webSocketManager.messages.collectAsState()
    val connectionStatus by webSocketManager.connectionStatus.collectAsState()
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current
    val canSend = connectionStatus.state == ConnectionStatus.State.CONNECTED && inputText.isNotBlank()

    fun submitMessage() {
        if (!canSend) {
            return
        }
        val message = inputText.trim()
        webSocketManager.sendMessage(message)
        inputText = ""
        focusManager.clearFocus()
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            ChatHeader()
            ConnectionStatusIndicator(
                status = connectionStatus,
                onReconnect = {
                    webSocketManager.connect(
                        url = tunnelUrl,
                        tunnelToken = tunnelToken
                    )
                }
            )

            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                shape = RoundedCornerShape(16.dp),
                tonalElevation = 2.dp
            ) {
                if (messages.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No messages yet.\nSend a message once the app is connected.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp),
                        state = listState,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(items = messages, key = { it.id }) { message ->
                            MessageBubble(message = message)
                        }
                    }
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                tonalElevation = 4.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Bottom
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("Message") },
                        placeholder = {
                            Text(
                                if (connectionStatus.state == ConnectionStatus.State.CONNECTED) {
                                    "Ask TypeAgent something"
                                } else {
                                    "Waiting for connection"
                                }
                            )
                        },
                        maxLines = 4,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { submitMessage() })
                    )

                    Button(
                        onClick = { submitMessage() },
                        enabled = canSend,
                        modifier = Modifier.height(56.dp)
                    ) {
                        Text("Send")
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatHeader() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        tonalElevation = 3.dp
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "TypeAgent Chat",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "A simple local chat client for your TypeAgent server.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ConnectionStatusIndicator(
    status: ConnectionStatus,
    onReconnect: () -> Unit
) {
    val indicatorColor = when (status.state) {
        ConnectionStatus.State.CONNECTED -> Color(0xFF2E7D32)
        ConnectionStatus.State.CONNECTING -> Color(0xFFF9A825)
        ConnectionStatus.State.ERROR -> MaterialTheme.colorScheme.error
        ConnectionStatus.State.DISCONNECTED -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (status.state == ConnectionStatus.State.CONNECTING) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = indicatorColor
            )
        } else {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(indicatorColor)
            )
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = status.text,
                style = MaterialTheme.typography.bodyMedium,
                color = indicatorColor,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = when (status.state) {
                    ConnectionStatus.State.CONNECTED -> "Ready to send messages"
                    ConnectionStatus.State.CONNECTING -> "Opening your local TypeAgent session"
                    ConnectionStatus.State.ERROR -> "Check the local server or tap retry"
                    ConnectionStatus.State.DISCONNECTED -> "Connect to start chatting"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (status.state == ConnectionStatus.State.ERROR || status.state == ConnectionStatus.State.DISCONNECTED) {
            TextButton(onClick = onReconnect) {
                Text(if (status.state == ConnectionStatus.State.ERROR) "Retry" else "Connect")
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message) {
    val bubbleColor = if (message.isUser) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.secondaryContainer
    }
    val textColor = if (message.isUser) {
        MaterialTheme.colorScheme.onPrimaryContainer
    } else {
        MaterialTheme.colorScheme.onSecondaryContainer
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.82f)
                .widthIn(max = 320.dp),
            color = bubbleColor,
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = if (message.isUser) "You" else "TypeAgent",
                    color = textColor.copy(alpha = 0.75f),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = message.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodyLarge
                )
                if (!message.isUser && !message.isFinal) {
                    Text(
                        text = "Responding...",
                        color = textColor.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.labelMedium
                    )
                }
            }
        }
    }
}
