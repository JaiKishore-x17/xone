package com.xone.music

import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.IOException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

object XoneExtractor {

    private const val CACHE_TTL_MS = 4L * 60L * 60L * 1000L
    private const val YTM_ORIGIN = "https://music.youtube.com"
    private const val YTM_API_BASE = "$YTM_ORIGIN/youtubei/v1"
    private const val WEB_REMIX_CLIENT_NAME = "WEB_REMIX"
    private const val WEB_REMIX_CLIENT_VERSION = "1.20241106.01.00"
    private const val SONGS_FILTER_PARAMS = "EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D"

    private const val MIN_STUDIO_DURATION_SEC = 60
    private const val MAX_STUDIO_DURATION_SEC = 600

    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    private val NOISE_KEYWORDS = listOf(
        "remix",
        "live",
        "sped up",
        "slowed",
        "reverb",
        "cover",
        "karaoke",
        "instrumental",
        "8d audio",
        "ringtone",
        "status",
        "reaction",
        "lyrics",
        "lyric video",
        "official video",
        "music video",
        "full album"
    )

    private val SHORT_ALLOW_KEYWORDS = listOf("short", "intro", "interlude", "skit")
    private val LONG_ALLOW_KEYWORDS = listOf("full album", "extended", "1 hour", "mix")

    private val ALLOWED_MUSIC_VIDEO_TYPES = setOf(
        "MUSIC_VIDEO_TYPE_ATV",
        "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK"
    )

    private val DURATION_REGEX = Regex("^\\d{1,2}:\\d{2}(:\\d{2})?$")
    private val YEAR_REGEX = Regex("^\\d{4}$")
    private val BRACKET_REGEX = Regex("\\s*[\\(\\[][^\\)\\]]*[\\)\\]]")
    private val TRAILING_SUFFIX_REGEX = Regex(
        "\\s*-\\s*(remaster(?:ed)?(?:\\s*\\d{4})?|radio edit|album version|single version|explicit|clean|bonus track).*$",
        RegexOption.IGNORE_CASE
    )
    private val NON_ALNUM_REGEX = Regex("[^a-z0-9\\s]")
    private val WHITESPACE_REGEX = Regex("\\s+")
    private val GOOGLE_THUMB_SIZE_REGEX = Regex("=w\\d+-h\\d+[^&\\s]*")

    private val innertubeClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    data class CachedStream(
        val videoId: String,
        val streamUrl: String,
        val mimeType: String,
        val acodec: String,
        val expiresAtMs: Long,
        val cached: Boolean = false,
        val resolutionMs: Long = 0L
    )

    data class ExtractedTrack(
        val videoId: String,
        val title: String,
        val artist: String,
        val artists: List<String>,
        val album: String,
        val albumId: String?,
        val thumbnail: String,
        val duration: String,
        val durationSeconds: Int,
        val videoType: String = "MUSIC_VIDEO_TYPE_ATV"
    ) {
        fun toJSObject(): JSObject {
            val obj = JSObject()
            obj.put("id", videoId)
            obj.put("video_id", videoId)
            obj.put("title", title)
            obj.put("artist", artist)
            val artistsArr = JSArray()
            for (a in artists) {
                artistsArr.put(a)
            }
            obj.put("artists", artistsArr)
            obj.put("album", album)
            if (albumId != null) {
                obj.put("album_id", albumId)
            } else {
                obj.put("album_id", JSObject.NULL)
            }
            obj.put("thumbnail", thumbnail)
            obj.put("duration", duration)
            obj.put("duration_seconds", durationSeconds)
            obj.put("video_type", videoType)
            return obj
        }
    }

    private data class CandidateTrack(
        val track: ExtractedTrack,
        val musicVideoType: String,
        val hasGoogleArt: Boolean
    ) {
        val priorityScore: Int
            get() = (if (track.album.isNotBlank()) 2 else 0) + (if (hasGoogleArt) 1 else 0)
    }

    data class SearchPayload(
        val topResult: ExtractedTrack?,
        val songs: List<ExtractedTrack>
    ) {
        fun toJSObject(): JSObject {
            val songsArr = JSArray()
            for (song in songs) {
                songsArr.put(song.toJSObject())
            }
            val result = JSObject()
            if (topResult != null) {
                result.put("topResult", topResult.toJSObject())
            } else {
                result.put("topResult", JSObject.NULL)
            }
            result.put("songs", songsArr)
            return result
        }
    }

