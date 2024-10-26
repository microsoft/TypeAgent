package com.microsoft.typeagent.sample

import android.content.Context
import android.content.Intent
import android.icu.util.Calendar
import android.net.Uri
import android.provider.AlarmClock
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat.startActivity
import java.time.LocalDateTime
import java.util.Date
import java.util.Locale


class JavaScriptInterface(var context: Context) {

    @JavascriptInterface
    fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    //@JavascriptInterface
    fun startIntent() {
        val latitude = 45.03923F
        val longitude = 122.12343F
        val uri = String.format(Locale.ROOT, "geo:%f,%f", latitude, longitude)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        startActivity(context, intent, null)
    }

    @JavascriptInterface
    fun setAlarm(time: String) {
        val t: LocalDateTime = LocalDateTime.parse(time);
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, t.hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, t.minute)
        startActivity(context, intent, null)
    }
}