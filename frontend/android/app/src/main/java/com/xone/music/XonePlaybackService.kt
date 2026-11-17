package com.xone.music

import android.app.PendingIntent
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import java.io.File
import java.io.IOException

@OptIn(UnstableApi::class)
class XonePlaybackService : MediaSessionService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val effectsProcessor = XoneAudioEffectsProcessor()

    @Volatile
    private var eightDEnabled = false

    @Volatile
    private var srEnabled = false

    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var lastRetriedVideoId: String? = null

    fun setEightDEnabled(enabled: Boolean) {
        val effective = if (XoneBleJamManager.isJamActive()) false else enabled
        eightDEnabled = effective
        effectsProcessor.eightDEnabled = effective
    }

    fun setSlowedReverbEnabled(enabled: Boolean) {
        val effective = if (XoneBleJamManager.isJamActive()) false else enabled
        srEnabled = effective
        effectsProcessor.srEnabled = effective
        val targetParams = if (effective) {
            PlaybackParameters(0.84f, 0.88f)
        } else {
            PlaybackParameters(1.0f, 1.0f)
        }
        applyPlaybackParameters(targetParams)
    }

    fun resetAudioEffects() {
        eightDEnabled = false
        srEnabled = false
        effectsProcessor.eightDEnabled = false
        effectsProcessor.srEnabled = false
        effectsProcessor.clearState()
        applyPlaybackParameters(PlaybackParameters(1.0f, 1.0f))
    }

    private fun applyPlaybackParameters(params: PlaybackParameters) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            player?.playbackParameters = params
        } else {
            mainHandler.post {
                player?.playbackParameters = params
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        OkHttpDownloader.ensureInitialized()

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(OkHttpDownloader.USER_AGENT)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val upstreamDataSourceFactory = DefaultDataSource.Factory(this, httpDataSourceFactory)

        val resolvingDataSourceFactory = ResolvingDataSource.Factory(upstreamDataSourceFactory) { dataSpec ->
            val uri = dataSpec.uri
            if (uri.scheme == XONE_SCHEME) {
                val rawVideoId = uri.lastPathSegment
                    ?: throw IOException("Missing track videoId in URI: $uri")
                val videoId = sanitizeVideoId(rawVideoId)
                val offlineUri = findOfflineTrackUri(this, videoId)
                if (offlineUri != null) {
                    dataSpec.buildUpon().setUri(offlineUri).build()
                } else {
                    val resolved = XoneExtractor.resolveAudioStream(videoId)
                    dataSpec.buildUpon().setUri(Uri.parse(resolved.streamUrl)).build()
                }
            } else {
                dataSpec
            }
        }

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, 50_000, 250, 500)
            .build()

        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink {
                return DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(false)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf(effectsProcessor))
                    .build()
            }
        }

        val exoPlayer = ExoPlayer.Builder(this)
            .setRenderersFactory(renderersFactory)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(resolvingDataSourceFactory))
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        exoPlayer.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (mediaItem?.mediaId != lastRetriedVideoId) {
                    lastRetriedVideoId = null
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    lastRetriedVideoId = null
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val item = exoPlayer.currentMediaItem ?: return
                val videoId = item.mediaId
                if (videoId.isNotBlank() && lastRetriedVideoId != videoId) {
                    lastRetriedVideoId = videoId
                    val resumeMs = exoPlayer.currentPosition.coerceAtLeast(0L)
                    XoneExtractor.invalidateStream(videoId)
                    exoPlayer.seekTo(exoPlayer.currentMediaItemIndex, resumeMs)
                    exoPlayer.prepare()
                    exoPlayer.playWhenReady = true
                }
            }
        })

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val sessionActivityPendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            pendingFlags
        )

        val session = MediaSession.Builder(this, exoPlayer)
            .setSessionActivity(sessionActivityPendingIntent)
            .build()

        player = exoPlayer
        mediaSession = session
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val currentPlayer = player
        if (currentPlayer == null || !currentPlayer.playWhenReady || currentPlayer.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        if (instance === this) {
            instance = null
        }
        effectsProcessor.eightDEnabled = false
        effectsProcessor.srEnabled = false
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        player = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: XonePlaybackService? = null
            private set

        const val XONE_SCHEME = "xone"
        const val OFFLINE_PUBLIC_SUBDIR = "Xone"
        const val LEGACY_OFFLINE_DIR = "offline_tracks"
        private val VIDEO_ID_SANITIZE_REGEX = Regex("[^a-zA-Z0-9_-]")

        fun sanitizeVideoId(raw: String?): String {
            return raw?.trim()?.replace(VIDEO_ID_SANITIZE_REGEX, "").orEmpty()
        }

        fun getPublicMusicXoneDir(): File {
            @Suppress("DEPRECATION")
            val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
            return File(musicDir, OFFLINE_PUBLIC_SUBDIR)
        }

        fun findLegacyOfflineFile(context: Context, rawVideoId: String): File? {
            val videoId = sanitizeVideoId(rawVideoId)
            if (videoId.isEmpty()) return null
            val legacyFile = File(File(context.filesDir, LEGACY_OFFLINE_DIR), "$videoId.audio")
            return if (legacyFile.exists() && legacyFile.length() > 0L) legacyFile else null
        }

        fun findPublicOfflineTrackUri(context: Context, rawVideoId: String): Uri? {
            val videoId = sanitizeVideoId(rawVideoId)
            if (videoId.isEmpty()) return null

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val projection = arrayOf(
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.RELATIVE_PATH
                )
                val selection =
                    "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? AND " +
                        "(${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ? OR ${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ?) AND " +
                        "${MediaStore.Audio.Media.IS_PENDING} = 0 AND ${MediaStore.Audio.Media.SIZE} > 0"
                val args = arrayOf("%Music/Xone%", "%[$videoId]%", "$videoId.%")
                runCatching {
                    context.contentResolver.query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        projection,
                        selection,
                        args,
                        "${MediaStore.Audio.Media.DATE_MODIFIED} DESC"
                    )?.use { cursor ->
                        val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                        val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                        val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                        val relCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
                        while (cursor.moveToNext()) {
                            val id = cursor.getLong(idCol)
                            val name = cursor.getString(nameCol).orEmpty()
                            val size = cursor.getLong(sizeCol)
                            val rel = cursor.getString(relCol).orEmpty()
                            if (
                                rel.contains("Music/Xone", ignoreCase = true) &&
                                (name.contains("[$videoId]") || name.startsWith("$videoId.")) &&
                                size > 0L
                            ) {
                                val contentUri = ContentUris.withAppendedId(
                                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                                    id
                                )
                                val readable = runCatching {
                                    context.contentResolver.openAssetFileDescriptor(contentUri, "r")?.use { afd ->
                                        afd.length != 0L
                                    } ?: false
                                }.getOrDefault(false)
                                if (readable) {
                                    return contentUri
                                }
                            }
                        }
                    }
                }
            }

            val publicDir = getPublicMusicXoneDir()
            if (publicDir.exists() && publicDir.isDirectory) {
                val matched = publicDir.listFiles()?.firstOrNull { file ->
                    file.isFile &&
                        file.length() > 0L &&
                        !file.name.endsWith(".tmp") &&
                        (file.name.contains("[$videoId]") || file.name.startsWith("$videoId."))
                }
                if (matched != null) {
                    return Uri.fromFile(matched)
                }
            }

            return null
        }

        fun findOfflineTrackUri(context: Context, rawVideoId: String): Uri? {
            return findPublicOfflineTrackUri(context, rawVideoId)
                ?: findLegacyOfflineFile(context, rawVideoId)?.let { Uri.fromFile(it) }
        }

        fun getOfflineUriSize(context: Context, uri: Uri): Long {
            if (uri.scheme == "file") {
                val path = uri.path ?: return 0L
                val file = File(path)
                return if (file.exists()) file.length() else 0L
            }
            return runCatching {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                    afd.length.coerceAtLeast(0L)
                } ?: 0L
            }.getOrDefault(0L)
        }
    }
}
