package com.xone.music

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import java.io.IOException

@OptIn(UnstableApi::class)
class XonePlaybackService : MediaSessionService() {

    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var lastRetriedVideoId: String? = null

    override fun onCreate() {
        super.onCreate()
        OkHttpDownloader.ensureInitialized()

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(OkHttpDownloader.USER_AGENT)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val resolvingDataSourceFactory = ResolvingDataSource.Factory(httpDataSourceFactory) { dataSpec ->
            val uri = dataSpec.uri
            if (uri.scheme == XONE_SCHEME) {
                val videoId = uri.lastPathSegment
                    ?: throw IOException("Missing track videoId in URI: $uri")
                val resolved = XoneExtractor.resolveAudioStream(videoId)
                dataSpec.buildUpon().setUri(Uri.parse(resolved.streamUrl)).build()
            } else {
                dataSpec
            }
        }

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val exoPlayer = ExoPlayer.Builder(this)
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
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        player = null
        super.onDestroy()
    }

    companion object {
        const val XONE_SCHEME = "xone"
    }
}
