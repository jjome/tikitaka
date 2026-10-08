package com.jjome.tikitaka;

import android.os.Looper;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public class ConversationClientTest {
    private MockWebServer server;
    private ConversationClient client;
    private FakeVoice voice;
    private FakeView view;
    private volatile WebSocket peer;
    private boolean delaySpeech;
    private final List<String> commands = new CopyOnWriteArrayList<>();
    private final List<RecordedRequest> requests = new CopyOnWriteArrayList<>();
    static final class FakeVoice implements VoiceIO {
        boolean started, stopped; int plays, cancellations; Runnable completion;
        public void start() { started = true; }
        public boolean isRecordingTurn() { return false; }
        public void play(byte[] bytes, Runnable finished, Runnable failed) { plays++; completion = finished; }
        public void cancelPlayback() { cancellations++; }
        public void stop() { stopped = true; }
    }
    static final class FakeView implements ConversationClient.View {
        String error = "", speaker = "", caption = ""; boolean active;
        public void state(boolean active, String status) { this.active = active; }
        public void caption(String speaker, String text) { this.speaker = speaker; caption = text; }
        public void level(float value) {}
        public void error(String message) { error = message; }
    }
    @Before public void setup() throws Exception {
        server = new MockWebServer(); voice = new FakeVoice(); view = new FakeView();
        server.setDispatcher(new Dispatcher() {
            @Override public MockResponse dispatch(RecordedRequest request) {
                requests.add(request); String path = request.getPath();
                if (path.equals("/api/config")) return json("{\"voice_transport\":\"api\"}");
                if (path.equals("/api/sessions")) return json("{\"id\":\"test-session\",\"token\":\"session-secret\"}");
                if (path.endsWith("/events")) return new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
                    @Override public void onOpen(WebSocket ws, Response response) { peer = ws; }
                    @Override public void onMessage(WebSocket ws, String text) {
                        commands.add(text);
                        if (text.contains("authenticate")) ws.send("{\"type\":\"snapshot\",\"state\":\"paused\"}");
                    }
                });
                if (!"session-secret".equals(request.getHeader("X-Session-Token"))) return new MockResponse().setResponseCode(403);
                if (path.endsWith("/transcriptions")) return json("{\"text\":\"Junho, I prefer winter.\"}");
                if (path.contains("/speech/")) {
                    MockResponse result = new MockResponse().setBody("synthetic-mp3");
                    return delaySpeech ? result.setBodyDelay(500, TimeUnit.MILLISECONDS) : result;
                }
                return new MockResponse().setResponseCode(404);
            }
        });
        server.start();
        client = new ConversationClient(RuntimeEnvironment.getApplication(), view,
            server.url("/").toString().replaceAll("/$", ""), "en", (context, listener) -> voice);
    }
    static MockResponse json(String body) { return new MockResponse().setHeader("Content-Type", "application/json").setBody(body); }
    @After public void cleanup() throws Exception { client.dispose(); server.shutdown(); }
    private void await(BooleanSupplier predicate) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!predicate.getAsBoolean() && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10);
        }
        assertTrue("Timed out; UI error: " + view.error, predicate.getAsBoolean());
    }
    private boolean sent(String type) { return commands.stream().anyMatch(text -> text.contains("\"type\":\"" + type + "\"")); }
    private void start() throws Exception { client.start(); await(() -> sent("resume")); assertTrue(voice.started); }
    private void ai(String id, String speaker, int revision) {
        peer.send("{\"type\":\"message\",\"message\":{\"id\":\"" + id + "\",\"speaker\":\"" + speaker +
            "\",\"text\":\"Hello friend\",\"revision\":" + revision + ",\"delivery\":\"pending\"}}");
    }
    @Test public void oneStartConnectsEnglishAndOneStopReleasesCapture() throws Exception {
        start();
        RecordedRequest create = requests.stream().filter(r -> r.getPath().equals("/api/sessions")).findFirst().get();
        assertEquals("en", new JSONObject(create.getBody().readUtf8()).getString("language"));
        client.stop(); assertFalse(client.isActive()); assertTrue(voice.stopped); assertFalse(view.active);
    }
    @Test public void bargeInCancelsOldCompletionAndSendsRecognizedUtterance() throws Exception {
        start(); ai("a1", "a", 1); await(() -> voice.plays == 1);
        Runnable oldCompletion = voice.completion; int oldCancelCount = voice.cancellations;
        client.onSpeechStart(); oldCompletion.run();
        assertTrue(voice.cancellations > oldCancelCount);
        client.onTurn(PcmTurns.wav(new byte[48000], 24000));
        await(() -> sent("user_message")); assertTrue(sent("speech_started")); assertFalse(sent("playback_finished"));
        assertEquals("Junho, I prefer winter.", view.caption);
        ai("b1", "b", 2); await(() -> voice.plays == 2); voice.completion.run();
        await(() -> sent("playback_finished")); assertEquals("", view.error);
    }
    @Test public void cancelledTtsDownloadCannotStartAfterStop() throws Exception {
        delaySpeech = true; start(); ai("a1", "a", 1);
        await(() -> requests.stream().anyMatch(r -> r.getPath().contains("/speech/")));
        client.stop(); Thread.sleep(600); Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(0, voice.plays); assertFalse(client.isActive());
    }
    @Test public void startCancelledBeforeConfigCannotAcquireMicrophone() throws Exception {
        client.start(); client.stop(); Thread.sleep(100); Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertFalse(voice.started); assertFalse(client.isActive());
    }
    @Test public void closedSocketStopsTheMicrophone() throws Exception {
        start(); peer.close(1000, "test"); await(() -> !client.isActive());
        assertTrue(voice.stopped); assertFalse(view.error.isEmpty());
    }
}
