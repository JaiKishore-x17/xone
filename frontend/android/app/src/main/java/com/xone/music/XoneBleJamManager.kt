package com.xone.music

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.random.Random

@SuppressLint("MissingPermission")
class XoneBleJamManager private constructor(private val appContext: Context) {

    interface Listener {
        fun onJamStateUpdated(state: JSObject)
        fun onJamEnded(reason: String)
    }

    data class JamParticipant(
        val deviceAddress: String,
        val deviceName: String,
        val isHost: Boolean,
        val isSpeakerEnabled: Boolean
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("deviceAddress", deviceAddress)
            put("deviceName", deviceName)
            put("isHost", isHost)
            put("isSpeakerEnabled", isSpeakerEnabled)
        }

        fun toJSObject(): JSObject = JSObject().apply {
            put("deviceAddress", deviceAddress)
            put("deviceName", deviceName)
            put("isHost", isHost)
            put("isSpeakerEnabled", isSpeakerEnabled)
        }
    }

    data class JamTrack(
        val videoId: String,
        val title: String,
        val artist: String,
        val album: String,
        val thumbnail: String,
        val duration: String,
        val durationSeconds: Int,
        val addedBy: String
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("videoId", videoId)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("thumbnail", thumbnail)
            put("duration", duration)
            put("durationSeconds", durationSeconds)
            put("addedBy", addedBy)
        }

        fun toJSObject(): JSObject {
            val artistsArr = JSArray()
            for (part in artist.split(",")) {
                val trimmed = part.trim()
                if (trimmed.isNotEmpty()) artistsArr.put(trimmed)
            }
            return JSObject().apply {
                put("id", videoId)
                put("video_id", videoId)
                put("title", title)
                put("artist", artist)
                put("artists", artistsArr)
                put("album", album)
                put("album_id", JSObject.NULL)
                put("thumbnail", thumbnail)
                put("duration", duration)
                put("duration_seconds", durationSeconds)
                put("video_type", "MUSIC_VIDEO_TYPE_ATV")
                put("addedBy", addedBy)
            }
        }

        fun toMediaItem(): MediaItem {
            val extras = Bundle().apply {
                putString("video_id", videoId)
                putString("thumbnail", thumbnail)
                putInt("duration_seconds", durationSeconds)
            }
            val meta = MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .setAlbumTitle(album.ifEmpty { "Xone" })
                .setExtras(extras)
                .apply {
                    if (thumbnail.isNotEmpty()) {
                        setArtworkUri(Uri.parse(thumbnail))
                    }
                }
                .build()

            return MediaItem.Builder()
                .setMediaId(videoId)
                .setUri(Uri.parse("${XonePlaybackService.XONE_SCHEME}://track/$videoId"))
                .setMediaMetadata(meta)
                .build()
        }

        companion object {
            fun fromJson(obj: JSONObject): JamTrack? {
                val vid = obj.optCleanString("videoId").ifBlank { obj.optCleanString("video_id") }
                if (vid.isEmpty()) return null
                return JamTrack(
                    videoId = vid,
                    title = obj.optCleanString("title", "Untitled Track"),
                    artist = obj.optCleanString("artist", "Unknown Artist"),
                    album = obj.optCleanString("album", ""),
                    thumbnail = obj.optCleanString("thumbnail", ""),
                    duration = obj.optCleanString("duration", "0:00"),
                    durationSeconds = obj.optInt("durationSeconds", obj.optInt("duration_seconds", 0)),
                    addedBy = obj.optCleanString("addedBy", "Guest")
                )
            }

            fun fromJSObject(obj: JSObject, fallbackAddedBy: String): JamTrack? {
                val vid = obj.getString("videoId")?.trim().orEmpty()
                    .ifEmpty { obj.getString("video_id")?.trim().orEmpty() }
                if (vid.isEmpty()) return null
                return JamTrack(
                    videoId = vid,
                    title = obj.getString("title")?.trim().orEmpty().ifEmpty { "Untitled Track" },
                    artist = obj.getString("artist")?.trim().orEmpty().ifEmpty { "Unknown Artist" },
                    album = obj.getString("album")?.trim().orEmpty(),
                    thumbnail = obj.getString("thumbnail")?.trim().orEmpty(),
                    duration = obj.getString("duration")?.trim().orEmpty().ifEmpty { "0:00" },
                    durationSeconds = (obj.opt("durationSeconds") as? Number)?.toInt()
                        ?: (obj.opt("duration_seconds") as? Number)?.toInt()
                        ?: 0,
                    addedBy = obj.getString("addedBy")?.trim().orEmpty().ifEmpty { fallbackAddedBy }
                )
            }

            fun fromMediaItem(item: MediaItem, addedBy: String): JamTrack? {
                val extras = item.mediaMetadata.extras
                val vid = extras?.getString("video_id")?.ifBlank { null } ?: item.mediaId
                if (vid.isBlank()) return null
                val durSec = extras?.getInt("duration_seconds", 0) ?: 0
                val mins = durSec / 60
                val secs = durSec % 60
                val durStr = if (durSec > 0) String.format("%d:%02d", mins, secs) else "0:00"
                return JamTrack(
                    videoId = vid,
                    title = item.mediaMetadata.title?.toString()?.ifBlank { null } ?: "Untitled Track",
                    artist = item.mediaMetadata.artist?.toString()?.ifBlank { null } ?: "Unknown Artist",
                    album = item.mediaMetadata.albumTitle?.toString().orEmpty(),
                    thumbnail = extras?.getString("thumbnail")
                        ?: item.mediaMetadata.artworkUri?.toString().orEmpty(),
                    duration = durStr,
                    durationSeconds = durSec,
                    addedBy = addedBy
                )
            }
        }
    }

    private data class IncomingAssembly(
        val totalChunks: Int,
        val chunks: Array<ByteArray?> = arrayOfNulls(totalChunks)
    ) {
        fun addChunk(index: Int, data: ByteArray): ByteArray? {
            if (index !in 0 until totalChunks) return null
            chunks[index] = data
            var totalLen = 0
            for (part in chunks) {
                if (part == null) return null
                totalLen += part.size
            }
            val merged = ByteArray(totalLen)
            var offset = 0
            for (part in chunks) {
                val bytes = part!!
                System.arraycopy(bytes, 0, merged, offset, bytes.size)
                offset += bytes.size
            }
            return merged
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stateLock = Any()
    private val txLock = Any()

    @Volatile
    private var listener: Listener? = null

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var mediaController: MediaController? = null

    // Shared Session State
    @Volatile
    private var isActive = false

    @Volatile
    private var role = ROLE_NONE

    @Volatile
    private var jamCode = ""

    @Volatile
    private var localDeviceName = Build.MODEL ?: "Xone Phone"

    @Volatile
    private var localDeviceId = HOST_DEVICE_ID

    @Volatile
    private var clockOffsetMs = 0L

    @Volatile
    private var currentTrack: JamTrack? = null

    @Volatile
    private var jamIsPlaying = false

    @Volatile
    private var jamPositionMs = 0L

    private val participants = LinkedHashMap<String, JamParticipant>()
    private val jamQueue = ArrayList<JamTrack>()

    // Host BLE state
    private var bluetoothManager: BluetoothManager? = null
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var stateTxCharacteristic: BluetoothGattCharacteristic? = null
    private val connectedGuests = ConcurrentHashMap<String, BluetoothDevice>()
    private val subscribedGuests = ConcurrentHashMap.newKeySet<String>()
    private val deviceMtus = ConcurrentHashMap<String, Int>()
    private val hostNotifyQueues = HashMap<String, ArrayDeque<ByteArray>>()
    private val hostNotifyInFlight = HashSet<String>()

    // Guest BLE state
    private var bleScanner: BluetoothLeScanner? = null
    private var activeScanCallback: ScanCallback? = null
    private var scanTimeoutRunnable: Runnable? = null
    private var joinTimeoutRunnable: Runnable? = null
    private var guestGatt: BluetoothGatt? = null
    private var guestRxCharacteristic: BluetoothGattCharacteristic? = null
    private var guestTxCharacteristic: BluetoothGattCharacteristic? = null
    private var guestMtu = DEFAULT_BLE_MTU
    private var guestServicesDiscovered = false
    private val guestWriteQueue = ArrayDeque<() -> Boolean>()
    private var guestWriteInFlight = false
    private var outgoingMsgSeq = 0

    // Chunk reassembly keyed by "$peer:$msgId"
    private val reassemblyMap = ConcurrentHashMap<String, IncomingAssembly>()

    // Clock sync & playback scheduling
    private val pendingClockSamples = ArrayList<Pair<Long, Long>>() // (rtt, offset)
    private var clockSyncRunnable: Runnable? = null
    private var hostStageRunnable: Runnable? = null
    private var guestSyncPlayRunnable: Runnable? = null
    private var guestNudgeResetRunnable: Runnable? = null
    private var guestReadyListener: Player.Listener? = null
    private val guestDriftRunnables = ArrayList<Runnable>()
    private var hostPeriodicBeaconRunnable: Runnable? = null
    private var syncGeneration = 0L

    // Host Two-Phase Prepare -> Ready -> Go Barrier
    private var barrierGen = 0L
    private var barrierVideoId = ""
    private var barrierPositionMs = 0L
    private val expectedReadyGuests = HashSet<String>()
    private val readyGuests = HashSet<String>()
    private var hostReady = false
    private var barrierDispatched = true
    private var barrierTimeoutRunnable: Runnable? = null

    @Volatile
    private var suppressHostPlayerEventsUntilMs = 0L

    // Pending async callbacks for Capacitor
    private var pendingCreateCallback: ((Result<JSObject>) -> Unit)? = null
    private var pendingJoinCallback: ((Result<JSObject>) -> Unit)? = null

    private val hostPlayerListener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (!isActive || role != ROLE_HOST) return
            if (SystemClock.elapsedRealtime() < suppressHostPlayerEventsUntilMs) return
            val item = mediaItem ?: return
            val parsed = JamTrack.fromMediaItem(item, localDeviceName) ?: return

            synchronized(stateLock) {
                val existing = jamQueue.firstOrNull { it.videoId == parsed.videoId }
                val chosen = existing ?: parsed.also {
                    jamQueue.add(it)
                    if (jamQueue.size > MAX_QUEUE_TRACKS) jamQueue.removeAt(0)
                }
                currentTrack = chosen
                jamPositionMs = 0L
                jamIsPlaying = mediaController?.playWhenReady ?: true
            }

            broadcastStateSyncToAll()
            coordinateHostSyncPlay(fromTrackTransition = true)
            emitStateToUi()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (!isActive || role != ROLE_HOST) return

            if (playbackState == Player.STATE_READY && !barrierDispatched && barrierVideoId.isNotEmpty() && !hostReady) {
                val loadedId = mediaController?.currentMediaItem?.mediaId
                if (loadedId == barrierVideoId) {
                    hostReady = true
                    checkAndDispatchGoPlay(barrierGen)
                }
            }

            if (playbackState != Player.STATE_ENDED) return
            val ctrl = mediaController ?: return
            val firstTrack = synchronized(stateLock) { jamQueue.firstOrNull() } ?: return

            synchronized(stateLock) {
                currentTrack = firstTrack
                jamPositionMs = 0L
                jamIsPlaying = true
            }

            broadcastStateSyncToAll()
            coordinateHostSyncPlay(fromTrackTransition = true, forcePlaying = true)
            emitStateToUi()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!isActive || role != ROLE_HOST) return
            if (SystemClock.elapsedRealtime() < suppressHostPlayerEventsUntilMs) return
            val ctrl = mediaController ?: return
            val curItem = ctrl.currentMediaItem ?: return
            synchronized(stateLock) {
                if (currentTrack == null) {
                    currentTrack = JamTrack.fromMediaItem(curItem, localDeviceName)
                }
                jamIsPlaying = playWhenReady
                jamPositionMs = ctrl.currentPosition.coerceAtLeast(0L)
            }
            coordinateHostSyncPlay(fromTrackTransition = false)
            emitStateToUi()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            if (!isActive || role != ROLE_HOST) return
            if (SystemClock.elapsedRealtime() < suppressHostPlayerEventsUntilMs) return
            if (reason == Player.DISCONTINUITY_REASON_SEEK) {
                synchronized(stateLock) {
                    jamPositionMs = newPosition.positionMs.coerceAtLeast(0L)
                }
                coordinateHostSyncPlay(fromTrackTransition = false)
                emitStateToUi()
            }
        }
    }

    fun setListener(l: Listener?) {
        listener = l
    }

    private fun ensureController(onReady: (MediaController) -> Unit) {
        val current = mediaController
        if (current != null && current.isConnected) {
            onReady(current)
            return
        }

        val future = controllerFuture ?: run {
            val token = SessionToken(
                appContext,
                ComponentName(appContext, XonePlaybackService::class.java)
            )
            MediaController.Builder(appContext, token).buildAsync().also {
                controllerFuture = it
            }
        }

        future.addListener({
            try {
                val ctrl = future.get()
                mediaController = ctrl
                onReady(ctrl)
            } catch (_: Exception) {
                controllerFuture = null
            }
        }, ContextCompat.getMainExecutor(appContext))
    }

    private fun getBluetoothAdapterOrThrow(): BluetoothAdapter {
        val mgr = (appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
            ?: throw IllegalStateException("Bluetooth is not supported on this device.")
        bluetoothManager = mgr
        val adapter = mgr.adapter
            ?: throw IllegalStateException("Bluetooth adapter is unavailable.")
        if (!adapter.isEnabled) {
            throw IllegalStateException("Bluetooth is turned off. Please enable Bluetooth and try again.")
        }
        return adapter
    }

    fun createJam(deviceName: String?, callback: (Result<JSObject>) -> Unit) {
        mainHandler.post {
            try {
                val adapter = getBluetoothAdapterOrThrow()
                val bleAdvertiser = adapter.bluetoothLeAdvertiser
                    ?: throw IllegalStateException("BLE advertising is not supported on this device.")

                cleanupInternal(emitEnded = false, reason = "")

                val cleanName = deviceName?.trim().orEmpty().ifEmpty { Build.MODEL ?: "Host Phone" }
                val code = Random.nextInt(100_000, 1_000_000).toString()

                synchronized(stateLock) {
                    role = ROLE_HOST
                    isActive = true
                    jamCode = code
                    localDeviceName = cleanName
                    localDeviceId = HOST_DEVICE_ID
                    clockOffsetMs = 0L
                    participants.clear()
                    participants[HOST_DEVICE_ID] = JamParticipant(
                        deviceAddress = HOST_DEVICE_ID,
                        deviceName = cleanName,
                        isHost = true,
                        isSpeakerEnabled = true
                    )
                    jamQueue.clear()
                    currentTrack = null
                    jamIsPlaying = false
                    jamPositionMs = 0L
                }

                advertiser = bleAdvertiser
                pendingCreateCallback = callback

                startHostGattServer(adapter)
                startHostAdvertising(bleAdvertiser, code)

                ensureController { ctrl ->
                    ctrl.removeListener(hostPlayerListener)
                    ctrl.addListener(hostPlayerListener)
                    ctrl.volume = 1.0f
                    ctrl.repeatMode = Player.REPEAT_MODE_ALL

                    val curItem = ctrl.currentMediaItem
                    if (curItem != null) {
                        val curIdx = ctrl.currentMediaItemIndex
                        if (curIdx >= 0 && curIdx < ctrl.mediaItemCount) {
                            if (ctrl.mediaItemCount > curIdx + 1) {
                                ctrl.removeMediaItems(curIdx + 1, ctrl.mediaItemCount)
                            }
                            if (curIdx > 0) {
                                ctrl.removeMediaItems(0, curIdx)
                            }
                        }
                        val seedTrack = JamTrack.fromMediaItem(curItem, cleanName)
                        if (seedTrack != null) {
                            synchronized(stateLock) {
                                currentTrack = seedTrack
                                jamIsPlaying = ctrl.isPlaying || ctrl.playWhenReady
                                jamPositionMs = ctrl.currentPosition.coerceAtLeast(0L)
                                if (jamQueue.none { it.videoId == seedTrack.videoId }) {
                                    jamQueue.add(seedTrack)
                                }
                            }
                        }
                    } else {
                        ctrl.clearMediaItems()
                    }
                    startHostPeriodicBeacon()
                    emitStateToUi()
                }
            } catch (ex: Exception) {
                cleanupInternal(emitEnded = false, reason = "")
                callback(Result.failure(ex))
            }
        }
    }

    fun joinJam(code: String, deviceName: String?, callback: (Result<JSObject>) -> Unit) {
        mainHandler.post {
            try {
                val cleanCode = code.trim()
                if (!Regex("^\\d{6}$").matches(cleanCode)) {
                    throw IllegalArgumentException("Please enter a valid 6-digit Jam code.")
                }

                val adapter = getBluetoothAdapterOrThrow()
                val scanner = adapter.bluetoothLeScanner
                    ?: throw IllegalStateException("BLE scanning is unavailable on this device.")

                cleanupInternal(emitEnded = false, reason = "")

                val cleanName = deviceName?.trim().orEmpty().ifEmpty { Build.MODEL ?: "Guest Phone" }

                synchronized(stateLock) {
                    role = ROLE_GUEST
                    isActive = false
                    jamCode = cleanCode
                    localDeviceName = cleanName
                    localDeviceId = "GUEST_PENDING"
                    clockOffsetMs = 0L
                    participants.clear()
                    jamQueue.clear()
                    currentTrack = null
                    jamIsPlaying = false
                    jamPositionMs = 0L
                }

                bleScanner = scanner
                pendingJoinCallback = callback

                ensureController { /* warm controller early */ }
                startGuestScan(scanner, cleanCode)
            } catch (ex: Exception) {
                cleanupInternal(emitEnded = false, reason = "")
                callback(Result.failure(ex))
            }
        }
    }

    fun leaveJam(reason: String = "Left Jam session") {
        mainHandler.post {
            cleanupInternal(emitEnded = true, reason = reason)
        }
    }

    fun getJamStateJS(): JSObject {
        synchronized(stateLock) {
            val partsArr = JSArray()
            val speakersArr = JSArray()
            for (p in participants.values) {
                partsArr.put(p.toJSObject())
                if (p.isSpeakerEnabled) {
                    speakersArr.put(p.deviceAddress)
                }
            }

            val queueArr = JSArray()
            for (t in jamQueue) {
                queueArr.put(t.toJSObject())
            }

            return JSObject().apply {
                put("active", isActive)
                put("isActive", isActive)
                put("role", role)
                put("jamCode", jamCode)
                put("localDeviceId", localDeviceId)
                put("localDeviceName", localDeviceName)
                put("clockOffsetMs", clockOffsetMs)
                put("participants", partsArr)
                put("jamQueue", queueArr)
                put("activeSpeakers", speakersArr)
                val ct = currentTrack
                if (ct != null) {
                    put("currentTrack", ct.toJSObject())
                } else {
                    put("currentTrack", JSObject.NULL)
                }
                put("isPlaying", jamIsPlaying)
                put("positionMs", jamPositionMs)
            }
        }
    }

    fun addTrackToJam(trackObj: JSObject, callback: (Result<Unit>) -> Unit) {
        val jamTrack = JamTrack.fromJSObject(trackObj, localDeviceName)
        if (jamTrack == null) {
            callback(Result.failure(IllegalArgumentException("Track videoId is required.")))
            return
        }

        mainHandler.post {
            if (!isActive) {
                callback(Result.failure(IllegalStateException("Join or start a Jam first.")))
                return@post
            }

            if (role == ROLE_HOST) {
                handleAddTrackOnHost(jamTrack)
                callback(Result.success(Unit))
            } else if (role == ROLE_GUEST) {
                val payload = JSONObject().apply {
                    put("type", MSG_ADD_TRACK)
                    put("track", jamTrack.toJson())
                    put("addedBy", localDeviceName)
                }
                sendGuestCommand(payload)
                callback(Result.success(Unit))
            } else {
                callback(Result.failure(IllegalStateException("Not connected to a Jam.")))
            }
        }
    }

    fun setSpeakerDevices(deviceIds: List<String>, callback: (Result<Unit>) -> Unit) {
        mainHandler.post {
            if (!isActive || role != ROLE_HOST) {
                callback(Result.failure(IllegalStateException("Only the Jam Host can select speakers.")))
                return@post
            }

            val prevSpeakers = getActiveSpeakerIds().toHashSet()
            val selectedSet = deviceIds.toHashSet()
            synchronized(stateLock) {
                val updated = LinkedHashMap<String, JamParticipant>()
                for ((key, p) in participants) {
                    updated[key] = p.copy(isSpeakerEnabled = key in selectedSet)
                }
                participants.clear()
                participants.putAll(updated)
            }

            val hostSpeakerActive = HOST_DEVICE_ID in selectedSet
            mediaController?.let { ctrl ->
                ctrl.volume = if (hostSpeakerActive) 1.0f else 0.0f
            }

            broadcastStateSyncToAll()
            val addedGuestSpeaker = selectedSet.any { it != HOST_DEVICE_ID && it !in prevSpeakers }
            coordinateSpeakerChangeSyncPlay(resyncBarrier = addedGuestSpeaker)
            emitStateToUi()
            callback(Result.success(Unit))
        }
    }

    private fun startHostGattServer(adapter: BluetoothAdapter) {
        val mgr = bluetoothManager ?: return
        val server = mgr.openGattServer(appContext, hostGattCallback)
            ?: throw IllegalStateException("Unable to start BLE GATT Server.")
        gattServer = server

        val service = BluetoothGattService(
            JAM_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )

        val rxChar = BluetoothGattCharacteristic(
            COMMAND_RX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        val txChar = BluetoothGattCharacteristic(
            STATE_TX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        txChar.addDescriptor(
            BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
        )

        stateTxCharacteristic = txChar
        service.addCharacteristic(rxChar)
        service.addCharacteristic(txChar)

        if (!server.addService(service)) {
            throw IllegalStateException("Failed to register Xone Jam GATT service.")
        }
    }

    private fun startHostAdvertising(bleAdvertiser: BluetoothLeAdvertiser, code: String) {
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        val advertiseData = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(JAM_SERVICE_UUID))
            .build()

        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceData(ParcelUuid(JAM_SERVICE_UUID), code.toByteArray(Charsets.UTF_8))
            .build()

        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                mainHandler.post {
                    val pending = pendingCreateCallback
                    pendingCreateCallback = null
                    pending?.invoke(Result.success(getJamStateJS()))
                    emitStateToUi()
                }
            }

            override fun onStartFailure(errorCode: Int) {
                mainHandler.post {
                    val pending = pendingCreateCallback
                    pendingCreateCallback = null
                    val msg = "BLE advertising failed (code $errorCode)"
                    cleanupInternal(emitEnded = false, reason = "")
                    pending?.invoke(Result.failure(IllegalStateException(msg)))
                }
            }
        }
        advertiseCallback = cb
        bleAdvertiser.startAdvertising(settings, advertiseData, scanResponse, cb)
    }

    private val hostGattCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val addr = device.address ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedGuests[addr] = device
                deviceMtus.putIfAbsent(addr, DEFAULT_BLE_MTU)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedGuests.remove(addr)
                subscribedGuests.remove(addr)
                deviceMtus.remove(addr)
                synchronized(txLock) {
                    hostNotifyQueues.remove(addr)
                    hostNotifyInFlight.remove(addr)
                }
                val removed = synchronized(stateLock) {
                    participants.remove(addr) != null
                }
                if (removed && isActive) {
                    mainHandler.post {
                        expectedReadyGuests.remove(addr)
                        readyGuests.remove(addr)
                        broadcastStateSyncToAll()
                        if (!barrierDispatched) {
                            checkAndDispatchGoPlay(barrierGen)
                        }
                        emitStateToUi()
                    }
                }
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            device.address?.let { addr ->
                deviceMtus[addr] = mtu.coerceIn(DEFAULT_BLE_MTU, TARGET_BLE_MTU)
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (descriptor.uuid == CCCD_UUID) {
                val addr = device.address
                val enabled = value != null && value.isNotEmpty() && (value[0].toInt() and 0x01) != 0
                if (addr != null) {
                    if (enabled) subscribedGuests.add(addr) else subscribedGuests.remove(addr)
                }
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
                }
            } else if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            }
            if (characteristic.uuid != COMMAND_RX_CHAR_UUID || value == null || value.isEmpty()) {
                return
            }

            val addr = device.address ?: return
            val jsonText = reassembleMessage("host:$addr", value) ?: return
            handleHostCommandJson(device, jsonText)
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            val addr = device.address ?: return
            synchronized(txLock) {
                hostNotifyInFlight.remove(addr)
            }
            drainNextHostNotification(addr)
        }
    }

    private fun handleHostCommandJson(device: BluetoothDevice, jsonText: String) {
        val obj = try {
            JSONObject(jsonText)
        } catch (_: Exception) {
            return
        }
        val type = obj.optString("type")
        val addr = device.address ?: return

        when (type) {
            MSG_PING -> {
                val seq = obj.optInt("seq", 0)
                val t0 = obj.optLong("t0", 0L)
                val t1Host = SystemClock.elapsedRealtime()
                val pong = JSONObject().apply {
                    put("type", MSG_PONG)
                    put("seq", seq)
                    put("t0", t0)
                    put("t1Host", t1Host)
                }
                enqueueHostNotification(device, pong)
            }

            MSG_HELLO -> {
                val guestName = obj.optString("deviceName").trim()
                    .ifEmpty { device.name?.trim().orEmpty() }
                    .ifEmpty { "Guest (${addr.takeLast(5)})" }

                connectedGuests[addr] = device
                subscribedGuests.add(addr)

                synchronized(stateLock) {
                    val prevEnabled = participants[addr]?.isSpeakerEnabled ?: true
                    participants[addr] = JamParticipant(
                        deviceAddress = addr,
                        deviceName = guestName,
                        isHost = false,
                        isSpeakerEnabled = prevEnabled
                    )
                }

                val welcome = JSONObject().apply {
                    put("type", MSG_WELCOME)
                    put("yourDeviceId", addr)
                    put("jamCode", jamCode)
                }
                enqueueHostNotification(device, welcome)

                mainHandler.post {
                    broadcastStateSyncToAll()
                    if (currentTrack != null) {
                        coordinateSpeakerChangeSyncPlay(resyncBarrier = jamIsPlaying)
                    }
                    emitStateToUi()
                }
            }

            MSG_GUEST_READY -> {
                val videoId = obj.optCleanString("videoId")
                mainHandler.post {
                    handleGuestReadyOnHost(addr, videoId)
                }
            }

            MSG_ADD_TRACK -> {
                val trackObj = obj.optJSONObject("track") ?: return
                val fallbackName = participants[addr]?.deviceName ?: "Guest"
                val parsed = JamTrack.fromJson(trackObj) ?: return
                val addedTrack = parsed.copy(
                    addedBy = obj.optCleanString("addedBy").ifEmpty { fallbackName }
                )
                mainHandler.post {
                    handleAddTrackOnHost(addedTrack)
                }
            }
        }
    }

    private fun handleAddTrackOnHost(jamTrack: JamTrack) {
        if (!isActive || role != ROLE_HOST) return

        val shouldStartNow: Boolean
        val queueSnapshot: List<JamTrack>
        synchronized(stateLock) {
            val wasEmpty = jamQueue.isEmpty() || currentTrack == null
            if (jamQueue.none { it.videoId == jamTrack.videoId }) {
                jamQueue.add(jamTrack)
                if (jamQueue.size > MAX_QUEUE_TRACKS) jamQueue.removeAt(0)
            }
            shouldStartNow = wasEmpty
            if (shouldStartNow) {
                currentTrack = jamTrack
                jamIsPlaying = true
                jamPositionMs = 0L
            }
            queueSnapshot = ArrayList(jamQueue)
        }

        ensureController { ctrl ->
            ctrl.repeatMode = Player.REPEAT_MODE_ALL
            val mediaItem = jamTrack.toMediaItem()
            val playerIdle =
                ctrl.mediaItemCount == 0 ||
                    ctrl.playbackState == Player.STATE_IDLE ||
                    ctrl.playbackState == Player.STATE_ENDED

            if (shouldStartNow || playerIdle) {
                val items = queueSnapshot.map { it.toMediaItem() }
                val startIdx = queueSnapshot.indexOfFirst { it.videoId == jamTrack.videoId }
                    .coerceAtLeast(0)
                suppressHostPlayerEventsUntilMs = SystemClock.elapsedRealtime() + 800L
                ctrl.setMediaItems(items, startIdx, 0L)
                ctrl.playWhenReady = subscribedGuests.isEmpty()
                ctrl.prepare()
                broadcastStateSyncToAll()
                coordinateHostSyncPlay(fromTrackTransition = true, forcePlaying = true)
            } else {
                val alreadyInPlayer = (0 until ctrl.mediaItemCount).any {
                    ctrl.getMediaItemAt(it).mediaId == jamTrack.videoId
                }
                if (!alreadyInPlayer) {
                    ctrl.addMediaItem(mediaItem)
                }
                broadcastStateSyncToAll()
            }
            emitStateToUi()
        }
    }

    private fun buildStateSyncPayload(): JSONObject {
        synchronized(stateLock) {
            val partsArr = JSONArray()
            val speakersArr = JSONArray()
            for (p in participants.values) {
                partsArr.put(p.toJson())
                if (p.isSpeakerEnabled) {
                    speakersArr.put(p.deviceAddress)
                }
            }
            val queueArr = JSONArray()
            val recentQueue = if (jamQueue.size > 25) jamQueue.takeLast(25) else jamQueue
            for (t in recentQueue) {
                queueArr.put(t.toJson())
            }
            return JSONObject().apply {
                put("type", MSG_STATE_SYNC)
                put("jamCode", jamCode)
                put("participants", partsArr)
                put("jamQueue", queueArr)
                put("activeSpeakers", speakersArr)
                currentTrack?.let { put("currentTrack", it.toJson()) }
                put("isPlaying", jamIsPlaying)
                put("positionMs", jamPositionMs)
            }
        }
    }

    private fun broadcastStateSyncToAll() {
        val payload = buildStateSyncPayload()
        for (addr in subscribedGuests) {
            val dev = connectedGuests[addr] ?: continue
            enqueueHostNotification(dev, payload)
        }
    }

    private fun coordinateHostSyncPlay(
        fromTrackTransition: Boolean,
        forcePlaying: Boolean? = null
    ) {
        val ctrl = mediaController ?: return
        val curItem = ctrl.currentMediaItem ?: return
        val track = synchronized(stateLock) {
            currentTrack ?: JamTrack.fromMediaItem(curItem, localDeviceName)?.also { currentTrack = it }
        } ?: return

        val speakers = getActiveSpeakerIds()
        val hostSpeakerActive = HOST_DEVICE_ID in speakers
        val activeGuestSpeakers = subscribedGuests.filter { it in speakers }
        val hasGuests = subscribedGuests.isNotEmpty()
        val isPlayingNow =
            forcePlaying ?: (ctrl.playWhenReady && ctrl.playbackState != Player.STATE_ENDED)
        val rawPos = ctrl.currentPosition.coerceAtLeast(0L)

        hostStageRunnable?.let { mainHandler.removeCallbacks(it) }
        hostStageRunnable = null
        barrierTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        barrierTimeoutRunnable = null
        ctrl.playbackParameters = PlaybackParameters.DEFAULT

        if (!isPlayingNow) {
            ++syncGeneration
            ++barrierGen
            barrierDispatched = true
            barrierVideoId = ""
            synchronized(stateLock) {
                jamIsPlaying = false
                jamPositionMs = rawPos
            }
            ctrl.volume = if (hostSpeakerActive) 1.0f else 0.0f
            sendPrepareTrackBroadcast(track, rawPos, speakers, isPlaying = false)
            return
        }

        if (!hasGuests) {
            ++barrierGen
            barrierDispatched = true
            barrierVideoId = ""
            ctrl.volume = if (hostSpeakerActive) 1.0f else 0.0f
            if (!ctrl.isPlaying) {
                ctrl.playWhenReady = true
                ctrl.prepare()
                ctrl.play()
            }
            return
        }

        val stagePosMs = if (fromTrackTransition) 0L else rawPos
        val myBarrierGen = ++barrierGen
        barrierVideoId = track.videoId
        barrierPositionMs = stagePosMs
        expectedReadyGuests.clear()
        expectedReadyGuests.addAll(activeGuestSpeakers)
        readyGuests.clear()
        hostReady = false
        barrierDispatched = false

        synchronized(stateLock) {
            jamIsPlaying = true
            jamPositionMs = stagePosMs
        }

        suppressHostPlayerEventsUntilMs =
            SystemClock.elapsedRealtime() + MAX_PREPARE_BARRIER_WAIT_MS + GO_PLAY_LEAD_TIME_MS + 600L

        if (fromTrackTransition && ctrl.repeatMode != Player.REPEAT_MODE_ALL) {
            ctrl.repeatMode = Player.REPEAT_MODE_ALL
        }
        ctrl.playWhenReady = false
        ctrl.pause()
        if (abs(ctrl.currentPosition - stagePosMs) > 15L) {
            ctrl.seekTo(stagePosMs)
        }
        ctrl.prepare()
        ctrl.volume = if (hostSpeakerActive) 1.0f else 0.0f

        // Pre-warm Host stream URL if not stored locally offline
        scope.launch {
            if (XonePlaybackService.findOfflineTrackUri(appContext, track.videoId) == null) {
                runCatching { XoneExtractor.resolveAudioStream(track.videoId) }
            }
        }

        // Step 1: Ask every active speaker phone to buffer track to Player.STATE_READY
        sendPrepareTrackBroadcast(track, stagePosMs, speakers, isPlaying = true)

        if (ctrl.playbackState == Player.STATE_READY) {
            hostReady = true
        }

        val timeoutRunnable = Runnable {
            if (!isActive || role != ROLE_HOST) return@Runnable
            dispatchGoPlay(myBarrierGen)
        }
        barrierTimeoutRunnable = timeoutRunnable
        mainHandler.postDelayed(timeoutRunnable, MAX_PREPARE_BARRIER_WAIT_MS)

        checkAndDispatchGoPlay(myBarrierGen)
    }

    private fun handleGuestReadyOnHost(addr: String, videoId: String) {
        if (!isActive || role != ROLE_HOST || barrierDispatched) return
        if (videoId.isNotEmpty() && videoId != barrierVideoId) return
        readyGuests.add(addr)
        checkAndDispatchGoPlay(barrierGen)
    }

    private fun checkAndDispatchGoPlay(expectedGen: Long) {
        if (expectedGen != barrierGen || barrierDispatched) return
        if (hostReady && readyGuests.containsAll(expectedReadyGuests)) {
            dispatchGoPlay(expectedGen)
        }
    }

    private fun dispatchGoPlay(expectedGen: Long) {
        if (expectedGen != barrierGen || barrierDispatched) return
        barrierDispatched = true
        barrierTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        barrierTimeoutRunnable = null

        val ctrl = mediaController ?: return
        val videoId = barrierVideoId
        if (videoId.isEmpty()) return

        val targetHostTimeMs = SystemClock.elapsedRealtime() + GO_PLAY_LEAD_TIME_MS
        val speakers = getActiveSpeakerIds()

        val payload = JSONObject().apply {
            put("type", MSG_GO_PLAY)
            put("videoId", videoId)
            put("targetHostTimeMs", targetHostTimeMs)
            put("positionMs", barrierPositionMs)
        }
        for (addr in subscribedGuests) {
            val dev = connectedGuests[addr] ?: continue
            enqueueHostNotification(dev, payload)
        }

        val hostSpeakerActive = HOST_DEVICE_ID in speakers
        ctrl.volume = if (hostSpeakerActive) 1.0f else 0.0f
        suppressHostPlayerEventsUntilMs = targetHostTimeMs + 500L

        val playGen = ++syncGeneration
        hostStageRunnable?.let { mainHandler.removeCallbacks(it) }
        hostStageRunnable = schedulePrecisionPlay(
            gen = playGen,
            ctrl = ctrl,
            localTargetTimeMs = targetHostTimeMs,
            positionMs = barrierPositionMs
        ) {
            suppressHostPlayerEventsUntilMs = SystemClock.elapsedRealtime() + 400L
        }
    }

    private fun coordinateSpeakerChangeSyncPlay(resyncBarrier: Boolean) {
        val ctrl = mediaController ?: return
        val curItem = ctrl.currentMediaItem ?: return
        val track = synchronized(stateLock) {
            currentTrack ?: JamTrack.fromMediaItem(curItem, localDeviceName)?.also { currentTrack = it }
        } ?: return

        val speakers = getActiveSpeakerIds()
        val isPlayingNow = ctrl.isPlaying || ctrl.playWhenReady
        val curPos = ctrl.currentPosition.coerceAtLeast(0L)

        if (isPlayingNow && resyncBarrier) {
            coordinateHostSyncPlay(fromTrackTransition = false, forcePlaying = true)
            return
        }

        synchronized(stateLock) {
            jamIsPlaying = isPlayingNow
            jamPositionMs = curPos
        }

        sendHeartbeatBroadcast(track, SystemClock.elapsedRealtime(), curPos, isPlayingNow, speakers)
    }

    private fun startHostPeriodicBeacon() {
        hostPeriodicBeaconRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = object : Runnable {
            override fun run() {
                if (!isActive || role != ROLE_HOST) return
                val ctrl = mediaController
                val track = currentTrack
                if (
                    ctrl != null &&
                    track != null &&
                    ctrl.isPlaying &&
                    barrierDispatched &&
                    subscribedGuests.isNotEmpty()
                ) {
                    val hostNow = SystemClock.elapsedRealtime()
                    val curPos = ctrl.currentPosition.coerceAtLeast(0L)
                    synchronized(stateLock) { jamPositionMs = curPos }
                    sendHeartbeatBroadcast(
                        track = track,
                        hostTimeMs = hostNow,
                        positionMs = curPos,
                        isPlaying = true,
                        activeSpeakers = getActiveSpeakerIds()
                    )
                    emitStateToUi()
                }
                mainHandler.postDelayed(this, HOST_HEARTBEAT_INTERVAL_MS)
            }
        }
        hostPeriodicBeaconRunnable = runnable
        mainHandler.postDelayed(runnable, HOST_HEARTBEAT_INTERVAL_MS)
    }

    private fun sendPrepareTrackBroadcast(
        track: JamTrack,
        positionMs: Long,
        activeSpeakers: List<String>,
        isPlaying: Boolean
    ) {
        val speakersArr = JSONArray()
        for (id in activeSpeakers) speakersArr.put(id)

        val payload = JSONObject().apply {
            put("type", MSG_PREPARE_TRACK)
            put("videoId", track.videoId)
            put("track", track.toJson())
            put("positionMs", positionMs)
            put("isPlaying", isPlaying)
            put("activeSpeakers", speakersArr)
        }
        for (addr in subscribedGuests) {
            val dev = connectedGuests[addr] ?: continue
            enqueueHostNotification(dev, payload)
        }
    }

    private fun sendHeartbeatBroadcast(
        track: JamTrack,
        hostTimeMs: Long,
        positionMs: Long,
        isPlaying: Boolean,
        activeSpeakers: List<String>
    ) {
        val speakersArr = JSONArray()
        for (id in activeSpeakers) speakersArr.put(id)

        val payload = JSONObject().apply {
            put("type", MSG_HEARTBEAT)
            put("videoId", track.videoId)
            put("track", track.toJson())
            put("hostTimeMs", hostTimeMs)
            put("positionMs", positionMs)
            put("isPlaying", isPlaying)
            put("activeSpeakers", speakersArr)
        }
        for (addr in subscribedGuests) {
            val dev = connectedGuests[addr] ?: continue
            enqueueHostNotification(dev, payload)
        }
    }

    private fun getActiveSpeakerIds(): List<String> {
        synchronized(stateLock) {
            return participants.values.filter { it.isSpeakerEnabled }.map { it.deviceAddress }
        }
    }

    private fun enqueueHostNotification(device: BluetoothDevice, json: JSONObject) {
        val addr = device.address ?: return
        val bytes = json.toString().toByteArray(Charsets.UTF_8)
        val mtu = deviceMtus[addr] ?: DEFAULT_BLE_MTU
        val maxPayload = (mtu - 3).coerceIn(20, 509)
        val frames = encodeFrames(bytes, maxPayload)

        synchronized(txLock) {
            val queue = hostNotifyQueues.getOrPut(addr) { ArrayDeque() }
            for (frame in frames) {
                queue.addLast(frame)
            }
        }
        drainNextHostNotification(addr)
    }

    private fun drainNextHostNotification(addr: String) {
        val device = connectedGuests[addr] ?: return
        val server = gattServer ?: return
        val txChar = stateTxCharacteristic ?: return

        val nextFrame: ByteArray?
        synchronized(txLock) {
            if (addr in hostNotifyInFlight) return
            val queue = hostNotifyQueues[addr] ?: return
            nextFrame = if (queue.isEmpty()) null else queue.removeFirst()
            if (nextFrame != null) {
                hostNotifyInFlight.add(addr)
            }
        }

        if (nextFrame == null) return

        val sent = notifyCharacteristicCompat(server, device, txChar, nextFrame)
        if (!sent) {
            synchronized(txLock) {
                hostNotifyInFlight.remove(addr)
            }
        }
    }

    // ===================== GUEST SCAN, CONNECT & SYNC =====================

    private fun startGuestScan(scanner: BluetoothLeScanner, targetCode: String) {
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(JAM_SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        var foundDevice = false
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (foundDevice) return
                val data = result.scanRecord?.getServiceData(ParcelUuid(JAM_SERVICE_UUID)) ?: return
                val advertisedCode = String(data, Charsets.UTF_8).trim()
                if (advertisedCode != targetCode) return

                foundDevice = true
                mainHandler.post {
                    stopGuestScanOnly()
                    connectGuestToHost(result.device)
                }
            }

            override fun onScanFailed(errorCode: Int) {
                mainHandler.post {
                    stopGuestScanOnly()
                    val pending = pendingJoinCallback
                    pendingJoinCallback = null
                    cleanupInternal(emitEnded = false, reason = "")
                    pending?.invoke(
                        Result.failure(IllegalStateException("BLE scan failed (code $errorCode)"))
                    )
                }
            }
        }

        activeScanCallback = cb
        scanner.startScan(listOf(filter), settings, cb)

        val timeout = Runnable {
            if (!foundDevice && pendingJoinCallback != null) {
                stopGuestScanOnly()
                val pending = pendingJoinCallback
                pendingJoinCallback = null
                cleanupInternal(emitEnded = false, reason = "")
                pending?.invoke(
                    Result.failure(
                        IllegalStateException("No Host found for Jam code $targetCode. Ensure Host Bluetooth is on.")
                    )
                )
            }
        }
        scanTimeoutRunnable = timeout
        mainHandler.postDelayed(timeout, SCAN_TIMEOUT_MS)
    }

    private fun stopGuestScanOnly() {
        scanTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        scanTimeoutRunnable = null
        activeScanCallback?.let { cb ->
            runCatching { bleScanner?.stopScan(cb) }
        }
        activeScanCallback = null
    }

    private fun connectGuestToHost(hostDevice: BluetoothDevice) {
        guestServicesDiscovered = false
        guestMtu = DEFAULT_BLE_MTU
        val gatt = hostDevice.connectGatt(
            appContext,
            false,
            guestGattCallback,
            BluetoothDevice.TRANSPORT_LE
        )
        if (gatt == null) {
            val pending = pendingJoinCallback
            pendingJoinCallback = null
            cleanupInternal(emitEnded = false, reason = "")
            pending?.invoke(Result.failure(IllegalStateException("Failed to open GATT connection")))
            return
        }
        guestGatt = gatt

        val handshakeTimeout = Runnable {
            val pending = pendingJoinCallback
            if (pending != null) {
                pendingJoinCallback = null
                cleanupInternal(emitEnded = false, reason = "")
                pending.invoke(Result.failure(IllegalStateException("Timed out connecting to Jam Host")))
            }
        }
        joinTimeoutRunnable = handshakeTimeout
        mainHandler.postDelayed(handshakeTimeout, HANDSHAKE_TIMEOUT_MS)
    }

    private val guestGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                val mtuStarted = gatt.requestMtu(TARGET_BLE_MTU)
                mainHandler.postDelayed({
                    if (!guestServicesDiscovered && guestGatt === gatt) {
                        gatt.discoverServices()
                    }
                }, if (mtuStarted) 600L else 100L)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                mainHandler.post {
                    val pending = pendingJoinCallback
                    pendingJoinCallback = null
                    cleanupInternal(emitEnded = true, reason = "Disconnected from Jam Host")
                    pending?.invoke(Result.failure(IllegalStateException("Disconnected from Host")))
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                guestMtu = mtu.coerceIn(DEFAULT_BLE_MTU, TARGET_BLE_MTU)
            }
            if (!guestServicesDiscovered) {
                gatt.discoverServices()
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS || guestServicesDiscovered) return
            guestServicesDiscovered = true

            val service = gatt.getService(JAM_SERVICE_UUID) ?: return
            val rxChar = service.getCharacteristic(COMMAND_RX_CHAR_UUID)
            val txChar = service.getCharacteristic(STATE_TX_CHAR_UUID)
            if (rxChar == null || txChar == null) return

            guestRxCharacteristic = rxChar
            guestTxCharacteristic = txChar

            gatt.setCharacteristicNotification(txChar, true)
            val cccd = txChar.getDescriptor(CCCD_UUID)
            if (cccd != null) {
                enqueueGuestBleOp {
                    writeDescriptorCompat(gatt, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                }
            } else {
                sendGuestHelloAndStartClockSync()
            }
        }

        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            finishCurrentGuestBleOp()
            if (descriptor.uuid == CCCD_UUID) {
                sendGuestHelloAndStartClockSync()
            }
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            finishCurrentGuestBleOp()
        }

        @Deprecated("Deprecated in API 33")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
            @Suppress("DEPRECATION")
            val bytes = characteristic.value ?: return
            handleGuestCharacteristicBytes(characteristic.uuid, bytes)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            handleGuestCharacteristicBytes(characteristic.uuid, value)
        }
    }

    private fun handleGuestCharacteristicBytes(uuid: UUID, bytes: ByteArray) {
        if (uuid != STATE_TX_CHAR_UUID || bytes.isEmpty()) return
        val jsonText = reassembleMessage("guest:host", bytes) ?: return
        val obj = try {
            JSONObject(jsonText)
        } catch (_: Exception) {
            return
        }

        when (obj.optString("type")) {
            MSG_PONG -> handleGuestPong(obj)
            MSG_WELCOME -> handleGuestWelcome(obj)
            MSG_STATE_SYNC -> handleGuestStateSync(obj)
            MSG_PREPARE_TRACK -> handleGuestPrepareTrack(obj)
            MSG_GO_PLAY -> handleGuestGoPlay(obj)
            MSG_HEARTBEAT -> handleGuestHeartbeat(obj)
        }
    }

    private fun sendGuestHelloAndStartClockSync() {
        val hello = JSONObject().apply {
            put("type", MSG_HELLO)
            put("deviceName", localDeviceName)
            put("code", jamCode)
        }
        sendGuestCommand(hello)
        startGuestClockSyncLoop()
    }

    private fun startGuestClockSyncLoop() {
        clockSyncRunnable?.let { mainHandler.removeCallbacks(it) }
        val loop = object : Runnable {
            override fun run() {
                if (role != ROLE_GUEST || guestGatt == null) return
                sendFivePingBurst()
                mainHandler.postDelayed(this, CLOCK_SYNC_INTERVAL_MS)
            }
        }
        clockSyncRunnable = loop
        mainHandler.post(loop)
    }

    private fun sendFivePingBurst() {
        synchronized(pendingClockSamples) { pendingClockSamples.clear() }
        for (seq in 1..CLOCK_SYNC_SAMPLE_COUNT) {
            mainHandler.postDelayed({
                if (role == ROLE_GUEST && guestGatt != null) {
                    val ping = JSONObject().apply {
                        put("type", MSG_PING)
                        put("seq", seq)
                        put("t0", SystemClock.elapsedRealtime())
                    }
                    sendGuestCommand(ping)
                }
            }, (seq - 1) * PING_BURST_SPACING_MS)
        }
    }

    private fun handleGuestPong(obj: JSONObject) {
        val t2Guest = SystemClock.elapsedRealtime()
        val t0 = obj.optLong("t0", 0L)
        val t1Host = obj.optLong("t1Host", 0L)
        if (t0 <= 0L || t1Host <= 0L) return

        val rtt = (t2Guest - t0).coerceAtLeast(0L)
        val sampleOffset = ((t1Host - t0) + (t1Host - t2Guest)) / 2L

        synchronized(pendingClockSamples) {
            pendingClockSamples.add(rtt to sampleOffset)

            val lowJitter = pendingClockSamples.filter { it.first <= MAX_ACCEPTABLE_RTT_MS }
            val candidates = if (lowJitter.isNotEmpty()) {
                lowJitter
            } else {
                pendingClockSamples.sortedBy { it.first }.take(3)
            }

            if (candidates.isNotEmpty()) {
                val sortedOffsets = candidates.map { it.second }.sorted()
                val mid = sortedOffsets.size / 2
                clockOffsetMs = if (sortedOffsets.size % 2 == 1) {
                    sortedOffsets[mid]
                } else {
                    (sortedOffsets[mid - 1] + sortedOffsets[mid]) / 2L
                }
            }
        }
        emitStateToUi()
    }

    private fun handleGuestWelcome(obj: JSONObject) {
        val assignedId = obj.optString("yourDeviceId").trim()
        synchronized(stateLock) {
            if (assignedId.isNotEmpty()) {
                localDeviceId = assignedId
            }
            isActive = true
        }
        mainHandler.post {
            joinTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
            joinTimeoutRunnable = null
            val pending = pendingJoinCallback
            pendingJoinCallback = null
            pending?.invoke(Result.success(getJamStateJS()))
            emitStateToUi()
        }
    }

    private fun handleGuestStateSync(obj: JSONObject) {
        val partsJson = obj.optJSONArray("participants")
        val queueJson = obj.optJSONArray("jamQueue")
        val trackJson = obj.optJSONObject("currentTrack")

        synchronized(stateLock) {
            isActive = true
            if (partsJson != null) {
                participants.clear()
                for (i in 0 until partsJson.length()) {
                    val item = partsJson.optJSONObject(i) ?: continue
                    val addr = item.optString("deviceAddress")
                    if (addr.isNotEmpty()) {
                        participants[addr] = JamParticipant(
                            deviceAddress = addr,
                            deviceName = item.optString("deviceName", "Device"),
                            isHost = item.optBoolean("isHost", false),
                            isSpeakerEnabled = item.optBoolean("isSpeakerEnabled", true)
                        )
                    }
                }
            }
            if (queueJson != null) {
                jamQueue.clear()
                for (i in 0 until queueJson.length()) {
                    val item = queueJson.optJSONObject(i) ?: continue
                    JamTrack.fromJson(item)?.let { jamQueue.add(it) }
                }
            }
            trackJson?.let { JamTrack.fromJson(it)?.let { parsed -> currentTrack = parsed } }
            jamIsPlaying = obj.optBoolean("isPlaying", jamIsPlaying)
            jamPositionMs = obj.optLong("positionMs", jamPositionMs)
        }

        mainHandler.post {
            val pending = pendingJoinCallback
            if (pending != null) {
                joinTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
                joinTimeoutRunnable = null
                pendingJoinCallback = null
                pending.invoke(Result.success(getJamStateJS()))
            }
            if (localDeviceId !in getActiveSpeakerIds()) {
                mediaController?.let { ctrl ->
                    ctrl.playbackParameters = PlaybackParameters.DEFAULT
                    ctrl.volume = 0.0f
                    ctrl.pause()
                }
            }
            emitStateToUi()
        }
    }

    private fun parseActiveSpeakers(obj: JSONObject): Set<String> {
        val speakersArr = obj.optJSONArray("activeSpeakers") ?: return getActiveSpeakerIds().toHashSet()
        val activeSpeakers = HashSet<String>()
        for (i in 0 until speakersArr.length()) {
            val id = speakersArr.optString(i)
            if (id.isNotEmpty()) activeSpeakers.add(id)
        }
        return activeSpeakers
    }

    private fun updateParticipantsSpeakerState(activeSpeakers: Set<String>) {
        val updated = LinkedHashMap<String, JamParticipant>()
        for ((k, v) in participants) {
            updated[k] = v.copy(isSpeakerEnabled = k in activeSpeakers)
        }
        participants.clear()
        participants.putAll(updated)
    }

    private fun clearGuestReadyListener(ctrl: MediaController?) {
        guestReadyListener?.let { listener ->
            ctrl?.removeListener(listener)
        }
        guestReadyListener = null
    }

    private fun sendGuestReady(videoId: String) {
        if (!isActive || role != ROLE_GUEST) return
        val ready = JSONObject().apply {
            put("type", MSG_GUEST_READY)
            put("videoId", videoId)
        }
        sendGuestCommand(ready)
    }

    private fun handleGuestPrepareTrack(obj: JSONObject) {
        val videoId = obj.optCleanString("videoId")
        val trackObj = obj.optJSONObject("track")
        val track = trackObj?.let { JamTrack.fromJson(it) }
            ?: synchronized(stateLock) { jamQueue.firstOrNull { it.videoId == videoId } }
            ?: return
        val positionMs = obj.optLong("positionMs", 0L).coerceAtLeast(0L)
        val shouldPlay = obj.optBoolean("isPlaying", false)
        val activeSpeakers = parseActiveSpeakers(obj)

        synchronized(stateLock) {
            currentTrack = track
            jamIsPlaying = shouldPlay
            jamPositionMs = positionMs
            updateParticipantsSpeakerState(activeSpeakers)
        }

        emitStateToUi()

        val isThisPhoneSpeaker = localDeviceId in activeSpeakers

        mainHandler.post {
            val gen = ++syncGeneration
            cancelGuestSyncRunnables()

            ensureController { ctrl ->
                if (gen != syncGeneration || !isActive) return@ensureController
                clearGuestReadyListener(ctrl)
                ctrl.playbackParameters = PlaybackParameters.DEFAULT

                if (!isThisPhoneSpeaker || !shouldPlay) {
                    ctrl.volume = if (isThisPhoneSpeaker) 1.0f else 0.0f
                    ctrl.playWhenReady = false
                    ctrl.pause()
                    if (abs(ctrl.currentPosition - positionMs) > 25L) {
                        ctrl.seekTo(positionMs)
                    }
                    return@ensureController
                }

                // Step 1: Pre-resolve stream URL (if not offline) and buffer ExoPlayer to STATE_READY with playWhenReady = false
                scope.launch {
                    if (XonePlaybackService.findOfflineTrackUri(appContext, track.videoId) == null) {
                        runCatching { XoneExtractor.resolveAudioStream(track.videoId) }
                    }

                    mainHandler.post {
                        if (gen != syncGeneration || !isActive) return@post

                        clearGuestReadyListener(ctrl)
                        val mediaItem = track.toMediaItem()
                        if (ctrl.currentMediaItem?.mediaId != track.videoId) {
                            ctrl.setMediaItem(mediaItem)
                        }
                        ctrl.playbackParameters = PlaybackParameters.DEFAULT
                        ctrl.volume = 1.0f
                        ctrl.playWhenReady = false
                        ctrl.pause()
                        if (abs(ctrl.currentPosition - positionMs) > 15L) {
                            ctrl.seekTo(positionMs)
                        }
                        ctrl.prepare()

                        if (ctrl.playbackState == Player.STATE_READY) {
                            sendGuestReady(track.videoId)
                        } else {
                            var sentReady = false
                            val readyWaiter = object : Player.Listener {
                                override fun onPlaybackStateChanged(playbackState: Int) {
                                    if (sentReady || gen != syncGeneration || !isActive) return
                                    if (playbackState == Player.STATE_READY) {
                                        sentReady = true
                                        ctrl.removeListener(this)
                                        if (guestReadyListener === this) {
                                            guestReadyListener = null
                                        }
                                        sendGuestReady(track.videoId)
                                    }
                                }
                            }
                            guestReadyListener = readyWaiter
                            ctrl.addListener(readyWaiter)
                        }
                    }
                }
            }
        }
    }

    private fun handleGuestGoPlay(obj: JSONObject) {
        val videoId = obj.optCleanString("videoId")
        val targetHostTimeMs = obj.optLong("targetHostTimeMs", 0L)
        val positionMs = obj.optLong("positionMs", 0L).coerceAtLeast(0L)
        if (videoId.isEmpty() || targetHostTimeMs <= 0L) return

        val isThisPhoneSpeaker = synchronized(stateLock) {
            jamIsPlaying = true
            jamPositionMs = positionMs
            localDeviceId in getActiveSpeakerIds()
        }
        emitStateToUi()

        if (!isThisPhoneSpeaker) return

        mainHandler.post {
            val gen = ++syncGeneration
            cancelGuestSyncRunnables()

            ensureController { ctrl ->
                if (gen != syncGeneration || !isActive) return@ensureController
                clearGuestReadyListener(ctrl)

                if (ctrl.currentMediaItem?.mediaId != videoId) {
                    val track = synchronized(stateLock) {
                        currentTrack?.takeIf { it.videoId == videoId }
                            ?: jamQueue.firstOrNull { it.videoId == videoId }
                    }
                    if (track != null) {
                        ctrl.setMediaItem(track.toMediaItem())
                        ctrl.prepare()
                    }
                }

                ctrl.volume = 1.0f
                val localTargetTime = targetHostTimeMs - clockOffsetMs
                guestSyncPlayRunnable = schedulePrecisionPlay(
                    gen = gen,
                    ctrl = ctrl,
                    localTargetTimeMs = localTargetTime,
                    positionMs = positionMs
                ) {
                    guestSyncPlayRunnable = null
                }
            }
        }
    }

    private fun handleGuestHeartbeat(obj: JSONObject) {
        val videoId = obj.optCleanString("videoId")
        val trackObj = obj.optJSONObject("track")
        val track = trackObj?.let { JamTrack.fromJson(it) }
            ?: synchronized(stateLock) {
                currentTrack?.takeIf { it.videoId == videoId }
                    ?: jamQueue.firstOrNull { it.videoId == videoId }
            }
        val hostTimeMs = obj.optLong("hostTimeMs", 0L)
        val positionMs = obj.optLong("positionMs", 0L).coerceAtLeast(0L)
        val isPlaying = obj.optBoolean("isPlaying", false)
        val activeSpeakers = parseActiveSpeakers(obj)

        synchronized(stateLock) {
            if (track != null) currentTrack = track
            jamIsPlaying = isPlaying
            jamPositionMs = positionMs
            updateParticipantsSpeakerState(activeSpeakers)
        }
        emitStateToUi()

        val isThisPhoneSpeaker = localDeviceId in activeSpeakers

        mainHandler.post {
            ensureController { ctrl ->
                if (!isActive) return@ensureController

                if (!isThisPhoneSpeaker || !isPlaying) {
                    guestNudgeResetRunnable?.let { mainHandler.removeCallbacks(it) }
                    guestNudgeResetRunnable = null
                    ctrl.playbackParameters = PlaybackParameters.DEFAULT
                    ctrl.volume = if (isThisPhoneSpeaker) 1.0f else 0.0f
                    ctrl.playWhenReady = false
                    ctrl.pause()
                    return@ensureController
                }

                // Skip nudging while still waiting for GO_PLAY scheduled launch
                if (guestSyncPlayRunnable != null) return@ensureController

                val expectedPosMs = if (hostTimeMs > 0L) {
                    (positionMs + ((SystemClock.elapsedRealtime() + clockOffsetMs) - hostTimeMs))
                        .coerceAtLeast(0L)
                } else {
                    positionMs
                }

                // Recover if guest joined mid-track or missed PREPARE_TRACK
                if (videoId.isNotEmpty() && ctrl.currentMediaItem?.mediaId != videoId && track != null) {
                    ctrl.setMediaItem(track.toMediaItem())
                    ctrl.volume = 1.0f
                    ctrl.seekTo(expectedPosMs)
                    ctrl.prepare()
                    ctrl.play()
                    return@ensureController
                }

                ctrl.volume = 1.0f
                if (!ctrl.isPlaying && ctrl.playbackState == Player.STATE_READY) {
                    ctrl.seekTo(expectedPosMs)
                    ctrl.play()
                    return@ensureController
                }

                if (ctrl.playbackState != Player.STATE_READY) return@ensureController

                val driftMs = expectedPosMs - ctrl.currentPosition
                val absDrift = abs(driftMs)

                guestNudgeResetRunnable?.let { mainHandler.removeCallbacks(it) }
                guestNudgeResetRunnable = null

                when {
                    absDrift in NUDGE_MIN_DRIFT_MS..NUDGE_MAX_DRIFT_MS -> {
                        val targetSpeed = if (driftMs > 0L) NUDGE_FAST_SPEED else NUDGE_SLOW_SPEED
                        ctrl.playbackParameters = PlaybackParameters(targetSpeed)
                        val nudgeDurationMs = minOf(absDrift * NUDGE_MS_PER_DRIFT_MS, MAX_NUDGE_DURATION_MS)
                        val resetRunnable = Runnable {
                            guestNudgeResetRunnable = null
                            if (isActive) {
                                ctrl.playbackParameters = PlaybackParameters.DEFAULT
                            }
                        }
                        guestNudgeResetRunnable = resetRunnable
                        mainHandler.postDelayed(resetRunnable, nudgeDurationMs)
                    }
                    absDrift > NUDGE_MAX_DRIFT_MS -> {
                        ctrl.playbackParameters = PlaybackParameters.DEFAULT
                        ctrl.seekTo(expectedPosMs)
                    }
                    else -> {
                        if (ctrl.playbackParameters.speed != 1.0f) {
                            ctrl.playbackParameters = PlaybackParameters.DEFAULT
                        }
                    }
                }
            }
        }
    }

    private fun schedulePrecisionPlay(
        gen: Long,
        ctrl: MediaController,
        localTargetTimeMs: Long,
        positionMs: Long,
        onTriggered: (() -> Unit)? = null
    ): Runnable? {
        ctrl.playbackParameters = PlaybackParameters.DEFAULT
        if (abs(ctrl.currentPosition - positionMs) > 15L) {
            ctrl.seekTo(positionMs)
        }

        val triggerNow = {
            val nowAtTrigger = SystemClock.elapsedRealtime()
            if (nowAtTrigger > localTargetTimeMs + 5L) {
                val catchUpPos = (positionMs + (nowAtTrigger - localTargetTimeMs)).coerceAtLeast(0L)
                ctrl.seekTo(catchUpPos)
            } else if (abs(ctrl.currentPosition - positionMs) > 15L) {
                ctrl.seekTo(positionMs)
            }
            ctrl.playbackParameters = PlaybackParameters.DEFAULT
            ctrl.play()
            onTriggered?.invoke()
        }

        val remainingMs = localTargetTimeMs - SystemClock.elapsedRealtime()
        if (remainingMs <= 0L) {
            triggerNow()
            return null
        }

        if (remainingMs <= SPIN_WAIT_THRESHOLD_MS) {
            while (SystemClock.elapsedRealtime() < localTargetTimeMs) {
                // Brief <= 8ms busy-wait for sub-2ms trigger alignment
            }
            triggerNow()
            return null
        }

        val delayMs = (remainingMs - SPIN_WAIT_THRESHOLD_MS).coerceAtLeast(1L)
        val runnable = Runnable {
            if (gen != syncGeneration || !isActive) return@Runnable
            while (SystemClock.elapsedRealtime() < localTargetTimeMs) {
                // Spin-wait the final <= 8ms window for sub-2ms trigger alignment
            }
            triggerNow()
        }
        mainHandler.postDelayed(runnable, delayMs)
        return runnable
    }

    private fun cancelGuestSyncRunnables() {
        guestSyncPlayRunnable?.let { mainHandler.removeCallbacks(it) }
        guestSyncPlayRunnable = null
        guestNudgeResetRunnable?.let { mainHandler.removeCallbacks(it) }
        guestNudgeResetRunnable = null
        clearGuestReadyListener(mediaController)
        for (r in guestDriftRunnables) {
            mainHandler.removeCallbacks(r)
        }
        guestDriftRunnables.clear()
    }

    private fun sendGuestCommand(json: JSONObject) {
        val gatt = guestGatt ?: return
        val rxChar = guestRxCharacteristic ?: return
        val bytes = json.toString().toByteArray(Charsets.UTF_8)
        val maxPayload = (guestMtu - 3).coerceIn(20, 509)
        val frames = encodeFrames(bytes, maxPayload)
        for (frame in frames) {
            enqueueGuestBleOp {
                writeCharacteristicCompat(gatt, rxChar, frame)
            }
        }
    }

    private fun enqueueGuestBleOp(op: () -> Boolean) {
        synchronized(txLock) {
            guestWriteQueue.addLast(op)
        }
        drainGuestBleOp()
    }

    private fun drainGuestBleOp() {
        val nextOp: (() -> Boolean)?
        synchronized(txLock) {
            if (guestWriteInFlight || guestWriteQueue.isEmpty()) return
            guestWriteInFlight = true
            nextOp = guestWriteQueue.removeFirst()
        }
        val launched = try {
            nextOp?.invoke() ?: false
        } catch (_: Exception) {
            false
        }
        if (!launched) {
            finishCurrentGuestBleOp()
        }
    }

    private fun finishCurrentGuestBleOp() {
        synchronized(txLock) {
            guestWriteInFlight = false
        }
        drainGuestBleOp()
    }

    // ===================== PACKET FRAMING / REASSEMBLY =====================

    private fun encodeFrames(payload: ByteArray, maxPacketSize: Int): List<ByteArray> {
        if (payload.size <= maxPacketSize) {
            return listOf(payload)
        }
        val chunkPayloadMax = (maxPacketSize - 4).coerceAtLeast(12)
        val totalChunks = ((payload.size + chunkPayloadMax - 1) / chunkPayloadMax).coerceAtMost(255)
        val msgId = (++outgoingMsgSeq) and 0xFF
        val frames = ArrayList<ByteArray>(totalChunks)

        for (idx in 0 until totalChunks) {
            val start = idx * chunkPayloadMax
            val end = minOf(payload.size, start + chunkPayloadMax)
            val len = end - start
            val packet = ByteArray(4 + len)
            packet[0] = CHUNK_MAGIC
            packet[1] = msgId.toByte()
            packet[2] = idx.toByte()
            packet[3] = totalChunks.toByte()
            System.arraycopy(payload, start, packet, 4, len)
            frames.add(packet)
        }
        return frames
    }

    private fun reassembleMessage(peerPrefix: String, packet: ByteArray): String? {
        if (packet.isEmpty()) return null
        if (packet[0] != CHUNK_MAGIC) {
            return String(packet, Charsets.UTF_8)
        }
        if (packet.size < 4) return null

        val msgId = packet[1].toInt() and 0xFF
        val chunkIndex = packet[2].toInt() and 0xFF
        val totalChunks = packet[3].toInt() and 0xFF
        if (totalChunks <= 0) return null

        val slice = packet.copyOfRange(4, packet.size)
        val key = "$peerPrefix:$msgId"
        val assembly = reassemblyMap.getOrPut(key) { IncomingAssembly(totalChunks) }
        val completed = assembly.addChunk(chunkIndex, slice)
        if (completed != null) {
            reassemblyMap.remove(key)
            return String(completed, Charsets.UTF_8)
        }
        return null
    }

    // ===================== SDK COMPAT HELPERS =====================

    private fun notifyCharacteristicCompat(
        server: BluetoothGattServer,
        device: BluetoothDevice,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray
    ): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(device, characteristic, false, value) ==
                BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            characteristic.value = value
            @Suppress("DEPRECATION")
            server.notifyCharacteristicChanged(device, characteristic, false)
        }
    }

    private fun writeCharacteristicCompat(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray
    ): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(
                characteristic,
                value,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            ) == BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            @Suppress("DEPRECATION")
            characteristic.value = value
            @Suppress("DEPRECATION")
            gatt.writeCharacteristic(characteristic)
        }
    }

    private fun writeDescriptorCompat(
        gatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        value: ByteArray
    ): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            descriptor.value = value
            @Suppress("DEPRECATION")
            gatt.writeDescriptor(descriptor)
        }
    }

    private fun emitStateToUi() {
        val snapshot = getJamStateJS()
        mainHandler.post {
            listener?.onJamStateUpdated(snapshot)
        }
    }

    private fun cleanupInternal(emitEnded: Boolean, reason: String) {
        val wasActive = isActive || role != ROLE_NONE

        stopGuestScanOnly()
        joinTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        joinTimeoutRunnable = null

        clockSyncRunnable?.let { mainHandler.removeCallbacks(it) }
        clockSyncRunnable = null

        hostStageRunnable?.let { mainHandler.removeCallbacks(it) }
        hostStageRunnable = null

        barrierTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        barrierTimeoutRunnable = null
        ++barrierGen
        barrierDispatched = true
        barrierVideoId = ""
        expectedReadyGuests.clear()
        readyGuests.clear()
        hostReady = false

        hostPeriodicBeaconRunnable?.let { mainHandler.removeCallbacks(it) }
        hostPeriodicBeaconRunnable = null

        cancelGuestSyncRunnables()
        ++syncGeneration

        mediaController?.removeListener(hostPlayerListener)
        mediaController?.let { ctrl ->
            ctrl.repeatMode = Player.REPEAT_MODE_OFF
            ctrl.playbackParameters = PlaybackParameters.DEFAULT
            if (ctrl.volume < 0.99f) {
                ctrl.volume = 1.0f
            }
        }

        advertiseCallback?.let { cb ->
            runCatching { advertiser?.stopAdvertising(cb) }
        }
        advertiseCallback = null
        advertiser = null

        runCatching { gattServer?.close() }
        gattServer = null
        stateTxCharacteristic = null
        connectedGuests.clear()
        subscribedGuests.clear()
        deviceMtus.clear()

        runCatching {
            guestGatt?.disconnect()
            guestGatt?.close()
        }
        guestGatt = null
        guestRxCharacteristic = null
        guestTxCharacteristic = null
        guestServicesDiscovered = false

        synchronized(txLock) {
            hostNotifyQueues.clear()
            hostNotifyInFlight.clear()
            guestWriteQueue.clear()
            guestWriteInFlight = false
        }
        reassemblyMap.clear()

        synchronized(stateLock) {
            isActive = false
            role = ROLE_NONE
            jamCode = ""
            localDeviceId = HOST_DEVICE_ID
            clockOffsetMs = 0L
            participants.clear()
            jamQueue.clear()
            currentTrack = null
            jamIsPlaying = false
            jamPositionMs = 0L
        }

        if (emitEnded && wasActive) {
            emitStateToUi()
            listener?.onJamEnded(reason)
        }
    }

    companion object {
        private val JAM_SERVICE_UUID = UUID.fromString("e8c01001-9f4a-4b8d-9b1a-586f6e654a6d")
        private val COMMAND_RX_CHAR_UUID = UUID.fromString("e8c01002-9f4a-4b8d-9b1a-586f6e654a6d")
        private val STATE_TX_CHAR_UUID = UUID.fromString("e8c01003-9f4a-4b8d-9b1a-586f6e654a6d")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        private const val ROLE_NONE = "none"
        private const val ROLE_HOST = "host"
        private const val ROLE_GUEST = "guest"
        private const val HOST_DEVICE_ID = "HOST"

        private const val DEFAULT_BLE_MTU = 23
        private const val TARGET_BLE_MTU = 512
        private const val CHUNK_MAGIC: Byte = 0x01
        private const val MAX_QUEUE_TRACKS = 50

        private const val MAX_PREPARE_BARRIER_WAIT_MS = 2500L
        private const val GO_PLAY_LEAD_TIME_MS = 450L
        private const val SPIN_WAIT_THRESHOLD_MS = 8L
        private const val CLOCK_SYNC_INTERVAL_MS = 10_000L
        private const val CLOCK_SYNC_SAMPLE_COUNT = 5
        private const val PING_BURST_SPACING_MS = 90L
        private const val MAX_ACCEPTABLE_RTT_MS = 120L
        private const val HOST_HEARTBEAT_INTERVAL_MS = 3_000L
        private const val NUDGE_MIN_DRIFT_MS = 35L
        private const val NUDGE_MAX_DRIFT_MS = 350L
        private const val NUDGE_FAST_SPEED = 1.04f
        private const val NUDGE_SLOW_SPEED = 0.96f
        private const val NUDGE_MS_PER_DRIFT_MS = 25L
        private const val MAX_NUDGE_DURATION_MS = 1200L
        private const val SCAN_TIMEOUT_MS = 15_000L
        private const val HANDSHAKE_TIMEOUT_MS = 10_000L

        private const val MSG_HELLO = "HELLO"
        private const val MSG_WELCOME = "WELCOME"
        private const val MSG_PING = "PING"
        private const val MSG_PONG = "PONG"
        private const val MSG_ADD_TRACK = "ADD_TRACK"
        private const val MSG_STATE_SYNC = "STATE_SYNC"
        private const val MSG_PREPARE_TRACK = "PREPARE_TRACK"
        private const val MSG_GUEST_READY = "GUEST_READY"
        private const val MSG_GO_PLAY = "GO_PLAY"
        private const val MSG_HEARTBEAT = "HEARTBEAT"

        @Volatile
        private var instance: XoneBleJamManager? = null

        private fun JSONObject.optCleanString(key: String, fallback: String = ""): String {
            if (!has(key) || isNull(key)) return fallback
            return optString(key, fallback).trim().ifEmpty { fallback }
        }

        fun getInstance(context: Context): XoneBleJamManager {
            return instance ?: synchronized(this) {
                instance ?: XoneBleJamManager(context.applicationContext).also { instance = it }
            }
        }
    }
}
