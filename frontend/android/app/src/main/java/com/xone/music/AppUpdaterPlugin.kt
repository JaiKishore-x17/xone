package com.xone.music

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(name = "AppUpdater")
class AppUpdaterPlugin : Plugin() {

    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val isDownloading = AtomicBoolean(false)

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }

    override fun handleOnDestroy() {
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getInstalledVersion(call: PluginCall) {
        try {
            val pm = context.packageManager
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(context.packageName, 0)
            }

            val versionName = packageInfo.versionName ?: "1.0.0"
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
            val canInstallPackages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                pm.canRequestPackageInstalls()
            } else {
                true
            }

            val ret = JSObject().apply {
                put("versionName", versionName)
                put("versionCode", versionCode)
                put("canInstallPackages", canInstallPackages)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Unable to read installed app version", e)
        }
    }

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) {
        val url = call.getString("url")?.trim()
        if (url.isNullOrBlank()) {
            call.reject("Missing APK download URL")
            return
        }
        if (!url.startsWith("https://")) {
            call.reject("APK download URL must use HTTPS")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            try {
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(settingsIntent)
                val ret = JSObject().apply {
                    put("started", false)
                    put("permissionRequired", true)
                }
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Unable to open unknown app install permission settings", e)
            }
            return
        }

        if (!isDownloading.compareAndSet(false, true)) {
            call.reject("An update download is already in progress")
            return
        }

        emitDownloadProgress(0, 0L, 0L)

        pluginScope.launch {
            val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
            val tempFile = File(updatesDir, "xone-update.apk.part")
            val apkFile = File(updatesDir, "xone-update.apk")

            try {
                if (tempFile.exists()) tempFile.delete()

                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", "Xone/1.0")
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Download failed (HTTP ${response.code})")
                    }

                    val body = response.body
                        ?: throw IllegalStateException("Empty APK response body")
                    val totalBytes = body.contentLength()
                    var bytesDownloaded = 0L
                    var lastEmittedProgress = 0

                    body.byteStream().use { input ->
                        FileOutputStream(tempFile).use { output ->
                            val buffer = ByteArray(16 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read == -1) break
                                output.write(buffer, 0, read)
                                bytesDownloaded += read

                                if (totalBytes > 0L) {
                                    val progress = ((bytesDownloaded * 100L) / totalBytes)
                                        .toInt()
                                        .coerceIn(0, 99)
                                    if (progress > lastEmittedProgress) {
                                        lastEmittedProgress = progress
                                        emitDownloadProgress(progress, bytesDownloaded, totalBytes)
                                    }
                                }
                            }
                            output.flush()
                        }
                    }

                    if (bytesDownloaded <= 0L) {
                        throw IllegalStateException("Downloaded APK file is empty")
                    }

                    if (apkFile.exists()) apkFile.delete()
                    if (!tempFile.renameTo(apkFile)) {
                        tempFile.copyTo(apkFile, overwrite = true)
                        tempFile.delete()
                    }

                    emitDownloadProgress(100, bytesDownloaded, totalBytes.coerceAtLeast(bytesDownloaded))
                }

                val apkUri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    apkFile
                )

                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_ACTIVITY_NEW_TASK
                    )
                }

                bridge.activity?.runOnUiThread {
                    context.startActivity(installIntent)
                } ?: context.startActivity(installIntent)

                val ret = JSObject().apply {
                    put("started", true)
                    put("permissionRequired", false)
                    put("filePath", apkFile.absolutePath)
                }
                call.resolve(ret)
            } catch (e: Exception) {
                if (tempFile.exists()) tempFile.delete()
                call.reject(e.message ?: "Failed to download and install update", e)
            } finally {
                isDownloading.set(false)
            }
        }
    }

    private fun emitDownloadProgress(progress: Int, bytesDownloaded: Long, totalBytes: Long) {
        val payload = JSObject().apply {
            put("progress", progress)
            put("bytesDownloaded", bytesDownloaded)
            put("totalBytes", totalBytes)
        }
        notifyListeners("downloadProgress", payload)
    }
}
