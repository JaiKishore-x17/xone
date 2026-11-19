package com.xone.music

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tanh

/**
 * Real-time 16-bit PCM DSP processor for Xone solo playback:
 *  - 8D Spatial Auto-Panning: 0.13 Hz LFO equal-power orbit, ~0.55 ms ITD micro-delay, and early room reflection.
 *  - Lush Reverb Engine: Stereo Schroeder/Freeverb tank (4 damped combs + 2 allpasses per channel) with warm damping.
 *
 * Always outputs 2-channel 16-bit PCM so DSP modes can be toggled seamlessly mid-track without
 * reconfiguring the downstream AudioSink. Passes audio through bit-transparently when both modes are off.
 */
@OptIn(UnstableApi::class)
class XoneAudioEffectsProcessor : BaseAudioProcessor() {

    @Volatile
    var eightDEnabled: Boolean = false

    @Volatile
    var srEnabled: Boolean = false

    @Volatile
    private var pendingClear: Boolean = false

    private var sampleRate: Int = 44100
    private var inputChannelCount: Int = 2

    // Smooth ~25 ms bypass/enable envelopes to prevent clicks
    private var eightDMix: Float = 0f
    private var srMix: Float = 0f
    private var mixStep: Float = 1f / (0.025f * 44100f)

    // 8D spatial state & delay ring buffers
    private var lfoPhase: Double = 0.0
    private var lpfLeft: Float = 0f
    private var lpfRight: Float = 0f
    private var headShadowMinAlpha: Float = 0.30f
    private var delayBufferL: FloatArray = FloatArray(1)
    private var delayBufferR: FloatArray = FloatArray(1)
    private var delayWriteIdx: Int = 0
    private var delayCapacity: Int = 1
    private var maxItdSamples: Float = 24f
    private var earlyDelaySamplesL: Int = 485
    private var earlyDelaySamplesR: Int = 750

    // Reverb state (4 parallel damped combs + 2 series allpasses per channel + pre-delay)
    private var preDelayL: FloatArray = FloatArray(1)
    private var preDelayR: FloatArray = FloatArray(1)
    private var preDelayIdx: Int = 0
    private var preDelayLen: Int = 1

    private var combsL: Array<CombFilter> = emptyArray()
    private var combsR: Array<CombFilter> = emptyArray()
    private var allpassesL: Array<AllpassFilter> = emptyArray()
    private var allpassesR: Array<AllpassFilter> = emptyArray()

    // Warm wet low-pass filter state
    private var wetLpL: Float = 0f
    private var wetLpR: Float = 0f
    private var wetLpCoeff: Float = 0.45f

    private var configuredSampleRate: Int = 0

    fun clearState() {
        pendingClear = true
    }

    override fun onConfigure(
        inputAudioFormat: AudioProcessor.AudioFormat
    ): AudioProcessor.AudioFormat {
        if (
            inputAudioFormat.encoding != C.ENCODING_PCM_16BIT ||
            (inputAudioFormat.channelCount != 1 && inputAudioFormat.channelCount != 2) ||
            inputAudioFormat.sampleRate <= 0
        ) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }

        sampleRate = inputAudioFormat.sampleRate
        inputChannelCount = inputAudioFormat.channelCount
        mixStep = 1f / max(1f, 0.025f * sampleRate.toFloat())

        if (configuredSampleRate != sampleRate || combsL.isEmpty()) {
            allocateDspBuffers(sampleRate)
            configuredSampleRate = sampleRate
        } else {
            zeroDspBuffers()
        }

