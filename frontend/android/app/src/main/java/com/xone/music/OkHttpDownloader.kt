package com.xone.music

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.internal.http.HttpMethod
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.Localization
import java.io.IOException
import java.util.concurrent.TimeUnit

class OkHttpDownloader private constructor() : Downloader() {

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    @Throws(IOException::class, ReCaptchaException::class)
    override fun execute(request: Request): Response {
        val httpMethod = request.httpMethod()
        val url = request.url()
        val headers = request.headers()
        val dataToSend = request.dataToSend()

        val requestBody: RequestBody? = when {
            dataToSend != null ->
                dataToSend.toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
            HttpMethod.requiresRequestBody(httpMethod) ->
                ByteArray(0).toRequestBody(null)
            else -> null
        }

        val builder = okhttp3.Request.Builder()
            .url(url)
            .method(httpMethod, requestBody)

        var hasUserAgent = false
        for ((headerName, values) in headers) {
            if (headerName.equals("User-Agent", ignoreCase = true)) {
                hasUserAgent = true
            }
            if (values.size > 1) {
                builder.removeHeader(headerName)
                for (value in values) {
                    builder.addHeader(headerName, value)
                }
            } else if (values.size == 1) {
                builder.header(headerName, values[0])
            }
        }

        if (!hasUserAgent) {
            builder.header("User-Agent", USER_AGENT)
        }

        client.newCall(builder.build()).execute().use { res ->
            if (res.code == 429) {
                throw ReCaptchaException("reCaptcha Challenge requested", url)
            }
            val bodyString = res.body?.string() ?: ""
            val latestUrl = res.request.url.toString()
            return Response(
                res.code,
                res.message,
                res.headers.toMultimap(),
                bodyString,
                latestUrl
            )
        }
    }

    companion object {
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

        @Volatile
        private var instance: OkHttpDownloader? = null

        @Volatile
        private var initialized = false

        fun getInstance(): OkHttpDownloader {
            return instance ?: synchronized(this) {
                instance ?: OkHttpDownloader().also { instance = it }
            }
        }

        fun ensureInitialized() {
            if (initialized) return
            synchronized(this) {
                if (!initialized) {
                    NewPipe.init(getInstance(), Localization("en", "US"))
                    initialized = true
                }
            }
        }
    }
}
