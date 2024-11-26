package com.microsoft.typeagent.sample

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.AlarmClock
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.ContextCompat.startActivities
import androidx.core.content.ContextCompat.startActivity
import de.andycandy.android.bridge.CallType
import de.andycandy.android.bridge.DefaultJSInterface
import de.andycandy.android.bridge.JSFunctionWithArg
import de.andycandy.android.bridge.NativeCall
import de.andycandy.android.bridge.Promise
import java.time.LocalDateTime
import java.util.Locale
import java.util.concurrent.locks.Condition

typealias SpeechRecognitionCallback = (String) -> Void;


class JavaScriptInterface(var context: Context) : DefaultJSInterface("Android") {

    public var speechCallback: SpeechRecognitionCallback? = null
    public var speechPromise: Promise<String?>? = null
    private var recoId: Int = 0
    private val recoLocks: MutableMap<Int, Condition> = mutableMapOf()
    private val recoCallbacks: MutableMap<Int, JSFunctionWithArg<String?>> = mutableMapOf()

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
        Log.i("javascript", "setAlarm")
        val t: LocalDateTime = LocalDateTime.parse(time);
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, t.hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, t.minute)
        startActivity(context, intent, null)
    }

    @JavascriptInterface
    fun callPhoneNumber(phoneNumber: String) {
        Log.i("javascript", "callPhoneNumber")
        val uri = String.format(Locale.ROOT, "tel:%s", phoneNumber)
        val intent = Intent(Intent.ACTION_CALL, Uri.parse(uri))
        startActivity(context, intent, null);
    }

    @JavascriptInterface
     fun sendSMS(phoneNumber: String, message: String) {
         Log.i("javascript", "sendSMS")
        val uri = String.format(Locale.ROOT, "smsto:%s", phoneNumber)
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse(uri))
            .putExtra("sms_body", message);
        startActivity(context, intent, null)
    }

    @JavascriptInterface
    fun searchNearby(searchTerm: String) {
        Log.i("javascript", "searchNearby")
        val uri = Uri.parse("geo:0,0?q=$searchTerm")
        val intent = Intent(Intent.ACTION_VIEW, uri)
        intent.setPackage("com.google.android.apps.maps")
        startActivity(context, intent, null)
    }

    @JavascriptInterface
    fun isSpeechRecognitionSupported(): Boolean {
        return PackageManager.PERMISSION_GRANTED == ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO)
    }

    @JavascriptInterface
    fun automateUI(prompt: String) {
        Log.i("javascript", "automateUI")
        val uri = Uri.parse("maia://main?execute=true&prompt=${prompt}")
        val intent = Intent(Intent.ACTION_VIEW)
            .setData(uri)
            .putExtra("prompt", prompt)
            .addCategory(Intent.CATEGORY_BROWSABLE)
        context.startActivity(intent)
    }

    /**
     * Called by the client once the app has fully loaded
     * TypeScript types in lib.android.d.ts as Bridge.interfaces.Android.domReady()
     */
    @NativeCall(CallType.FULL_SYNC)
    fun domReady(callback: JSFunctionWithArg<String>?) {
        // if there's an initial prompt we should send that here
        if (callback != null) {
            MainActivity.currentActivity!!.prompt?.let { callback.call(it) }
        }
    }

    /**
     * Starts a recognition request, awaits the result and returns the result as a promise
     * TypeScript types in lib.android.d.ts as Bridge.interfaces.Android.recognize()
     */
    @NativeCall(CallType.FULL_SYNC)
    fun recognize(callback: JSFunctionWithArg<String?>) {
        // set speech callback
        val id = ++recoId;
        recoCallbacks[id] = callback

        // start speech reco
        MainActivity.currentActivity!!.speechToText(id)
    }

    /**
     * Calls recognition callbacks
     */
    fun recognitionComplete(id: Int, text: String?) {
        if (recoCallbacks.containsKey(id)) {
            recoCallbacks[id]!!.call(text)
            recoLocks.remove(id)
        }
    }
}