        return AudioProcessor.AudioFormat(sampleRate, 2, C.ENCODING_PCM_16BIT)
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining <= 0) return

        if (pendingClear) {
            pendingClear = false
            zeroDspBuffers()
            eightDMix = 0f
            srMix = 0f
            lfoPhase = 0.0
        }

        val targetEightD = eightDEnabled
        val targetSr = srEnabled

        // Fast bit-transparent passthrough when DSP is disabled and envelopes have settled
        if (!targetEightD && !targetSr && eightDMix <= 0f && srMix <= 0f && inputChannelCount == 2) {
            val outBuffer = replaceOutputBuffer(remaining)
            if (inputBuffer.order() == outBuffer.order()) {
                outBuffer.put(inputBuffer)
            } else {
                val samples = remaining / 2
                for (i in 0 until samples) {
                    outBuffer.putShort(inputBuffer.getShort())
                }
            }
            outBuffer.flip()
            return
        }

        val bytesPerInputFrame = inputChannelCount * 2
        val frameCount = remaining / bytesPerInputFrame
        if (frameCount <= 0) return

        val outBuffer = replaceOutputBuffer(frameCount * 4)
        val lfoIncrement = (2.0 * PI) / (EIGHT_D_ORBIT_PERIOD_SEC.toDouble() * sampleRate.toDouble())
        val combNorm = 0.25f

        for (i in 0 until frameCount) {
            val rawInL = inputBuffer.getShort()
            val rawInR = if (inputChannelCount == 2) inputBuffer.getShort() else rawInL

            val dryL = rawInL.toFloat() * PCM16_INV_SCALE
            val dryR = rawInR.toFloat() * PCM16_INV_SCALE

            // Update click-free envelopes
            val prevSrMix = srMix
            eightDMix = if (targetEightD) {
                min(1f, eightDMix + mixStep)
            } else {
                max(0f, eightDMix - mixStep)
            }
            srMix = if (targetSr) {
                min(1f, srMix + mixStep)
            } else {
                max(0f, srMix - mixStep)
            }

            // Clear stale reverb tank once SR finishes fading out
            if (!targetSr && prevSrMix > 0f && srMix <= 0f) {
                zeroReverbBuffers()
            }

            var stageL = dryL
            var stageR = dryR

            // Stage 1: Real-time 8D Spatial Auto-Panning
            if (targetEightD || eightDMix > 0f) {
                delayBufferL[delayWriteIdx] = dryL
                delayBufferR[delayWriteIdx] = dryR

                val pan = sin(lfoPhase).toFloat()
                val orbitDepth = 0.92f + 0.08f * cos(lfoPhase).toFloat()
                lfoPhase += lfoIncrement
                if (lfoPhase >= 2.0 * PI) {
                    lfoPhase -= 2.0 * PI
                }

                // Equal-power panning curve with slight center cross-blend to keep stereo instruments present
                val angle = (pan * 0.82f + 1.0f) * (PI.toFloat() * 0.25f)
                val leftGain = cos(angle) * 1.16f * orbitDepth
                val rightGain = sin(angle) * 1.16f * orbitDepth

                // Interaural time difference micro-delay (~0.55 ms max opposite-ear delay)
                val itdL = maxItdSamples * max(0f, pan)
                val itdR = maxItdSamples * max(0f, -pan)

                val delayedL = readFractionalDelay(delayBufferL, delayWriteIdx, itdL)
                val delayedR = readFractionalDelay(delayBufferR, delayWriteIdx, itdR)

                val focusedL = delayedL * 0.72f + delayedR * 0.28f
                val focusedR = delayedR * 0.72f + delayedL * 0.28f

                // Subtle room reflection across ears for spatial depth
                val reflectL = readIntDelay(delayBufferR, delayWriteIdx, earlyDelaySamplesR) * 0.12f
                val reflectR = readIntDelay(delayBufferL, delayWriteIdx, earlyDelaySamplesL) * 0.12f

                // Binaural acoustic head-shadow 1-pole LPF on the opposite ear from the virtual source
                val alphaL = if (pan > 0f) {
                    1f - pan.coerceIn(0f, 1f) * (1f - headShadowMinAlpha)
                } else {
                    1f
                }
                val alphaR = if (pan < 0f) {
                    1f - (-pan).coerceIn(0f, 1f) * (1f - headShadowMinAlpha)
                } else {
                    1f
                }

                val rawPannedL = focusedL * leftGain
                val rawPannedR = focusedR * rightGain
                lpfLeft += alphaL * (rawPannedL - lpfLeft)
                lpfRight += alphaR * (rawPannedR - lpfRight)

                val spatialL = lpfLeft + reflectL
                val spatialR = lpfRight + reflectR

                stageL = dryL * (1f - eightDMix) + spatialL * eightDMix
                stageR = dryR * (1f - eightDMix) + spatialR * eightDMix

                delayWriteIdx = (delayWriteIdx + 1) % delayCapacity
            } else {
                lpfLeft = 0f
                lpfRight = 0f
            }

            // Stage 2: Lush Stereo Schroeder/Freeverb Reverb
            var finalL = stageL
            var finalR = stageR

            if (targetSr || srMix > 0f) {
                val preInL = preDelayL[preDelayIdx]
                val preInR = preDelayR[preDelayIdx]
                preDelayL[preDelayIdx] = stageL
                preDelayR[preDelayIdx] = stageR
                preDelayIdx = (preDelayIdx + 1) % preDelayLen

                val tankInL = (preInL * 0.85f + preInR * 0.15f) * combNorm
                val tankInR = (preInR * 0.85f + preInL * 0.15f) * combNorm

                var combSumL = 0f
                for (c in combsL.indices) {
                    combSumL += combsL[c].process(tankInL, REVERB_FEEDBACK, REVERB_DAMP)
                }

                var combSumR = 0f
                for (c in combsR.indices) {
                    combSumR += combsR[c].process(tankInR, REVERB_FEEDBACK, REVERB_DAMP)
                }

                var apL = combSumL
                for (a in allpassesL.indices) {
                    apL = allpassesL[a].process(apL, ALLPASS_FEEDBACK)
                }

                var apR = combSumR
                for (a in allpassesR.indices) {
                    apR = allpassesR[a].process(apR, ALLPASS_FEEDBACK)
                }

                // Warm high-frequency damping on the wet tail
                wetLpL += wetLpCoeff * (apL - wetLpL)
                wetLpR += wetLpCoeff * (apR - wetLpR)

                val wetMixL = stageL * REVERB_DRY_GAIN + wetLpL * REVERB_WET_GAIN
                val wetMixR = stageR * REVERB_DRY_GAIN + wetLpR * REVERB_WET_GAIN

                finalL = stageL * (1f - srMix) + wetMixL * srMix
                finalR = stageR * (1f - srMix) + wetMixR * srMix
            }

            outBuffer.putShort(floatToPcm16(finalL))
            outBuffer.putShort(floatToPcm16(finalR))
        }

        outBuffer.flip()
    }

    override fun onFlush() {
        zeroDspBuffers()
    }

    override fun onReset() {
        zeroDspBuffers()
        eightDMix = 0f
        srMix = 0f
        lfoPhase = 0.0
        configuredSampleRate = 0
    }

    private fun allocateDspBuffers(rate: Int) {
        val ratio = rate.toDouble() / 44100.0
        maxItdSamples = max(1f, rate * 0.00055f)
        earlyDelaySamplesL = max(8, (rate * 0.011f).roundToInt())
        earlyDelaySamplesR = max(12, (rate * 0.017f).roundToInt())

        delayCapacity = max(64, max(earlyDelaySamplesR, (maxItdSamples.toInt() + 4)) + 8)
        delayBufferL = FloatArray(delayCapacity)
        delayBufferR = FloatArray(delayCapacity)
        delayWriteIdx = 0

        preDelayLen = max(1, (rate * 0.018f).roundToInt())
        preDelayL = FloatArray(preDelayLen)
        preDelayR = FloatArray(preDelayLen)
        preDelayIdx = 0

        combsL = Array(COMB_BASE_TUNINGS.size) { idx ->
            CombFilter(max(8, (COMB_BASE_TUNINGS[idx] * ratio).roundToInt()))
        }
        combsR = Array(COMB_BASE_TUNINGS.size) { idx ->
            CombFilter(max(8, ((COMB_BASE_TUNINGS[idx] + STEREO_SPREAD) * ratio).roundToInt()))
        }

        allpassesL = Array(ALLPASS_BASE_TUNINGS.size) { idx ->
            AllpassFilter(max(8, (ALLPASS_BASE_TUNINGS[idx] * ratio).roundToInt()))
        }
        allpassesR = Array(ALLPASS_BASE_TUNINGS.size) { idx ->
            AllpassFilter(max(8, ((ALLPASS_BASE_TUNINGS[idx] + STEREO_SPREAD) * ratio).roundToInt()))
        }

        // One-pole cutoff around ~4.2 kHz for warm reverb damping
        val rc = 1.0 / (2.0 * PI * 4200.0)
        val dt = 1.0 / rate.toDouble()
        wetLpCoeff = (dt / (rc + dt)).toFloat().coerceIn(0.05f, 0.95f)
        wetLpL = 0f
        wetLpR = 0f

        // Binaural head-shadow LPF cutoff (~2.8 kHz) at extreme opposite pan
        val shadowRc = 1.0 / (2.0 * PI * HEAD_SHADOW_CUTOFF_HZ)
        headShadowMinAlpha = (dt / (shadowRc + dt)).toFloat().coerceIn(0.08f, 0.85f)
        lpfLeft = 0f
        lpfRight = 0f
    }

    private fun zeroDspBuffers() {
        delayBufferL.fill(0f)
        delayBufferR.fill(0f)
        delayWriteIdx = 0
        lpfLeft = 0f
        lpfRight = 0f
        zeroReverbBuffers()
    }

    private fun zeroReverbBuffers() {
        preDelayL.fill(0f)
        preDelayR.fill(0f)
        preDelayIdx = 0
        for (c in combsL) c.clear()
        for (c in combsR) c.clear()
        for (a in allpassesL) a.clear()
        for (a in allpassesR) a.clear()
        wetLpL = 0f
        wetLpR = 0f
    }

    private fun readFractionalDelay(buffer: FloatArray, writeIdx: Int, delaySamples: Float): Float {
        if (delaySamples <= 0.001f) {
            return buffer[writeIdx]
        }
        val cap = buffer.size
        val intPart = delaySamples.toInt()
        val frac = delaySamples - intPart
        val idx0 = ((writeIdx - intPart) % cap + cap) % cap
        val idx1 = ((idx0 - 1) % cap + cap) % cap
        val s0 = buffer[idx0]
        val s1 = buffer[idx1]
        return s0 + (s1 - s0) * frac
    }

    private fun readIntDelay(buffer: FloatArray, writeIdx: Int, delaySamples: Int): Float {
        val cap = buffer.size
        val idx = ((writeIdx - delaySamples) % cap + cap) % cap
        return buffer[idx]
    }

    private fun floatToPcm16(sample: Float): Short {
        val shaped = if (sample > 0.92f || sample < -0.92f) {
            tanh(sample.toDouble()).toFloat()
        } else {
            sample
        }
        return (shaped * 32767f).roundToInt().coerceIn(-32768, 32767).toShort()
    }

    private class CombFilter(size: Int) {
        private val buffer = FloatArray(size)
        private var index = 0
        private var filterStore = 0f

        fun process(input: Float, feedback: Float, damp: Float): Float {
            val output = buffer[index]
            filterStore = output * (1f - damp) + filterStore * damp
            buffer[index] = input + filterStore * feedback
            index = (index + 1) % buffer.size
            return output
        }

        fun clear() {
            buffer.fill(0f)
            index = 0
            filterStore = 0f
        }
    }

    private class AllpassFilter(size: Int) {
        private val buffer = FloatArray(size)
        private var index = 0

        fun process(input: Float, feedback: Float): Float {
            val delayed = buffer[index]
            val tank = input + delayed * feedback
            buffer[index] = tank
            index = (index + 1) % buffer.size
            return delayed - tank * feedback
        }

        fun clear() {
            buffer.fill(0f)
            index = 0
        }
    }

    companion object {
        // Original period was 1/0.13 ~= 7.6923s; reduced by 0.85s -> ~6.8423s orbit cycle
        private const val EIGHT_D_ORBIT_PERIOD_SEC = 6.8423077f
        private const val HEAD_SHADOW_CUTOFF_HZ = 2800.0
        private const val PCM16_INV_SCALE = 1f / 32768f

        // 4 parallel Freeverb comb tunings + 2 allpass tunings (in 44.1 kHz samples)
        private val COMB_BASE_TUNINGS = intArrayOf(1116, 1188, 1277, 1356)
        private val ALLPASS_BASE_TUNINGS = intArrayOf(556, 441)
        private const val STEREO_SPREAD = 23

        private const val REVERB_FEEDBACK = 0.84f
        private const val REVERB_DAMP = 0.32f
        private const val ALLPASS_FEEDBACK = 0.5f
        private const val REVERB_DRY_GAIN = 0.80f
        private const val REVERB_WET_GAIN = 0.35f
    }
}
