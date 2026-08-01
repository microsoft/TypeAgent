package com.example.typeagentchat

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.AlarmClock
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import com.example.typeagentchat.ui.theme.TypeAgentChatTheme

class MainActivity : ComponentActivity() {

    private val webSocketManager = WebSocketManager()
    private val tunnelUrl = BuildConfig.TYPEAGENT_SERVER_URL.trim()
    private val tunnelToken = BuildConfig.TYPEAGENT_TUNNEL_TOKEN.trim().ifBlank { null }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        webSocketManager.setClientActionHandler(object : WebSocketManager.ClientActionHandler {
            override fun onSetAlarm(action: SetAlarmAction) {
                runOnUiThread { launchSetAlarmIntent(action) }
            }

            override fun onSetTimer(action: SetTimerAction) {
                runOnUiThread { launchSetTimerIntent(action) }
            }
        })
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
        webSocketManager.setClientActionHandler(null)
        webSocketManager.disconnect()
        super.onDestroy()
    }

    private fun launchSetAlarmIntent(action: SetAlarmAction) {
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, action.hour)
            putExtra(AlarmClock.EXTRA_MINUTES, action.minute)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            if (action.originalRequest.isNotBlank()) {
                putExtra(AlarmClock.EXTRA_MESSAGE, action.originalRequest)
            }
        }
        launchClockIntent(
            intent = intent,
            actionName = "set-alarm",
            detail = "hour=${action.hour} minute=${action.minute}",
            successMessage = "Alarm set for %02d:%02d".format(action.hour, action.minute),
            missingAppMessage = "No alarm app is available on this device.",
            deniedMessage = "This app is not allowed to set alarms.",
            backgroundMessage = "Could not set the alarm while the app was in the background."
        )
    }

    /**
     * Handles `takeAction("set-timer", ...)` from the androidMobile agent.
     *
     * `EXTRA_SKIP_UI` is true so the clock app starts the countdown in the
     * background instead of coming to the foreground. The reference
     * implementation in TypeAgent PR #2780 (`JavaScriptInterface.setTimer`)
     * passes false; we diverge deliberately so a voice/chat request never
     * yanks the user out of the conversation. The confirmation toast is then
     * the only in-app feedback, so it is not optional - and it must not claim
     * success when the launch was refused. See [launchClockIntent].
     */
    private fun launchSetTimerIntent(action: SetTimerAction) {
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, action.durationInSeconds)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            if (action.originalRequest.isNotBlank()) {
                putExtra(AlarmClock.EXTRA_MESSAGE, action.originalRequest)
            }
        }
        launchClockIntent(
            intent = intent,
            actionName = "set-timer",
            detail = "durationInSeconds=${action.durationInSeconds}",
            successMessage = "Timer set for ${formatTimerDuration(action.durationInSeconds)}",
            missingAppMessage = "No timer app is available on this device.",
            deniedMessage = "This app is not allowed to set timers.",
            backgroundMessage = "Could not set the timer while the app was in the background."
        )
    }

    /**
     * Starts a clock intent and reports the outcome truthfully.
     *
     * Two failure modes are checked up front because neither raises an
     * exception:
     * - no matching activity, which `startActivity` only surfaces as
     *   `ActivityNotFoundException` for implicit intents that resolve to
     *   nothing at dispatch time;
     * - a background activity start, which Android 10+ refuses *silently* -
     *   no `ActivityNotFoundException`, no `SecurityException`, just a logcat
     *   warning. Without this guard the success toast would fire while no
     *   alarm or timer was created, and with `EXTRA_SKIP_UI` that toast is the
     *   user's only feedback.
     */
    private fun launchClockIntent(
        intent: Intent,
        actionName: String,
        detail: String,
        successMessage: String,
        missingAppMessage: String,
        deniedMessage: String,
        backgroundMessage: String
    ) {
        val target = intent.resolveActivity(packageManager)
        Log.d(
            TAG,
            "Launching $actionName intent $detail target=${target?.flattenToShortString() ?: "none"}"
        )
        if (target == null) {
            Log.e(TAG, "No app available to handle $actionName intent")
            Toast.makeText(this, missingAppMessage, Toast.LENGTH_SHORT).show()
            return
        }
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            Log.w(
                TAG,
                "Skipping $actionName intent: activity is ${lifecycle.currentState}, " +
                    "background activity starts are refused without an exception"
            )
            Toast.makeText(this, backgroundMessage, Toast.LENGTH_LONG).show()
            return
        }
        try {
            startActivity(intent)
            Log.d(TAG, "$actionName intent dispatched to clock app")
            Toast.makeText(this, successMessage, Toast.LENGTH_SHORT).show()
        } catch (_: ActivityNotFoundException) {
            Log.e(TAG, "No app available to handle $actionName intent")
            Toast.makeText(this, missingAppMessage, Toast.LENGTH_SHORT).show()
        } catch (error: SecurityException) {
            Log.e(TAG, "Missing permission for $actionName", error)
            Toast.makeText(this, deniedMessage, Toast.LENGTH_SHORT).show()
        }
    }

    private companion object {
        private const val TAG = "MainActivity"
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
    val pendingYesNoPrompt by webSocketManager.pendingYesNoPrompt.collectAsState()
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
                onVoiceInputClick = voiceInput.onStartRequested,
                pendingYesNoPrompt = pendingYesNoPrompt,
                onConfirmYes = { webSocketManager.respondToPendingYesNo(true) },
                onConfirmNo = { webSocketManager.respondToPendingYesNo(false) }
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
    onVoiceInputClick: () -> Unit,
    pendingYesNoPrompt: PendingYesNoPrompt?,
    onConfirmYes: () -> Unit,
    onConfirmNo: () -> Unit
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
            if (pendingYesNoPrompt != null) {
                Text(
                    text = pendingYesNoPrompt.prompt,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(onClick = onConfirmYes) {
                        Text("Yes")
                    }
                    TextButton(onClick = onConfirmNo) {
                        Text("No")
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
                message.segments.forEach { segment ->
                    ChatMessageText(
                        text = segment.text,
                        format = segment.format,
                        color = segmentColor(segment.kind, textColor),
                        style = segmentTextStyle(segment.kind)
                    )
                }
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

/**
 * Mirrors the shell's `chat-message-kind-*` styling: routing notes and other
 * `info`/`status` annotations are de-emphasised so the actual answer stands out.
 */
@Composable
private fun segmentColor(kind: MessageKind, baseColor: Color): Color {
    return when (kind) {
        MessageKind.INFO, MessageKind.STATUS -> baseColor.copy(alpha = 0.6f)
        MessageKind.WARNING -> MaterialTheme.colorScheme.tertiary
        MessageKind.ERROR -> MaterialTheme.colorScheme.error
        MessageKind.SUCCESS, MessageKind.NONE -> baseColor
    }
}

@Composable
private fun segmentTextStyle(kind: MessageKind): TextStyle {
    return if (kind.isSecondary) {
        MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic)
    } else {
        MaterialTheme.typography.bodyLarge
    }
}
