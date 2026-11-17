package com.xone.music

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

@CapacitorPlugin(
    name = "XoneJam",
    permissions = [
        Permission(
            strings = [
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            ],
            alias = "ble"
        ),
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location"
        )
    ]
)
class XoneJamPlugin : Plugin(), XoneBleJamManager.Listener {

    private lateinit var jamManager: XoneBleJamManager

    override fun load() {
        super.load()
        jamManager = XoneBleJamManager.getInstance(context)
        jamManager.setListener(this)
    }

    override fun handleOnDestroy() {
        jamManager.setListener(null)
        super.handleOnDestroy()
    }

    override fun onJamStateUpdated(state: JSObject) {
        notifyListeners("jamStateUpdated", state)
    }

    override fun onJamEnded(reason: String) {
        val payload = JSObject().apply {
            put("reason", reason)
        }
        notifyListeners("jamEnded", payload)
    }

    private fun runWithBlePermissions(call: PluginCall, action: () -> Unit) {
        val mainActivity = activity as? MainActivity
        if (mainActivity == null) {
            call.reject("Activity unavailable")
            return
        }
        mainActivity.ensureBlePermissions { granted ->
            if (!granted) {
                call.reject("Bluetooth permissions are required to host or join a Jam.")
            } else {
                action()
            }
        }
    }

    @PluginMethod
    fun createJam(call: PluginCall) {
        val deviceName = call.getString("deviceName")
        runWithBlePermissions(call) {
            jamManager.createJam(deviceName) { result ->
                result.onSuccess { state ->
                    call.resolve(state)
                }.onFailure { err ->
                    call.reject(err.localizedMessage ?: "Failed to start BLE Jam", Exception(err))
                }
            }
        }
    }

    @PluginMethod
    fun joinJam(call: PluginCall) {
        val code = call.getString("code")?.trim().orEmpty()
        val deviceName = call.getString("deviceName")
        if (code.length != 6) {
            call.reject("A 6-digit Jam code is required")
            return
        }

        runWithBlePermissions(call) {
            jamManager.joinJam(code, deviceName) { result ->
                result.onSuccess { state ->
                    call.resolve(state)
                }.onFailure { err ->
                    call.reject(err.localizedMessage ?: "Failed to join Jam", Exception(err))
                }
            }
        }
    }

    @PluginMethod
    fun leaveJam(call: PluginCall) {
        jamManager.leaveJam("Left Jam session")
        call.resolve()
    }

    @PluginMethod
    fun addTrackToJam(call: PluginCall) {
        jamManager.addTrackToJam(call.data) { result ->
            result.onSuccess {
                call.resolve()
            }.onFailure { err ->
                call.reject(err.localizedMessage ?: "Failed to add track to Jam", Exception(err))
            }
        }
    }

    @PluginMethod
    fun setSpeakerDevices(call: PluginCall) {
        val arr = call.getArray("deviceIds")
        val ids = ArrayList<String>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val id = arr.optString(i)?.trim().orEmpty()
                if (id.isNotEmpty()) {
                    ids.add(id)
                }
            }
        }

        jamManager.setSpeakerDevices(ids) { result ->
            result.onSuccess {
                call.resolve()
            }.onFailure { err ->
                call.reject(err.localizedMessage ?: "Failed to update speaker devices", Exception(err))
            }
        }
    }

    @PluginMethod
    fun setMultiSpeakerMode(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        jamManager.setMultiSpeakerMode(enabled) { result ->
            result.onSuccess {
                call.resolve()
            }.onFailure { err ->
                call.reject(err.localizedMessage ?: "Failed to toggle Multi-Speaker Mode", Exception(err))
            }
        }
    }

    @PluginMethod
    fun playJamTrack(call: PluginCall) {
        val videoId = call.getString("videoId")?.trim().orEmpty()
        if (videoId.isEmpty()) {
            call.reject("videoId is required")
            return
        }
        jamManager.playJamTrackById(videoId) { result ->
            result.onSuccess {
                call.resolve()
            }.onFailure { err ->
                call.reject(err.localizedMessage ?: "Failed to switch Jam track", Exception(err))
            }
        }
    }

    @PluginMethod
    fun getJamState(call: PluginCall) {
        call.resolve(jamManager.getJamStateJS())
    }
}
