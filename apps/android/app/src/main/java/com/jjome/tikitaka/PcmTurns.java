package com.jjome.tikitaka;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import java.util.Arrays;

/** Pure PCM segmentation; no Android dependencies or microphone recording files. */
public final class PcmTurns {
    public interface Listener { void onStart(); void onTurn(byte[] wav); }
    private final int rate;
    private final Listener listener;
    private final ArrayDeque<short[]> preRoll = new ArrayDeque<>();
    private final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    private int preSamples, onsetSamples, silentSamples, totalSamples;
    private volatile boolean recording;

    public PcmTurns(int rate, Listener listener) { this.rate = rate; this.listener = listener; }
    public boolean isRecording() { return recording; }

    public float push(short[] input, int count) {
        if (count <= 0) return 0;
        short[] samples = Arrays.copyOf(input, count);
        double energy = 0;
        for (short sample : samples) { double f = sample / 32768.0; energy += f * f; }
        float rms = (float) Math.sqrt(energy / count);
        boolean voiced = rms >= .006f;
        if (!recording) {
            preRoll.add(samples); preSamples += count;
            while (preSamples > rate * .3 && preRoll.size() > 1) preSamples -= preRoll.remove().length;
            onsetSamples = voiced ? onsetSamples + count : 0;
            if (onsetSamples < rate * .08) return rms;
            recording = true; totalSamples = 0; silentSamples = 0;
            for (short[] chunk : preRoll) append(chunk);
            preRoll.clear(); preSamples = 0;
            listener.onStart();
        } else append(samples);
        silentSamples = voiced ? 0 : silentSamples + count;
        if (silentSamples >= rate * 1.08 || totalSamples >= rate * 20) {
            byte[] wav = wav(pcm.toByteArray(), rate);
            reset(); listener.onTurn(wav);
        }
        return rms;
    }

    private void append(short[] samples) {
        for (short sample : samples) { pcm.write(sample & 255); pcm.write((sample >>> 8) & 255); }
        totalSamples += samples.length;
    }
    public void reset() {
        recording = false; onsetSamples = silentSamples = totalSamples = preSamples = 0;
        preRoll.clear(); pcm.reset();
    }
    static byte[] wav(byte[] pcm, int rate) {
        ByteBuffer b = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[]{'R','I','F','F'}).putInt(36 + pcm.length).put(new byte[]{'W','A','V','E'});
        b.put(new byte[]{'f','m','t',' '}).putInt(16).putShort((short)1).putShort((short)1);
        b.putInt(rate).putInt(rate * 2).putShort((short)2).putShort((short)16);
        b.put(new byte[]{'d','a','t','a'}).putInt(pcm.length).put(pcm);
        return b.array();
    }
}