    private val streamCache = ConcurrentHashMap<String, CachedStream>()

    fun invalidateStream(videoId: String) {
        if (videoId.isNotBlank()) {
            streamCache.remove(videoId.trim())
        }
    }

    fun resolveAudioStream(videoId: String, forceRefresh: Boolean = false): CachedStream {
        val cleanId = videoId.trim()
        if (cleanId.isEmpty()) {
            throw IOException("Invalid empty videoId")
        }

        val startNs = System.nanoTime()
        if (!forceRefresh) {
            val existing = streamCache[cleanId]
            if (existing != null && existing.expiresAtMs > System.currentTimeMillis()) {
                val elapsedMs = (System.nanoTime() - startNs) / 1_000_000L
                return existing.copy(cached = true, resolutionMs = elapsedMs)
            }
        }

        OkHttpDownloader.ensureInitialized()

        val watchUrl = "https://www.youtube.com/watch?v=$cleanId"
        val streamInfo = StreamInfo.getInfo(ServiceList.YouTube, watchUrl)
        val selected = selectBestAudioStream(streamInfo.audioStreams)
            ?: throw IOException("No direct audio-only stream available for $cleanId")

        val fmt = selected.format
        val mimeType = fmt?.mimeType ?: "audio/webm"
        val acodec = when (fmt) {
            MediaFormat.WEBMA_OPUS, MediaFormat.OPUS -> "opus"
            MediaFormat.M4A -> "aac"
            else -> fmt?.name?.lowercase(Locale.ROOT) ?: "audio"
        }

        val elapsedMs = (System.nanoTime() - startNs) / 1_000_000L
        val entry = CachedStream(
            videoId = cleanId,
            streamUrl = selected.content,
            mimeType = mimeType,
            acodec = acodec,
            expiresAtMs = System.currentTimeMillis() + CACHE_TTL_MS,
            cached = false,
            resolutionMs = elapsedMs
        )
        streamCache[cleanId] = entry
        return entry
    }

    fun searchSongs(query: String): SearchPayload {
        val cleanQuery = query.trim()
        if (cleanQuery.isEmpty()) {
            return SearchPayload(topResult = null, songs = emptyList())
        }

        val payload = JSONObject().apply {
            put("query", cleanQuery)
            put("params", SONGS_FILTER_PARAMS)
        }
        val root = postInnertube("search", payload)

        val renderers = ArrayList<JSONObject>()
        val tabs = root.optJSONObject("contents")
            ?.optJSONObject("tabbedSearchResultsRenderer")
            ?.optJSONArray("tabs")

        if (tabs != null && tabs.length() > 0) {
            val sectionContents = tabs.optJSONObject(0)
                ?.optJSONObject("tabRenderer")
                ?.optJSONObject("content")
                ?.optJSONObject("sectionListRenderer")
                ?.optJSONArray("contents")
            collectMusicResponsiveRenderers(sectionContents, renderers)
        } else {
            collectMusicResponsiveRenderers(root, renderers)
        }

        val candidates = renderers.mapNotNull { parseSearchItemRenderer(it) }
        val cleanTracks = filterRankAndDeduplicate(candidates, cleanQuery, limit = 25)

        return SearchPayload(
            topResult = cleanTracks.firstOrNull(),
            songs = cleanTracks
        )
    }

    fun getRadioQueue(videoId: String, limit: Int = 20): List<ExtractedTrack> {
        val cleanId = videoId.trim()
        if (cleanId.isEmpty()) return emptyList()

        val payload = JSONObject().apply {
            put("videoId", cleanId)
            put("playlistId", "RDAMVM$cleanId")
            put("isAudioOnly", true)
            put("enablePersistentPlaylistPanel", true)
        }
        val root = postInnertube("next", payload)

        val tabs = root.optJSONObject("contents")
            ?.optJSONObject("singleColumnMusicWatchNextResultsRenderer")
            ?.optJSONObject("tabbedRenderer")
            ?.optJSONObject("watchNextTabbedResultsRenderer")
            ?.optJSONArray("tabs")
            ?: return emptyList()

        val panelContents = if (tabs.length() > 0) {
            tabs.optJSONObject(0)
                ?.optJSONObject("tabRenderer")
                ?.optJSONObject("content")
                ?.optJSONObject("musicQueueRenderer")
                ?.optJSONObject("content")
                ?.optJSONObject("playlistPanelRenderer")
                ?.optJSONArray("contents")
        } else {
            null
        } ?: return emptyList()

        val candidates = ArrayList<CandidateTrack>()
        for (i in 0 until panelContents.length()) {
            val entry = panelContents.optJSONObject(i) ?: continue
            val renderer = entry.optJSONObject("playlistPanelVideoRenderer")
                ?: entry.optJSONObject("playlistPanelVideoWrapperRenderer")
                    ?.optJSONObject("primaryRenderer")
                    ?.optJSONObject("playlistPanelVideoRenderer")
                ?: continue

            val candidate = parsePanelVideoRenderer(renderer) ?: continue
            if (candidate.track.videoId == cleanId) continue
            candidates.add(candidate)
        }

        return filterRankAndDeduplicate(candidates, query = "", limit = limit)
    }

