package com.xone.music

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.SocketException
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
            .protocols(listOf(Protocol.HTTP_1_1))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
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
                val existingIndex = (0 until ctrl.mediaItemCount).indexOfFirst { idx ->
                    ctrl.getMediaItemAt(idx).mediaId == mediaItem.mediaId
                }
                if (existingIndex >= 0 && ctrl.mediaItemCount > 1) {
                    ctrl.seekTo(existingIndex, 0L)
                } else {
                    ctrl.setMediaItem(mediaItem)
                }
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
    fun setAudioEffects(call: PluginCall) {
        if (XoneBleJamManager.isJamActive()) {
            mainHandler.post {
                XonePlaybackService.instance?.resetAudioEffects()
                ensureController { ctrl ->
                    ctrl.playbackParameters = PlaybackParameters(1.0f, 1.0f)
                    call.resolve(
                        JSObject().apply {
                            put("eightD", false)
                            put("slowedReverb", false)
                        }
                    )
                }
            }
            return
        }

        val eightD = call.getBoolean("eightD") ?: false
        val slowedReverb = call.getBoolean("slowedReverb") ?: false

        mainHandler.post {
            ensureController { ctrl ->
                val service = XonePlaybackService.instance
                service?.setEightDEnabled(eightD)
                service?.setSlowedReverbEnabled(slowedReverb)
                ctrl.playbackParameters = if (slowedReverb) {
                    PlaybackParameters(0.84f, 0.88f)
                } else {
                    PlaybackParameters(1.0f, 1.0f)
                }
                call.resolve(
                    JSObject().apply {
                        put("eightD", eightD)
                        put("slowedReverb", slowedReverb)
                    }
                )
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
        val videoId = XonePlaybackService.sanitizeVideoId(call.getString("videoId"))
        if (videoId.isEmpty()) {
            call.reject("videoId is required")
            return
        }
        val title = call.getString("title")?.trim().orEmpty()
        val artist = call.getString("artist")?.trim().orEmpty()

        pluginScope.launch(Dispatchers.IO) {
            try {
                // Already downloaded in public Music/Xone
                val existingPublic = XonePlaybackService.findPublicOfflineTrackUri(context, videoId)
                if (existingPublic != null) {
                    val size = XonePlaybackService.getOfflineUriSize(context, existingPublic)
                    call.resolve(
                        JSObject().apply {
                            put("localPath", existingPublic.toString())
                            put("sizeBytes", size)
                        }
                    )
                    return@launch
                }

                // Migrate legacy internal file into public Music/Xone if present
                val legacyFile = XonePlaybackService.findLegacyOfflineFile(context, videoId)
                if (legacyFile != null) {
                    val (legacyExt, legacyMime) = sniffLegacyContainer(legacyFile)
                    val legacyName = buildSafeDownloadFileName(videoId, title, artist, legacyExt)
                    val (migratedPath, migratedSize) = writeStreamToPublicMusicXone(
                        videoId = videoId,
                        fileName = legacyName,
                        mimeType = legacyMime,
                        title = title,
                        artist = artist
                    ) { onChunk ->
                        var total = 0L
                        legacyFile.inputStream().use { input ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buf)
                                if (read == -1) break
                                onChunk(buf.copyOfRange(0, read))
                                total += read
                            }
                        }
                        total
                    }
                    legacyFile.delete()
                    call.resolve(
                        JSObject().apply {
                            put("localPath", migratedPath)
                            put("sizeBytes", migratedSize)
                        }
                    )
                    return@launch
                }

                val resolved = XoneExtractor.resolveAudioStream(videoId)
                val (ext, mimeType) = resolveContainerFormat(resolved)
                val fileName = buildSafeDownloadFileName(videoId, title, artist, ext)

                val (savedPath, savedSize) = writeStreamToPublicMusicXone(
                    videoId = videoId,
                    fileName = fileName,
                    mimeType = mimeType,
                    title = title,
                    artist = artist
                ) { onChunk ->
                    downloadStreamChunked(videoId, resolved.streamUrl, onChunk)
                }

                call.resolve(
                    JSObject().apply {
                        put("localPath", savedPath)
                        put("sizeBytes", savedSize)
                    }
                )
            } catch (ex: Exception) {
                call.reject(ex.localizedMessage ?: "Failed to download track", ex)
            }
        }
    }

    @PluginMethod
    fun deleteDownload(call: PluginCall) {
        val videoId = XonePlaybackService.sanitizeVideoId(call.getString("videoId"))
        if (videoId.isEmpty()) {
            call.reject("videoId is required")
            return
        }

        pluginScope.launch(Dispatchers.IO) {
            try {
                var deleted = false

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val where =
                        "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? AND " +
                            "(${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ? OR ${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ?)"
                    val args = arrayOf("%Music/Xone%", "%[$videoId]%", "$videoId.%")
                    val rows = runCatching {
                        context.contentResolver.delete(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            where,
                            args
                        )
                    }.getOrDefault(0)
                    if (rows > 0) deleted = true
                }

                val publicDir = XonePlaybackService.getPublicMusicXoneDir()
                if (publicDir.exists() && publicDir.isDirectory) {
                    publicDir.listFiles()?.forEach { file ->
                        if (
                            file.isFile &&
                            (file.name.contains("[$videoId]") || file.name.startsWith("$videoId."))
                        ) {
                            if (file.delete()) deleted = true
                        }
                    }
                }

                val offlineDir = File(context.filesDir, OFFLINE_TRACKS_DIR)
                val legacyFile = File(offlineDir, "$videoId.audio")
                val legacyTemp = File(offlineDir, "$videoId.audio.tmp")
                if (legacyFile.exists() && legacyFile.delete()) {
                    deleted = true
                }
                if (legacyTemp.exists()) {
                    legacyTemp.delete()
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

    @PluginMethod
    fun openDownloadsFolder(call: PluginCall) {
        mainHandler.post {
            val hostActivity = activity
            if (hostActivity == null) {
                call.reject("Activity unavailable")
                return@post
            }

            runCatching {
                val publicDir = XonePlaybackService.getPublicMusicXoneDir()
                if (!publicDir.exists()) {
                    publicDir.mkdirs()
                }
            }

            val candidates = listOf(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(
                        DocumentsContract.buildDocumentUri(
                            "com.android.externalstorage.documents",
                            "primary:Music/Xone"
                        ),
                        DocumentsContract.Document.MIME_TYPE_DIR
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(
                        DocumentsContract.buildDocumentUri(
                            "com.android.externalstorage.documents",
                            "primary:Music"
                        ),
                        DocumentsContract.Document.MIME_TYPE_DIR
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
                Intent(Intent.ACTION_VIEW).apply {
                    data = DocumentsContract.buildRootUri(
                        "com.android.externalstorage.documents",
                        "primary"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                },
                Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )

            for (intent in candidates) {
                try {
                    hostActivity.startActivity(intent)
                    call.resolve(JSObject().put("opened", true))
                    return@post
                } catch (_: ActivityNotFoundException) {
                    // try next file manager fallback
                } catch (_: SecurityException) {
                    // OEM blocked direct documents URI -> try next fallback
                } catch (_: Exception) {
                    // try next fallback
                }
            }

            call.reject("Unable to open the Music/Xone folder on this device")
        }
    }

    private suspend fun writeStreamToPublicMusicXone(
        videoId: String,
        fileName: String,
        mimeType: String,
        title: String,
        artist: String,
        streamProducer: suspend ((ByteArray) -> Unit) -> Long
    ): Pair<String, Long> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            // Clean up any stale pending rows for this videoId before inserting
            runCatching {
                resolver.delete(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? AND " +
                        "${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ? AND " +
                        "${MediaStore.Audio.Media.IS_PENDING} = 1",
                    arrayOf("%Music/Xone%", "%[$videoId]%")
                )
            }

            val values = ContentValues().apply {
                put(MediaStore.Audio.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Audio.Media.MIME_TYPE, mimeType)
                put(
                    MediaStore.Audio.Media.RELATIVE_PATH,
                    "${Environment.DIRECTORY_MUSIC}/${XonePlaybackService.OFFLINE_PUBLIC_SUBDIR}"
                )
                put(MediaStore.Audio.Media.IS_MUSIC, 1)
                put(MediaStore.Audio.Media.IS_PENDING, 1)
                if (title.isNotEmpty()) put(MediaStore.Audio.Media.TITLE, title)
                if (artist.isNotEmpty()) put(MediaStore.Audio.Media.ARTIST, artist)
            }

            val itemUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("Failed to create MediaStore audio entry in Music/Xone")

            try {
                var writtenBytes = 0L
                val outputStream = resolver.openOutputStream(itemUri, "w")
                    ?: throw IOException("Failed to open output stream for $itemUri")

                outputStream.use { out ->
                    writtenBytes = streamProducer { chunk ->
                        out.write(chunk)
                        out.flush()
                    }
                }

                if (writtenBytes <= 0L) {
                    throw IOException("Downloaded audio stream is empty")
                }

                val finishValues = ContentValues().apply {
                    put(MediaStore.Audio.Media.IS_PENDING, 0)
                    put(MediaStore.Audio.Media.SIZE, writtenBytes)
                }
                resolver.update(itemUri, finishValues, null, null)
                return itemUri.toString() to writtenBytes
            } catch (ex: Exception) {
                runCatching { resolver.delete(itemUri, null, null) }
                throw ex
            }
        } else {
            val publicDir = XonePlaybackService.getPublicMusicXoneDir()
            if (!publicDir.exists() && !publicDir.mkdirs()) {
                throw IOException("Failed to create public Music/Xone directory")
            }

            val targetFile = File(publicDir, fileName)
            val tempFile = File(publicDir, "$fileName.tmp")
            if (tempFile.exists()) tempFile.delete()

            try {
                val writtenBytes = FileOutputStream(tempFile, true).use { out ->
                    val count = streamProducer { chunk ->
                        out.write(chunk)
                        out.flush()
                    }
                    out.fd.sync()
                    count
                }

                if (writtenBytes <= 0L || !tempFile.exists() || tempFile.length() <= 0L) {
                    throw IOException("Downloaded audio stream is empty")
                }

                if (targetFile.exists()) targetFile.delete()
                if (!tempFile.renameTo(targetFile)) {
                    tempFile.copyTo(targetFile, overwrite = true)
                    tempFile.delete()
                }

                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(targetFile.absolutePath),
                    arrayOf(mimeType),
                    null
                )
                return Uri.fromFile(targetFile).toString() to targetFile.length()
            } catch (ex: Exception) {
                if (tempFile.exists()) tempFile.delete()
                throw ex
            }
        }
    }

    private fun resolveContainerFormat(resolved: XoneExtractor.CachedStream): Pair<String, String> {
        return if (
            resolved.acodec == "aac" ||
            resolved.mimeType.contains("mp4", ignoreCase = true)
        ) {
            "m4a" to "audio/mp4"
        } else {
            "opus" to "audio/ogg"
        }
    }

    private fun sniffLegacyContainer(legacyFile: File): Pair<String, String> {
        val header = ByteArray(12)
        val readCount = runCatching {
            legacyFile.inputStream().use { it.read(header) }
        }.getOrDefault(0)
        if (
            readCount >= 8 &&
            header[4] == 'f'.code.toByte() &&
            header[5] == 't'.code.toByte() &&
            header[6] == 'y'.code.toByte() &&
            header[7] == 'p'.code.toByte()
        ) {
            return "m4a" to "audio/mp4"
        }
        return "opus" to "audio/ogg"
    }

    private fun buildSafeDownloadFileName(
        videoId: String,
        title: String?,
        artist: String?,
        ext: String
    ): String {
        val cleanArtist = sanitizeFilePart(artist, 48)
        val cleanTitle = sanitizeFilePart(title, 64)
        val base = when {
            cleanArtist.isNotEmpty() && cleanTitle.isNotEmpty() ->
                "$cleanArtist - $cleanTitle [$videoId]"
            cleanTitle.isNotEmpty() -> "$cleanTitle [$videoId]"
            else -> videoId
        }
        return "$base.$ext"
    }

    private fun sanitizeFilePart(raw: String?, maxLen: Int): String {
        val cleaned = raw.orEmpty()
            .replace(FILE_NAME_UNSAFE_REGEX, " ")
            .replace(WHITESPACE_COLLAPSE_REGEX, " ")
            .trim()
            .trim('.')
        return if (cleaned.length > maxLen) {
            cleaned.substring(0, maxLen).trim().trim('.')
        } else {
            cleaned
        }
    }

    private class HttpStatusException(val code: Int) : IOException("Download failed with HTTP $code")

    private suspend fun downloadStreamChunked(
        videoId: String,
        initialStreamUrl: String,
        onChunk: (ByteArray) -> Unit
    ): Long {
        var currentStreamUrl = initialStreamUrl
        var downloadedBytes = 0L
        var totalBytes = -1L

        while (totalBytes < 0L || downloadedBytes < totalBytes) {
            val rangeEnd = if (totalBytes > 0L) {
                minOf(downloadedBytes + DOWNLOAD_CHUNK_SIZE - 1L, totalBytes - 1L)
            } else {
                downloadedBytes + (DOWNLOAD_CHUNK_SIZE - 1L)
            }

            var chunkWritten = false
            var lastError: Exception? = null

            for (attempt in 1..MAX_CHUNK_ATTEMPTS) {
                try {
                    val request = Request.Builder()
                        .url(currentStreamUrl)
                        .header("User-Agent", DOWNLOAD_USER_AGENT)
                        .header("Origin", YTM_ORIGIN)
                        .header("Referer", YTM_REFERER)
                        .header("Range", "bytes=$downloadedBytes-$rangeEnd")
                        .get()
                        .build()

                    val (chunkBytes, parsedTotal, responseCode) =
                        downloadHttpClient.newCall(request).execute().use { res ->
                            if (!res.isSuccessful) {
                                throw HttpStatusException(res.code)
                            }
                            val body = res.body ?: throw IOException("Empty audio response body")
                            val contentRange = res.header("Content-Range")
                            val totalFromHeader = contentRange?.let { hdr ->
                                CONTENT_RANGE_REGEX.find(hdr)?.groupValues?.getOrNull(1)?.toLongOrNull()
                            } ?: if (res.code == 200) {
                                body.contentLength()
                            } else {
                                -1L
                            }

                            val bufferStream = ByteArrayOutputStream()
                            body.byteStream().use { input ->
                                val buf = ByteArray(64 * 1024)
                                while (true) {
                                    val read = input.read(buf)
                                    if (read == -1) break
                                    bufferStream.write(buf, 0, read)
                                }
                            }
                            Triple(bufferStream.toByteArray(), totalFromHeader, res.code)
                        }

                    if (parsedTotal > 0L) {
                        totalBytes = parsedTotal
                    }

                    if (chunkBytes.isEmpty()) {
                        chunkWritten = true
                        totalBytes = downloadedBytes
                        break
                    }

                    onChunk(chunkBytes)
                    downloadedBytes += chunkBytes.size.toLong()
                    chunkWritten = true

                    if (responseCode == 200 && totalBytes <= 0L) {
                        totalBytes = downloadedBytes
                    }
                    break
                } catch (ex: Exception) {
                    lastError = ex
                    if (attempt >= MAX_CHUNK_ATTEMPTS) {
                        throw ex
                    }
                    delay(CHUNK_RETRY_DELAY_MS)
                    if (
                        ex is SocketException ||
                        ex.cause is SocketException ||
                        (ex is HttpStatusException && ex.code == 403)
                    ) {
                        XoneExtractor.invalidateStream(videoId)
                        currentStreamUrl =
                            XoneExtractor.resolveAudioStream(videoId, forceRefresh = true).streamUrl
                    }
                }
            }

            if (!chunkWritten) {
                throw lastError ?: IOException("Chunk download aborted")
            }
        }

        return downloadedBytes
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
        private const val DOWNLOAD_CHUNK_SIZE = 524_288L
        private const val MAX_CHUNK_ATTEMPTS = 3
        private const val CHUNK_RETRY_DELAY_MS = 300L
        private const val DOWNLOAD_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        private const val YTM_ORIGIN = "https://music.youtube.com"
        private const val YTM_REFERER = "https://music.youtube.com/"
        private val CONTENT_RANGE_REGEX =
            Regex("bytes\\s+\\d+-\\d+/(\\d+)", RegexOption.IGNORE_CASE)
        private val FILE_NAME_UNSAFE_REGEX = Regex("[\\\\/:*?\"<>|\\p{Cntrl}]+")
        private val WHITESPACE_COLLAPSE_REGEX = Regex("\\s+")
    }
}
