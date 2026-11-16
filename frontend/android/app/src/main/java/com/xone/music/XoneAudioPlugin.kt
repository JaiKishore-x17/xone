package com.xone.music

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "XoneAudio")
class XoneAudioPlugin : Plugin() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newCachedThreadPool()
    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val downloadHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var mediaController: MediaController? = null
    private var isTickerRunning = false

    private val progressTicker = object : Runnable {
        override fun run() {
            val ctrl = mediaController
            if (ctrl != null && (ctrl.isPlaying || ctrl.playbackState == Player.STATE_BUFFERING)) {
                emitPlaybackState(ctrl, errorMessage = null)
                mainHandler.postDelayed(this, 500L)
            } else {
                isTickerRunning = false
            }
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            mediaController?.let { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
                if (isPlaying) startProgressTicker() else stopProgressTicker()
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            mediaController?.let { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
                if (ctrl.isPlaying || playbackState == Player.STATE_BUFFERING) {
                    startProgressTicker()
                } else {
                    stopProgressTicker()
                }
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            mediaController?.let { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
            }
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            mediaController?.let { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            mediaController?.let { ctrl ->
                val message = error.localizedMessage ?: "Audio playback failed"
                emitPlaybackState(ctrl, errorMessage = message)
                stopProgressTicker()
            }
        }
    }

    override fun load() {
        super.load()
        mainHandler.post {
            ensureController { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
            }
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        mainHandler.post {
            ensureController { ctrl ->
                emitPlaybackState(ctrl, errorMessage = null)
                if (ctrl.isPlaying || ctrl.playbackState == Player.STATE_BUFFERING) {
                    startProgressTicker()
                }
            }
        }
    }

    override fun handleOnDestroy() {
        stopProgressTicker()
        mediaController?.removeListener(playerListener)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        mediaController = null
        pluginScope.cancel()
        ioExecutor.shutdownNow()
        super.handleOnDestroy()
    }

    private fun ensureController(onReady: (MediaController) -> Unit) {
        val current = mediaController
        if (current != null && current.isConnected) {
            onReady(current)
            return
        }

        val future = controllerFuture ?: run {
            val sessionToken = SessionToken(
                context,
                ComponentName(context, XonePlaybackService::class.java)
            )
            MediaController.Builder(context, sessionToken).buildAsync().also {
                controllerFuture = it
            }
        }

        future.addListener({
            try {
                val ctrl = future.get()
                if (mediaController !== ctrl) {
                    mediaController?.removeListener(playerListener)
                    mediaController = ctrl
                    ctrl.addListener(playerListener)
                }
                onReady(ctrl)
            } catch (_: Exception) {
                controllerFuture = null
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun startProgressTicker() {
        if (!isTickerRunning) {
            isTickerRunning = true
            mainHandler.removeCallbacks(progressTicker)
            mainHandler.postDelayed(progressTicker, 500L)
        }
    }

    private fun stopProgressTicker() {
        isTickerRunning = false
        mainHandler.removeCallbacks(progressTicker)
    }

    private fun buildMediaItem(trackObj: JSObject): MediaItem? {
        val videoId = trackObj.getString("videoId")?.trim().orEmpty()
        if (videoId.isEmpty()) return null

        val title = trackObj.getString("title")?.trim().orEmpty().ifEmpty { "Untitled Track" }
        val artist = trackObj.getString("artist")?.trim().orEmpty().ifEmpty { "Unknown Artist" }
        val album = trackObj.getString("album")?.trim().orEmpty().ifEmpty { "Xone" }
        val thumbnail = trackObj.getString("thumbnail")?.trim().orEmpty()
        val durationSeconds = (trackObj.opt("durationSeconds") as? Number)?.toInt() ?: 0

        val extras = Bundle().apply {
            putString("video_id", videoId)
            putString("thumbnail", thumbnail)
            putInt("duration_seconds", durationSeconds)
        }

        val metadataBuilder = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setExtras(extras)

        if (thumbnail.isNotEmpty()) {
            metadataBuilder.setArtworkUri(Uri.parse(thumbnail))
        }

        return MediaItem.Builder()
            .setMediaId(videoId)
            .setUri(Uri.parse("${XonePlaybackService.XONE_SCHEME}://track/$videoId"))
            .setMediaMetadata(metadataBuilder.build())
            .build()
    }

    private fun mediaItemToTrackJSObject(item: MediaItem?): JSObject? {
        if (item == null) return null
        val metadata = item.mediaMetadata
        val extras = metadata.extras
        val videoId = extras?.getString("video_id")?.ifEmpty { null } ?: item.mediaId
        if (videoId.isBlank()) return null

        val artistStr = metadata.artist?.toString()?.ifEmpty { null } ?: "Unknown Artist"
        val titleStr = metadata.title?.toString()?.ifEmpty { null } ?: "Untitled Track"
        val albumStr = metadata.albumTitle?.toString() ?: ""
        val thumbStr = extras?.getString("thumbnail")
            ?: metadata.artworkUri?.toString()
            ?: "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"
        val durationSeconds = extras?.getInt("duration_seconds", 0) ?: 0

        val artistsArr = JSArray()
        for (part in artistStr.split(",")) {
            val trimmed = part.trim()
            if (trimmed.isNotEmpty()) artistsArr.put(trimmed)
        }

        return JSObject().apply {
            put("id", videoId)
            put("video_id", videoId)
            put("title", titleStr)
            put("artist", artistStr)
            put("artists", artistsArr)
            put("album", albumStr)
            put("album_id", JSObject.NULL)
            put("thumbnail", thumbStr)
            put("duration", formatSeconds(durationSeconds))
            put("duration_seconds", durationSeconds)
            put("video_type", "MUSIC_VIDEO_TYPE_ATV")
        }
    }

    private fun emitPlaybackState(ctrl: MediaController, errorMessage: String?) {
        val currentItem = ctrl.currentMediaItem
        val extrasDur = currentItem?.mediaMetadata?.extras?.getInt("duration_seconds", 0) ?: 0
        val playerDurSec = if (ctrl.duration != C.TIME_UNSET && ctrl.duration > 0L) {
            ctrl.duration / 1000.0
        } else {
            extrasDur.toDouble()
        }

        val isPlayingEffective =
            ctrl.isPlaying || (ctrl.playWhenReady && ctrl.playbackState == Player.STATE_BUFFERING)

        val payload = JSObject().apply {
            put("isPlaying", isPlayingEffective)
            put("isBuffering", ctrl.playbackState == Player.STATE_BUFFERING)
            put("currentTime", ctrl.currentPosition.coerceAtLeast(0L) / 1000.0)
            put("duration", playerDurSec)
            put("ended", ctrl.playbackState == Player.STATE_ENDED)
            if (errorMessage != null) {
                put("error", errorMessage)
            } else {
                put("error", JSObject.NULL)
            }
            val trackObj = mediaItemToTrackJSObject(currentItem)
            if (trackObj != null) {
                put("currentTrack", trackObj)
            } else {
                put("currentTrack", JSObject.NULL)
            }
        }

        notifyListeners("playbackState", payload)
    }

    @PluginMethod
    fun playTrack(call: PluginCall) {
        val mediaItem = buildMediaItem(call.data)
        if (mediaItem == null) {
            call.reject("videoId is required")
            return
        }

        mainHandler.post {
            ensureController { ctrl ->
                ctrl.setMediaItem(mediaItem)
                ctrl.prepare()
                ctrl.play()
                startProgressTicker()
                emitPlaybackState(ctrl, errorMessage = null)

                val result = JSObject().apply {
                    put("started", true)
                }
                call.resolve(result)
            }
        }
    }

    @PluginMethod
    fun togglePlayPause(call: PluginCall) {
        val explicitPlaying = if (call.data.has("playing") && !call.data.isNull("playing")) {
            call.getBoolean("playing")
        } else {
            null
        }

        mainHandler.post {
            ensureController { ctrl ->
                val targetPlaying = explicitPlaying ?: !(ctrl.isPlaying || ctrl.playWhenReady)
                if (targetPlaying) {
                    ctrl.play()
                    startProgressTicker()
                } else {
                    ctrl.pause()
                    stopProgressTicker()
                }
                emitPlaybackState(ctrl, errorMessage = null)

                val result = JSObject().apply {
                    put("isPlaying", targetPlaying)
                }
                call.resolve(result)
            }
        }
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val posMs = (call.data.opt("positionMs") as? Number)?.toLong() ?: 0L
        mainHandler.post {
            ensureController { ctrl ->
                ctrl.seekTo(posMs.coerceAtLeast(0L))
                emitPlaybackState(ctrl, errorMessage = null)
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun setQueue(call: PluginCall) {
        val tracksArray = call.getArray("tracks")
        if (tracksArray == null) {
            call.resolve()
            return
        }

        val items = ArrayList<MediaItem>(tracksArray.length())
        for (i in 0 until tracksArray.length()) {
            val jsonObj = tracksArray.optJSONObject(i) ?: continue
            val item = buildMediaItem(JSObject.fromJSONObject(jsonObj))
            if (item != null) {
                items.add(item)
            }
        }

        val requestedIndex = (call.data.opt("startIndex") as? Number)?.toInt() ?: 0
        val safeStartIndex = if (items.isEmpty()) 0 else requestedIndex.coerceIn(0, items.size - 1)
        val repeatModeStr = call.getString("repeatMode")

        mainHandler.post {
            ensureController { ctrl ->
                when (repeatModeStr) {
                    "one" -> if (ctrl.repeatMode != Player.REPEAT_MODE_ONE) ctrl.repeatMode = Player.REPEAT_MODE_ONE
                    "all" -> if (ctrl.repeatMode != Player.REPEAT_MODE_ALL) ctrl.repeatMode = Player.REPEAT_MODE_ALL
                    "off" -> if (ctrl.repeatMode != Player.REPEAT_MODE_OFF) ctrl.repeatMode = Player.REPEAT_MODE_OFF
                }

                if (items.isNotEmpty()) {
                    val targetItem = items[safeStartIndex]
                    val currentItem = ctrl.currentMediaItem
                    if (currentItem != null && currentItem.mediaId == targetItem.mediaId && ctrl.mediaItemCount > 0) {
                        val existingIds = (0 until ctrl.mediaItemCount).map { idx -> ctrl.getMediaItemAt(idx).mediaId }
                        val incomingIds = items.map { it.mediaId }
                        if (existingIds != incomingIds || ctrl.currentMediaItemIndex != safeStartIndex) {
                            val curIdx = ctrl.currentMediaItemIndex
                            if (ctrl.mediaItemCount > curIdx + 1) {
                                ctrl.removeMediaItems(curIdx + 1, ctrl.mediaItemCount)
                            }
                            if (curIdx > 0) {
                                ctrl.removeMediaItems(0, curIdx)
                            }
                            if (safeStartIndex > 0) {
                                ctrl.addMediaItems(0, items.subList(0, safeStartIndex))
                            }
                            if (safeStartIndex + 1 < items.size) {
                                ctrl.addMediaItems(items.subList(safeStartIndex + 1, items.size))
                            }
                        }
                    } else if (ctrl.mediaItemCount == 0) {
                        ctrl.setMediaItems(items, safeStartIndex, 0L)
                        ctrl.prepare()
                    }
                }
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val vol = (call.data.opt("volume") as? Number)?.toFloat() ?: 1.0f
        mainHandler.post {
            ensureController { ctrl ->
                ctrl.volume = vol.coerceIn(0f, 1f)
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun searchSongs(call: PluginCall) {
        val query = call.getString("query")?.trim().orEmpty()
        if (query.isEmpty()) {
            val empty = JSObject().apply {
                put("topResult", JSObject.NULL)
                put("songs", JSArray())
            }
            call.resolve(empty)
            return
        }

        ioExecutor.execute {
            try {
                val payload = XoneExtractor.searchSongs(query)
                call.resolve(payload.toJSObject())
            } catch (ex: Exception) {
                call.reject(ex.localizedMessage ?: "Search failed", ex)
            }
        }
    }

    @PluginMethod
    fun getRadioQueue(call: PluginCall) {
        val videoId = call.getString("videoId")?.trim().orEmpty()
        val limit = (call.data.opt("limit") as? Number)?.toInt() ?: 20
        if (videoId.isEmpty()) {
            call.resolve(JSObject().put("tracks", JSArray()))
            return
        }

        ioExecutor.execute {
            try {
                val tracks = XoneExtractor.getRadioQueue(videoId, limit)
                val arr = JSArray()
                for (t in tracks) {
                    arr.put(t.toJSObject())
                }
                call.resolve(JSObject().put("tracks", arr))
            } catch (ex: Exception) {
                call.reject(ex.localizedMessage ?: "Failed to load radio queue", ex)
            }
        }
    }

    @PluginMethod
    fun downloadTrack(call: PluginCall) {
        val videoId = sanitizeVideoId(call.getString("videoId"))
        if (videoId.isEmpty()) {
            call.reject("videoId is required")
            return
        }

        pluginScope.launch(Dispatchers.IO) {
            val offlineDir = File(context.filesDir, OFFLINE_TRACKS_DIR)
            val targetFile = File(offlineDir, "$videoId.audio")
            val tempFile = File(offlineDir, "$videoId.audio.tmp")

            try {
                if (!offlineDir.exists() && !offlineDir.mkdirs()) {
                    throw IOException("Failed to create offline storage directory")
                }

                if (targetFile.exists() && targetFile.length() > 0L) {
                    call.resolve(
                        JSObject().apply {
                            put("localPath", targetFile.absolutePath)
                            put("sizeBytes", targetFile.length())
                        }
                    )
                    return@launch
                }

                var resolved = XoneExtractor.resolveAudioStream(videoId)
                var statusCode = downloadStreamToTempFile(resolved.streamUrl, tempFile)
                if (statusCode !in 200..299) {
                    tempFile.delete()
                    XoneExtractor.invalidateStream(videoId)
                    resolved = XoneExtractor.resolveAudioStream(videoId, forceRefresh = true)
                    statusCode = downloadStreamToTempFile(resolved.streamUrl, tempFile)
                    if (statusCode !in 200..299) {
                        throw IOException("Download failed with HTTP $statusCode")
                    }
                }

                if (!tempFile.exists() || tempFile.length() <= 0L) {
                    throw IOException("Downloaded audio stream is empty")
                }

                if (targetFile.exists()) {
                    targetFile.delete()
                }
                if (!tempFile.renameTo(targetFile)) {
                    tempFile.copyTo(targetFile, overwrite = true)
                    tempFile.delete()
                }

                call.resolve(
                    JSObject().apply {
                        put("localPath", targetFile.absolutePath)
                        put("sizeBytes", targetFile.length())
                    }
                )
            } catch (ex: Exception) {
                if (tempFile.exists()) {
                    tempFile.delete()
                }
                call.reject(ex.localizedMessage ?: "Failed to download track", ex)
            }
        }
    }

    @PluginMethod
    fun deleteDownload(call: PluginCall) {
        val videoId = sanitizeVideoId(call.getString("videoId"))
        if (videoId.isEmpty()) {
            call.reject("videoId is required")
            return
        }

        pluginScope.launch(Dispatchers.IO) {
            try {
                val offlineDir = File(context.filesDir, OFFLINE_TRACKS_DIR)
                val targetFile = File(offlineDir, "$videoId.audio")
                val tempFile = File(offlineDir, "$videoId.audio.tmp")
                var deleted = false
                if (targetFile.exists()) {
                    deleted = targetFile.delete()
                }
                if (tempFile.exists()) {
                    tempFile.delete()
                }
                call.resolve(
                    JSObject().apply {
                        put("deleted", deleted)
                        put("videoId", videoId)
                    }
                )
            } catch (ex: Exception) {
                call.reject(ex.localizedMessage ?: "Failed to delete downloaded track", ex)
            }
        }
    }

    private fun downloadStreamToTempFile(streamUrl: String, tempFile: File): Int {
        val request = Request.Builder()
            .url(streamUrl)
            .header("User-Agent", OkHttpDownloader.USER_AGENT)
            .get()
            .build()

        downloadHttpClient.newCall(request).execute().use { res ->
            if (!res.isSuccessful) {
                return res.code
            }
            val body = res.body ?: throw IOException("Empty audio response body")
            body.byteStream().use { input ->
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                    output.fd.sync()
                }
            }
            return res.code
        }
    }

    private fun sanitizeVideoId(raw: String?): String {
        return raw?.trim()?.replace(VIDEO_ID_SANITIZE_REGEX, "").orEmpty()
    }

    private fun formatSeconds(totalSeconds: Int): String {
        if (totalSeconds <= 0) return "0:00"
        val hrs = totalSeconds / 3600
        val mins = (totalSeconds % 3600) / 60
        val secs = totalSeconds % 60
        return if (hrs > 0) {
            String.format(Locale.US, "%d:%02d:%02d", hrs, mins, secs)
        } else {
            String.format(Locale.US, "%d:%02d", mins, secs)
        }
    }

    companion object {
        private const val OFFLINE_TRACKS_DIR = "offline_tracks"
        private val VIDEO_ID_SANITIZE_REGEX = Regex("[^a-zA-Z0-9_-]")
    }
}
