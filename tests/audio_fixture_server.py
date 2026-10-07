"""Offline browser audio plumbing test: silent output, tone input, scripted transcript.

Run with uvicorn tests.audio_fixture_server:app --port 8102. No OpenAI calls.
The generated input is not speech and does not validate recognition accuracy.
"""
import io
import math
from pathlib import Path
import struct
import wave

from backend.app.gateway import DemoGateway
from backend.app.main import create_app


def waveform(seconds, tone=False):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(48000)
        audio.writeframes(b''.join(struct.pack('<h', int(5000 * math.sin(i * math.tau * 220 / 48000)) if tone else 0)
                                  for i in range(int(seconds * 48000))))
    return output.getvalue()


class FixtureAudio:
    async def transcribe(self, data, language): return '준호, 나는 겨울이 더 좋아. 여름은 너무 더워.'
    async def speak(self, text, speaker, language): return waveform(2)
    async def close(self): pass


root = Path(__file__).resolve().parents[1] / '.runtime'
root.mkdir(exist_ok=True)
(root / 'audio-fixture.wav').write_bytes(waveform(1.2, True))
app = create_app(str(root / 'audio-fixture.sqlite3'), DemoGateway(.05), audio_gateway=FixtureAudio())