    private fun postInnertube(endpoint: String, extraPayload: JSONObject): JSONObject {
        val body = JSONObject().apply {
            put(
                "context",
                JSONObject().put(
                    "client",
                    JSONObject()
                        .put("clientName", WEB_REMIX_CLIENT_NAME)
                        .put("clientVersion", WEB_REMIX_CLIENT_VERSION)
                        .put("hl", "en")
                        .put("gl", "US")
                )
            )
            val keys = extraPayload.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                put(key, extraPayload.get(key))
            }
        }

        val request = Request.Builder()
            .url("$YTM_API_BASE/$endpoint?prettyPrint=false")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .header("Content-Type", "application/json")
            .header("User-Agent", OkHttpDownloader.USER_AGENT)
            .header("Origin", YTM_ORIGIN)
            .header("Referer", "$YTM_ORIGIN/")
            .build()

        innertubeClient.newCall(request).execute().use { res ->
            val responseText = res.body?.string() ?: ""
            if (!res.isSuccessful) {
                throw IOException("YouTube Music API returned HTTP ${res.code}")
            }
            if (responseText.isEmpty()) {
                throw IOException("Empty response from YouTube Music API")
            }
            return JSONObject(responseText)
        }
    }

    private fun collectMusicResponsiveRenderers(node: Any?, out: MutableList<JSONObject>) {
        when (node) {
            is JSONObject -> {
                val item = node.optJSONObject("musicResponsiveListItemRenderer")
                if (item != null) {
                    out.add(item)
                    return
                }
                val keys = node.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    collectMusicResponsiveRenderers(node.opt(key), out)
                }
            }
            is JSONArray -> {
                for (i in 0 until node.length()) {
                    collectMusicResponsiveRenderers(node.opt(i), out)
                }
            }
        }
    }

    private fun parseSearchItemRenderer(renderer: JSONObject): CandidateTrack? {
        val overlayWatch = renderer.optJSONObject("overlay")
            ?.optJSONObject("musicItemThumbnailOverlayRenderer")
            ?.optJSONObject("content")
            ?.optJSONObject("musicPlayButtonRenderer")
            ?.optJSONObject("playNavigationEndpoint")
            ?.optJSONObject("watchEndpoint")

        val flexColumns = renderer.optJSONArray("flexColumns") ?: return null
        val fixedColumns = renderer.optJSONArray("fixedColumns")

        val titleColRuns = flexColumns.optJSONObject(0)
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")
            ?.optJSONArray("runs")
        val firstTitleRun = titleColRuns?.optJSONObject(0)
        val titleWatch = firstTitleRun
            ?.optJSONObject("navigationEndpoint")
            ?.optJSONObject("watchEndpoint")

        val videoId = renderer.optJSONObject("playlistItemData")?.optString("videoId").orEmpty()
            .ifBlank { titleWatch?.optString("videoId").orEmpty() }
            .ifBlank { overlayWatch?.optString("videoId").orEmpty() }
            .trim()
        if (videoId.isEmpty()) return null

        val musicVideoType = extractMusicVideoType(overlayWatch)
            .ifEmpty { extractMusicVideoType(titleWatch) }

        val title = firstTitleRun?.optString("text").orEmpty().trim()
        if (title.isEmpty()) return null

        val artists = ArrayList<String>()
        var fallbackArtist = ""
        var album = ""
        var albumId: String? = null
        var durationStr = "0:00"
        var durationSeconds = 0

        val parseColumnArray = { colArray: JSONArray?, startIndex: Int ->
            if (colArray != null) {
                for (c in startIndex until colArray.length()) {
                    val colObj = colArray.optJSONObject(c) ?: continue
                    val colRenderer = colObj.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
                        ?: colObj.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
                        ?: continue
                    val runs = colRenderer.optJSONObject("text")?.optJSONArray("runs") ?: continue

                    for (r in 0 until runs.length()) {
                        val run = runs.optJSONObject(r) ?: continue
                        val text = run.optString("text").trim()
                        if (text.isEmpty() || text == "•" || text == "," || text == "&") continue

                        val browse = run.optJSONObject("navigationEndpoint")
                            ?.optJSONObject("browseEndpoint")
                        val pageType = browse
                            ?.optJSONObject("browseEndpointContextSupportedConfigs")
                            ?.optJSONObject("browseEndpointContextMusicConfig")
                            ?.optString("pageType")
                            .orEmpty()

                        when (pageType) {
                            "MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL" -> {
                                if (!artists.contains(text)) artists.add(text)
                            }
                            "MUSIC_PAGE_TYPE_ALBUM" -> {
                                if (album.isEmpty()) {
                                    album = text
                                    albumId = browse?.optString("browseId")?.ifBlank { null }
                                }
                            }
                            else -> {
                                if (DURATION_REGEX.matches(text)) {
                                    durationStr = text
                                    durationSeconds = parseDurationSeconds(text)
                                } else if (
                                    fallbackArtist.isEmpty() &&
                                    c == 1 &&
                                    !isMetadataLabel(text)
                                ) {
                                    fallbackArtist = text
                                }
                            }
                        }
                    }
                }
            }
        }

        parseColumnArray(flexColumns, 1)
        parseColumnArray(fixedColumns, 0)

        if (artists.isEmpty() && fallbackArtist.isNotEmpty()) {
            artists.add(fallbackArtist)
        }
        if (artists.isEmpty()) {
            artists.add("Unknown Artist")
        }

        val thumbsArr = renderer.optJSONObject("thumbnail")
            ?.optJSONObject("musicThumbnailRenderer")
            ?.optJSONObject("thumbnail")
            ?.optJSONArray("thumbnails")
        val (thumbUrl, hasGoogleArt) = selectAndUpgradeThumbnail(thumbsArr, videoId)

        return CandidateTrack(
            track = ExtractedTrack(
                videoId = videoId,
                title = title,
                artist = artists.joinToString(", "),
                artists = artists,
                album = album,
                albumId = albumId,
                thumbnail = thumbUrl,
                duration = durationStr,
                durationSeconds = durationSeconds,
                videoType = musicVideoType.ifEmpty { "MUSIC_VIDEO_TYPE_ATV" }
            ),
            musicVideoType = musicVideoType,
            hasGoogleArt = hasGoogleArt
        )
    }

    private fun parsePanelVideoRenderer(renderer: JSONObject): CandidateTrack? {
        val watchEndpoint = renderer.optJSONObject("navigationEndpoint")
            ?.optJSONObject("watchEndpoint")

        val videoId = renderer.optString("videoId").trim()
            .ifBlank { watchEndpoint?.optString("videoId").orEmpty().trim() }
        if (videoId.isEmpty()) return null

        val musicVideoType = extractMusicVideoType(watchEndpoint)

        val title = renderer.optJSONObject("title")
            ?.optJSONArray("runs")
            ?.optJSONObject(0)
            ?.optString("text")
            .orEmpty()
            .trim()
        if (title.isEmpty()) return null

        val artists = ArrayList<String>()
        var fallbackArtist = ""
        var album = ""
        var albumId: String? = null

        val longRuns = renderer.optJSONObject("longBylineText")?.optJSONArray("runs")
        val shortRuns = renderer.optJSONObject("shortBylineText")?.optJSONArray("runs")
        val bylineRuns = longRuns ?: shortRuns

        if (bylineRuns != null) {
            for (r in 0 until bylineRuns.length()) {
                val run = bylineRuns.optJSONObject(r) ?: continue
                val text = run.optString("text").trim()
                if (text.isEmpty() || text == "•" || text == "," || text == "&") continue

                val browse = run.optJSONObject("navigationEndpoint")
                    ?.optJSONObject("browseEndpoint")
                val pageType = browse
                    ?.optJSONObject("browseEndpointContextSupportedConfigs")
                    ?.optJSONObject("browseEndpointContextMusicConfig")
                    ?.optString("pageType")
                    .orEmpty()

                when (pageType) {
                    "MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL" -> {
                        if (!artists.contains(text)) artists.add(text)
                    }
                    "MUSIC_PAGE_TYPE_ALBUM" -> {
                        if (album.isEmpty()) {
                            album = text
                            albumId = browse?.optString("browseId")?.ifBlank { null }
                        }
                    }
                    else -> {
                        if (
                            fallbackArtist.isEmpty() &&
                            !YEAR_REGEX.matches(text) &&
                            !DURATION_REGEX.matches(text) &&
                            !isMetadataLabel(text)
                        ) {
                            fallbackArtist = text
                        }
                    }
                }
            }
        }

        if (artists.isEmpty() && shortRuns != null && shortRuns !== longRuns) {
            for (r in 0 until shortRuns.length()) {
                val text = shortRuns.optJSONObject(r)?.optString("text").orEmpty().trim()
                if (text.isNotEmpty() && text != "•" && text != "," && !isMetadataLabel(text)) {
                    artists.add(text)
                    break
                }
            }
        }
        if (artists.isEmpty() && fallbackArtist.isNotEmpty()) {
            artists.add(fallbackArtist)
        }
        if (artists.isEmpty()) {
            artists.add("Unknown Artist")
        }

        val durationStr = renderer.optJSONObject("lengthText")
            ?.optJSONArray("runs")
            ?.optJSONObject(0)
            ?.optString("text")
            .orEmpty()
            .trim()
            .ifEmpty { "0:00" }
        val durationSeconds = parseDurationSeconds(durationStr)

        val thumbsArr = renderer.optJSONObject("thumbnail")?.optJSONArray("thumbnails")
        val (thumbUrl, hasGoogleArt) = selectAndUpgradeThumbnail(thumbsArr, videoId)

        return CandidateTrack(
            track = ExtractedTrack(
                videoId = videoId,
                title = title,
                artist = artists.joinToString(", "),
                artists = artists,
                album = album,
                albumId = albumId,
                thumbnail = thumbUrl,
                duration = durationStr,
                durationSeconds = durationSeconds,
                videoType = musicVideoType.ifEmpty { "MUSIC_VIDEO_TYPE_ATV" }
            ),
            musicVideoType = musicVideoType,
            hasGoogleArt = hasGoogleArt
        )
    }

    private fun extractMusicVideoType(watchEndpoint: JSONObject?): String {
        return watchEndpoint
            ?.optJSONObject("watchEndpointMusicSupportedConfigs")
            ?.optJSONObject("watchEndpointMusicConfig")
            ?.optString("musicVideoType")
            .orEmpty()
            .trim()
    }

    private fun isMetadataLabel(text: String): Boolean {
        val lower = text.lowercase(Locale.ROOT)
        return lower == "song" ||
            lower == "video" ||
            lower == "ep" ||
            lower == "single" ||
            lower == "album" ||
            lower.endsWith(" plays")
    }

    private fun filterRankAndDeduplicate(
        candidates: List<CandidateTrack>,
        query: String,
        limit: Int
    ): List<ExtractedTrack> {
        val allowShort = containsAnyKeyword(query, SHORT_ALLOW_KEYWORDS)
        val allowLong = containsAnyKeyword(query, LONG_ALLOW_KEYWORDS)

        val filtered = ArrayList<CandidateTrack>()
        for (candidate in candidates) {
            val t = candidate.track
            if (t.videoId.isBlank()) continue

            if (candidate.musicVideoType.isNotEmpty() && candidate.musicVideoType !in ALLOWED_MUSIC_VIDEO_TYPES) {
                continue
            }

            if (t.durationSeconds < MIN_STUDIO_DURATION_SEC && !allowShort) {
                continue
            }
            if (t.durationSeconds > MAX_STUDIO_DURATION_SEC && !allowLong) {
                continue
            }

            if (hasUnrequestedNoise(t.title, query)) continue
            if (hasUnrequestedNoise(t.album, query)) continue

            filtered.add(candidate)
        }

        // Prioritize studio masters (album metadata and square googleusercontent art) preserving relevance order
        val ranked = filtered.sortedByDescending { it.priorityScore }

        val deduped = ArrayList<ExtractedTrack>()
        val seenVideoIds = HashSet<String>()
        val seenKeys = HashSet<Pair<String, String>>()

        for (candidate in ranked) {
            val track = candidate.track
            val primaryArtist = track.artists.firstOrNull()?.lowercase(Locale.ROOT)?.trim()
                ?: track.artist.lowercase(Locale.ROOT).trim()
            val dedupeKey = normalizeBaseTitle(track.title) to primaryArtist

            if (track.videoId in seenVideoIds || dedupeKey in seenKeys) {
                continue
            }
            seenVideoIds.add(track.videoId)
            seenKeys.add(dedupeKey)
            deduped.add(track)

            if (deduped.size >= limit) break
        }

        return deduped
    }

    private fun containsAnyKeyword(query: String, keywords: List<String>): Boolean {
        if (query.isBlank()) return false
        val lowered = query.lowercase(Locale.ROOT)
        return keywords.any { kw ->
            Regex("\\b${Pattern.quote(kw)}\\b").containsMatchIn(lowered)
        }
    }

    private fun hasUnrequestedNoise(text: String, query: String): Boolean {
        if (text.isEmpty()) return false
        val loweredText = text.lowercase(Locale.ROOT)
        val loweredQuery = query.lowercase(Locale.ROOT)

        for (kw in NOISE_KEYWORDS) {
            val boundaryRegex = Regex("\\b${Pattern.quote(kw)}\\b")
            if (boundaryRegex.containsMatchIn(loweredQuery)) {
                continue
            }
            if (boundaryRegex.containsMatchIn(loweredText)) {
                return true
            }
        }
        return false
    }

    private fun normalizeBaseTitle(title: String): String {
        val noBrackets = BRACKET_REGEX.replace(title, "")
        val noSuffix = TRAILING_SUFFIX_REGEX.replace(noBrackets, "")
        val lower = noSuffix.lowercase(Locale.ROOT)
        val alnum = NON_ALNUM_REGEX.replace(lower, " ")
        return WHITESPACE_REGEX.replace(alnum, " ").trim()
    }

    private fun parseDurationSeconds(duration: String): Int {
        val parts = duration.trim().split(":").mapNotNull { it.toIntOrNull() }
        return when (parts.size) {
            2 -> parts[0] * 60 + parts[1]
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            else -> 0
        }
    }

    private fun selectAndUpgradeThumbnail(
        thumbnails: JSONArray?,
        videoId: String
    ): Pair<String, Boolean> {
        var bestUrl = ""
        var bestPixels = -1

        if (thumbnails != null) {
            for (i in 0 until thumbnails.length()) {
                val obj = thumbnails.optJSONObject(i) ?: continue
                val url = obj.optString("url").trim()
                if (url.isEmpty()) continue
                val pixels = obj.optInt("width", 0) * obj.optInt("height", 0)
                if (pixels >= bestPixels) {
                    bestPixels = pixels
                    bestUrl = url
                }
            }
        }

        if (bestUrl.isNotEmpty()) {
            val isGoogleArt = bestUrl.contains("googleusercontent.com") || bestUrl.contains("ggpht.com")
            if (isGoogleArt) {
                val upgraded = if (GOOGLE_THUMB_SIZE_REGEX.containsMatchIn(bestUrl)) {
                    GOOGLE_THUMB_SIZE_REGEX.replace(bestUrl, "=w544-h544-l90-rj")
                } else {
                    "$bestUrl=w544-h544-l90-rj"
                }
                return upgraded to true
            }
            return bestUrl to false
        }

        return "https://i.ytimg.com/vi/$videoId/hqdefault.jpg" to false
    }

    private fun selectBestAudioStream(streams: List<AudioStream>): AudioStream? {
        val httpStreams = streams.filter { stream ->
            stream.isUrl && stream.content.startsWith("http")
        }
        if (httpStreams.isEmpty()) return null

        return httpStreams.maxWithOrNull(
            compareBy<AudioStream>(
                { if (it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP) 1 else 0 },
                {
                    when (it.format) {
                        MediaFormat.WEBMA_OPUS, MediaFormat.OPUS -> 3
                        MediaFormat.M4A -> 2
                        MediaFormat.WEBMA -> 1
                        else -> 0
                    }
                },
                { maxOf(it.averageBitrate, it.bitrate) }
            )
        )
    }
}
