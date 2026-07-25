package com.example.typeagentchat

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
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
    val voiceInput = rememberVoiceInputController(
        onRecognizedText = { recognizedText ->
            inputText = mergeSpeechInputText(
                currentText = inputText,
                recognizedText = recognizedText
            )
        }
    )

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

            ChatInputBar(
                inputText = inputText,
                onInputTextChange = { inputText = it },
                isConnected = connectionStatus.state == ConnectionStatus.State.CONNECTED,
                canSend = canSend,
                onSend = { submitMessage() },
                isVoiceInputAvailable = voiceInput.isAvailable,
                onVoiceInputClick = voiceInput.onStartRequested
            )
        }
    }
}

private data class VoiceInputController(
    val isAvailable: Boolean,
    val onStartRequested: () -> Unit
)

@Composable
private fun rememberVoiceInputController(
    onRecognizedText: (String) -> Unit
): VoiceInputController {
    val context = LocalContext.current
    val isSpeechAvailable = remember { SpeechRecognizer.isRecognitionAvailable(context) }
    var hasRecordAudioPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        )
    }
    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            return@rememberLauncherForActivityResult
        }
        val recognizedText = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (!recognizedText.isNullOrBlank()) {
            onRecognizedText(recognizedText)
        }
    }

    fun startVoiceInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to TypeAgent")
        }
        try {
            speechLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(
                context,
                "No speech recognition app is available on this device.",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    val requestAudioPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasRecordAudioPermission = granted
        if (granted) {
            startVoiceInput()
        } else {
            Toast.makeText(
                context,
                "Microphone permission is required for voice input.",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    return remember(
        isSpeechAvailable,
        hasRecordAudioPermission,
        requestAudioPermissionLauncher
    ) {
        VoiceInputController(
            isAvailable = isSpeechAvailable,
            onStartRequested = {
                if (!isSpeechAvailable) {
                    Toast.makeText(
                        context,
                        "Voice input is not available on this device.",
                        Toast.LENGTH_SHORT
                    ).show()
                    return@VoiceInputController
                }
                hasRecordAudioPermission = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED
                if (hasRecordAudioPermission) {
                    startVoiceInput()
                } else {
                    requestAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        )
    }
}

private fun mergeSpeechInputText(
    currentText: String,
    recognizedText: String
): String {
    return if (currentText.isBlank()) {
        recognizedText
    } else {
        "$currentText $recognizedText"
    }
}

@Composable
private fun ChatInputBar(
    inputText: String,
    onInputTextChange: (String) -> Unit,
    isConnected: Boolean,
    canSend: Boolean,
    onSend: () -> Unit,
    isVoiceInputAvailable: Boolean,
    onVoiceInputClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        tonalElevation = 4.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = onInputTextChange,
                    modifier = Modifier.weight(1f),
                    label = { Text("Message") },
                    placeholder = {
                        Text(
                            if (isConnected) {
                                "Ask TypeAgent something"
                            } else {
                                "Waiting for connection"
                            }
                        )
                    },
                    maxLines = 4,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { onSend() })
                )

                IconButton(
                    onClick = onVoiceInputClick,
                    enabled = isVoiceInputAvailable,
                    modifier = Modifier.size(56.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.Mic,
                        contentDescription = if (isVoiceInputAvailable) {
                            "Voice input"
                        } else {
                            "Voice input unavailable"
                        },
                        tint = if (isVoiceInputAvailable) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }

                Button(
                    onClick = onSend,
                    enabled = canSend,
                    modifier = Modifier.height(56.dp)
                ) {
                    Text("Send")
                }
            }

            if (!isVoiceInputAvailable) {
                Text(
                    text = "Voice input is unavailable on this device.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
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
