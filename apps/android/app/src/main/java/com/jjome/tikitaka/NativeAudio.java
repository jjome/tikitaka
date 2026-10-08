package com.jjome.tikitaka;

import android.content.Context;
import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;

/** Foreground-only native capture and cancellable playback. UI callbacks use the main looper. */
final class NativeAudio implements VoiceIO {
    interface Listener {
        void onSpeechStart(); void onTurn(byte[] wav); void onLevel(float level); void onError(String message);
    }
    private final Context context;
    private final Listener listener;
    private final AudioManager manager;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private volatile boolean running;
    private int generation, playbackGeneration, previousMode;
    private AudioRecord recorder;
    private PcmTurns turns;
    private MediaPlayer player;
    private File playbackFile;
    private AudioFocusRequest focus;
    private boolean registered;
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            for (AudioDeviceInfo device : removed) {
                int type = device.getType();
                if (running && (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                        type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                        type == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                    listener.onError("이어폰 연결이 바뀌었습니다. 대화를 다시 시작해주세요."); return;
                }
            }
        }
    };

    NativeAudio(Context context, Listener listener) {
        this.context = context; this.listener = listener;
        manager = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
    }
    public boolean isRecordingTurn() { return turns != null && turns.isRecording(); }

    public void start() {
        if (running) return;
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("마이크 권한이 필요합니다.");
        final int epoch = ++generation;
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> {
                if (running && change != AudioManager.AUDIOFOCUS_GAIN)
                    listener.onError("다른 앱이 소리를 사용하고 있어 대화를 멈췄어요.");
            }, main).build();
        if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focus = null; throw new IllegalStateException("마이크와 소리를 사용할 수 없습니다. 잠시 후 다시 시작해주세요.");
        }
        previousMode = manager.getMode(); manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        try {
            int minimum = AudioRecord.getMinBufferSize(24000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException("이 기기의 마이크 형식을 사용할 수 없습니다.");
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 24000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 4800));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("마이크를 시작하지 못했습니다.");
            AudioRecord capture = recorder;
            PcmTurns segmentation = new PcmTurns(24000, new PcmTurns.Listener() {
                public void onStart() { post(epoch, () -> { cancelPlayback(); listener.onSpeechStart(); }); }
                public void onTurn(byte[] wav) { post(epoch, () -> listener.onTurn(wav)); }
            });
            turns = segmentation; running = true;
            manager.registerAudioDeviceCallback(devices, main); registered = true;
            capture.startRecording();
            if (capture.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("마이크가 다른 앱에서 사용 중입니다.");
            new Thread(() -> captureLoop(capture, segmentation, epoch), "tikitaka-microphone").start();
        } catch (RuntimeException error) {
            // start failed before the capture thread could own/release the recorder.
            AudioRecord failed = recorder; stop(); if (failed != null) failed.release();
            throw error;
        }
    }

    private void post(int epoch, Runnable action) {
        main.post(() -> { if (running && epoch == generation) action.run(); });
    }
    private void captureLoop(AudioRecord capture, PcmTurns segmentation, int epoch) {
        AcousticEchoCanceler echo = null; NoiseSuppressor noise = null;
        try {
            if (AcousticEchoCanceler.isAvailable()) { echo = AcousticEchoCanceler.create(capture.getAudioSessionId()); if (echo != null) echo.setEnabled(true); }
            if (NoiseSuppressor.isAvailable()) { noise = NoiseSuppressor.create(capture.getAudioSessionId()); if (noise != null) noise.setEnabled(true); }
            short[] samples = new short[480]; int ticks = 0;
            while (running && epoch == generation) {
                int count = capture.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
                if (count < 0) throw new IllegalStateException("마이크 입력이 끊겼습니다. 다시 시작해주세요.");
                float level = Math.min(1, segmentation.push(samples, count) / .03f);
                if (++ticks % 5 == 0) post(epoch, () -> listener.onLevel(level));
            }
        } catch (RuntimeException error) {
            post(epoch, () -> listener.onError("마이크 입력을 사용할 수 없습니다. 권한과 연결을 확인해주세요."));
        } finally {
            if (echo != null) echo.release(); if (noise != null) noise.release();
            capture.release();
        }
    }

    public void play(byte[] bytes, Runnable finished, Runnable failed) {
        cancelPlayback();
        int epoch = playbackGeneration;
        try {
            playbackFile = File.createTempFile("ai-speech-", ".mp3", context.getCacheDir());
            try (FileOutputStream output = new FileOutputStream(playbackFile)) { output.write(bytes); }
            MediaPlayer media = new MediaPlayer(); player = media;
            media.setAudioAttributes(attributes); media.setDataSource(playbackFile.getAbsolutePath());
            media.setOnPreparedListener(p -> { if (running && epoch == playbackGeneration) p.start(); });
            media.setOnCompletionListener(p -> {
                if (epoch != playbackGeneration) return;
                cancelPlayback(); finished.run();
            });
            media.setOnErrorListener((p, what, extra) -> {
                if (epoch == playbackGeneration) { cancelPlayback(); failed.run(); } return true;
            });
            media.prepareAsync();
        } catch (Exception error) { cancelPlayback(); failed.run(); }
    }
    public void cancelPlayback() {
        playbackGeneration++;
        if (player != null) { player.setOnCompletionListener(null); player.setOnPreparedListener(null); player.setOnErrorListener(null); player.release(); player = null; }
        if (playbackFile != null) { playbackFile.delete(); playbackFile = null; }
    }
    public void stop() {
        generation++; running = false; cancelPlayback();
        if (recorder != null) { try { recorder.stop(); } catch (IllegalStateException ignored) {} recorder = null; }
        turns = null;
        if (registered) { manager.unregisterAudioDeviceCallback(devices); registered = false; }
        if (focus != null) { manager.abandonAudioFocusRequest(focus); focus = null; manager.setMode(previousMode); }
        listener.onLevel(0);
    }
}
