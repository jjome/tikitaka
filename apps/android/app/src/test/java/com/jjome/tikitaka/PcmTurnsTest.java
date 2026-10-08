package com.jjome.tikitaka;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;

public class PcmTurnsTest {
    private int starts;
    private final ArrayList<byte[]> clips = new ArrayList<>();
    private final PcmTurns turns = new PcmTurns(24000, new PcmTurns.Listener() {
        public void onStart() { starts++; }
        public void onTurn(byte[] wav) { clips.add(wav); }
    });
    private void feed(int blocks, short level) {
        short[] samples = new short[480]; Arrays.fill(samples, level);
        for (int i = 0; i < blocks; i++) turns.push(samples, samples.length);
    }
    @Test public void oneUtteranceIncludesBeginningAndEndsOnlyOnce() {
        feed(30, (short)0); feed(20, (short)900);
        assertEquals(1, starts); assertTrue(turns.isRecording()); assertEquals(0, clips.size());
        feed(70, (short)0);
        assertEquals(1, clips.size()); assertFalse(turns.isRecording());
        ByteBuffer b = ByteBuffer.wrap(clips.get(0)).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(clips.get(0).length - 8, b.getInt(4));
        assertEquals(24000, b.getInt(24));
        int nonzero = 0;
        for (int i = 44; i < b.capacity(); i += 2) if (b.getShort(i) != 0) nonzero++;
        assertEquals(20 * 480, nonzero);
    }
    @Test public void noiseSpikeAndIdleSilenceDoNotProduceUtterances() {
        feed(30, (short)0); feed(2, (short)1000); feed(70, (short)0);
        assertEquals(0, starts); assertEquals(0, clips.size());
    }
    @Test public void continuousSpeechIsBounded() {
        feed(2200, (short)1000);
        assertEquals(2, clips.size());
        for (byte[] clip : clips) assertTrue(clip.length <= 44 + 24000 * 2 * 20);
    }
    @Test public void resetDiscardsIncompleteRecording() {
        feed(20, (short)1000); turns.reset(); feed(70, (short)0);
        assertEquals(0, clips.size()); assertFalse(turns.isRecording());
    }
}
