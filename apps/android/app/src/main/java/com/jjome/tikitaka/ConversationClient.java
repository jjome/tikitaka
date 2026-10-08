package com.jjome.tikitaka;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONException;
import org.json.JSONObject;

/** All conversation state lives on the main looper; stale asynchronous work is ignored. */
final class ConversationClient implements NativeAudio.Listener {
    interface View {
        void state(boolean active, String status);
        void caption(String speaker, String text);
        void level(float value);
        void error(String message);
    }
    interface Result { void success(byte[] data); }
    interface AudioFactory { VoiceIO create(Context context, NativeAudio.Listener listener); }
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private final OkHttpClient http = new OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final VoiceIO audio;
    private final View view;
    private final String base, language;
    private boolean active, starting, speaking, transcribing;
    private int epoch, playback;
    private String sessionId, token;
    private WebSocket socket;
    private Call speechCall;
    private final ArrayDeque<byte[]> pendingAudio = new ArrayDeque<>();
    private final StringBuilder pendingText = new StringBuilder();
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (!active) return;
            send(message(speaking ? "speech_activity" : "heartbeat"));
            main.postDelayed(this, 500);
        }
    };
    private final Runnable startupTimeout = () -> { if (starting) fail("연결이 늦습니다. 대화를 다시 시작해주세요."); };

    ConversationClient(Context context, View view, String base, String language) {
        this(context, view, base, language, NativeAudio::new);
    }
    ConversationClient(Context context, View view, String base, String language, AudioFactory audioFactory) {
        this.view = view; this.base = base; this.language = language;
        audio = audioFactory.create(context, this);
    }
    boolean isActive() { return active; }
    void start() {
        if (active) return;
        active = true; starting = true; int current = ++epoch;
        view.error(""); view.state(true, "대화를 준비하고 있어요…");
        main.postDelayed(startupTimeout, 30000);
        request("/api/config", null, null, data -> {
            JSONObject config = object(data);
            if (!"api".equals(config.optString("voice_transport"))) { fail("음성 API 서버 연결이 필요합니다."); return; }
            request("/api/sessions", messageBody("language", language, "topic_id", "auto").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8), JSON, created -> {
                JSONObject session = object(created);
                sessionId = session.optString("id"); token = session.optString("token");
                if (sessionId.isEmpty() || token.isEmpty()) { fail("대화를 준비하지 못했습니다."); return; }
                connect(current);
            });
        });
    }
    private void connect(int current) {
        socket = http.newWebSocket(new Request.Builder().url(base + "/api/sessions/" + sessionId + "/events").build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                main.post(() -> { if (active && current == epoch) ws.send(messageBody("type", "authenticate", "token", token).toString()); else ws.close(1000, null); });
            }
            @Override public void onMessage(WebSocket ws, String text) {
                main.post(() -> { if (active && current == epoch) receive(text); });
            }
            @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                main.post(() -> { if (active && current == epoch) fail("연결이 끊겼습니다. 대화를 다시 시작해주세요."); });
            }
            @Override public void onClosed(WebSocket ws, int code, String reason) {
                main.post(() -> { if (active && current == epoch) fail("연결이 끝났습니다. 대화를 다시 시작해주세요."); });
            }
            @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(code, null); }
        });
    }
    private void receive(String text) {
        try {
            JSONObject event = new JSONObject(text);
            switch (event.optString("type")) {
                case "snapshot":
                    if (!starting) break;
                    audio.start(); starting = false; main.removeCallbacks(startupTimeout);
                    send(message("resume")); main.post(heartbeat); break;
                case "state":
                    String state = event.optString("state");
                    if (state.equals("ended") || state.equals("paused") && !starting) {
                        stop(); break;
                    }
                    view.state(true, switch (state) {
                        case "speaking" -> "편하게 듣다가, 언제든 말하세요";
                        case "listening" -> "당신의 이야기를 듣고 있어요";
                        case "pacing" -> "언제든 끼어들어도 좋아요";
                        default -> "친구가 생각하고 있어요";
                    }); break;
                case "interrupt": cancelSpeech(); break;
                case "error": fail(event.optString("message", "대화 연결을 확인해주세요.")); break;
                case "message":
                    JSONObject msg = event.getJSONObject("message");
                    String speaker = msg.getString("speaker");
                    if (speaker.equals("user")) { view.caption(speaker, msg.getString("text")); break; }
                    if (speaking || !msg.optString("delivery").equals("pending")) break;
                    view.caption(speaker, msg.getString("text")); play(msg); break;
                default: break;
            }
        } catch (JSONException error) { fail("서버 응답을 확인하지 못했습니다."); }
        catch (RuntimeException error) { fail("마이크와 소리를 시작하지 못했습니다. 권한과 연결을 확인해주세요."); }
    }
    private void play(JSONObject msg) {
        cancelSpeech(); int version = playback;
        String id = msg.optString("id"); long revision = msg.optLong("revision");
        speechCall = request("/api/sessions/" + sessionId + "/speech/" + id, new byte[0], null, bytes -> {
            if (version != playback || speaking) return;
            audio.play(bytes, () -> {
                if (active && version == playback) send(messageBody("type", "playback_finished", "message_id", id, "revision", revision));
            }, () -> { if (version == playback) fail("AI 음성을 재생하지 못했습니다. 다시 시작해주세요."); });
        }, () -> version == playback);
    }
    private void cancelSpeech() {
        playback++; if (speechCall != null) { speechCall.cancel(); speechCall = null; } audio.cancelPlayback();
    }
    @Override public void onSpeechStart() {
        if (!active) return;
        cancelSpeech(); speaking = true; send(message("speech_started")); view.state(true, "듣고 있어요");
    }
    @Override public void onTurn(byte[] wav) {
        if (!active) return;
        if (pendingAudio.size() >= 2) { fail("음성 처리가 늦습니다. 잠시 후 다시 시작해주세요."); return; }
        pendingAudio.add(wav); transcribe();
    }
    private void transcribe() {
        if (!active || transcribing || pendingAudio.isEmpty()) return;
        transcribing = true; view.state(true, "말을 인식하고 있어요");
        request("/api/sessions/" + sessionId + "/transcriptions", pendingAudio.remove(), MediaType.get("audio/wav"), data -> {
            String text = object(data).optString("text").trim();
            if (!text.isEmpty()) { if (pendingText.length() > 0) pendingText.append(' '); pendingText.append(text); }
            if (pendingText.length() > 1000) { fail("조금 더 짧게 나누어 말씀해주세요."); return; }
            transcribing = false;
            if (!pendingAudio.isEmpty()) transcribe();
            else if (!audio.isRecordingTurn()) {
                speaking = false;
                if (pendingText.length() > 0) {
                    String finished = pendingText.toString(); pendingText.setLength(0);
                    view.caption("user", finished);
                    send(messageBody("type", "user_message", "text", finished, "client_message_id", UUID.randomUUID().toString()));
                } else send(message("speech_cancelled"));
            }
        });
    }
    @Override public void onLevel(float value) { view.level(value); }
    @Override public void onError(String message) { if (active) fail(message); }
    private void fail(String message) { view.error(message); stop(); }
    void stop() {
        active = false; starting = false; speaking = false; epoch++; send(message("end"));
        main.removeCallbacks(heartbeat); main.removeCallbacks(startupTimeout);
        cancelSpeech(); audio.stop(); http.dispatcher().cancelAll();
        if (socket != null) { socket.close(1000, null); socket = null; }
        pendingAudio.clear(); pendingText.setLength(0); transcribing = false; sessionId = token = null;
        view.state(false, "버튼 한 번으로, 바로 대화해요.");
    }
    void dispose() { stop(); http.connectionPool().evictAll(); http.dispatcher().executorService().shutdown(); }
    private void send(JSONObject command) {
        if (socket != null && !socket.send(command.toString()) && active) fail("연결이 끊겼습니다. 다시 시작해주세요.");
    }
    private Call request(String path, byte[] body, MediaType type, Result result) { return request(path, body, type, result, () -> true); }
    private Call request(String path, byte[] body, MediaType type, Result result, java.util.function.BooleanSupplier relevant) {
        int current = epoch;
        Request.Builder builder = new Request.Builder().url(base + path);
        if (token != null) builder.header("X-Session-Token", token);
        if (body != null) builder.post(RequestBody.create(body, type));
        Call call = http.newCall(builder.build());
        call.enqueue(new Callback() {
            public void onFailure(Call c, IOException error) {
                main.post(() -> { if (active && current == epoch && relevant.getAsBoolean() && !c.isCanceled()) fail("서버에 연결하지 못했습니다. 인터넷 연결을 확인해주세요."); });
            }
            public void onResponse(Call c, Response response) {
                try (response) {
                    if (!response.isSuccessful() || response.body() == null) throw new IOException();
                    // TTS is bounded server-side; keep a client bound for malformed servers too.
                    java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                    try (java.io.InputStream input = response.body().byteStream()) {
                        byte[] chunk = new byte[8192]; int read;
                        while ((read = input.read(chunk)) != -1) {
                            if (output.size() + read > 3_000_000) throw new IOException();
                            output.write(chunk, 0, read);
                        }
                    }
                    final byte[] received = output.toByteArray();
                    main.post(() -> {
                        if (active && current == epoch && relevant.getAsBoolean()) {
                            try { result.success(received); } catch (RuntimeException error) { fail("서버 응답을 확인하지 못했습니다."); }
                        }
                    });
                } catch (IOException error) { onFailure(c, error); }
            }
        });
        return call;
    }
    private static JSONObject object(byte[] data) {
        try { return new JSONObject(new String(data, java.nio.charset.StandardCharsets.UTF_8)); }
        catch (JSONException error) { throw new IllegalArgumentException("invalid JSON"); }
    }
    private static JSONObject message(String type) { return messageBody("type", type); }
    private static JSONObject messageBody(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) result.put((String)pairs[i], pairs[i + 1]); }
        catch (JSONException error) { throw new IllegalArgumentException("invalid command"); }
        return result;
    }
}
