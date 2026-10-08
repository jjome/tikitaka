package com.jjome.tikitaka;

interface VoiceIO {
    void start();
    boolean isRecordingTurn();
    void play(byte[] bytes, Runnable finished, Runnable failed);
    void cancelPlayback();
    void stop();
}
