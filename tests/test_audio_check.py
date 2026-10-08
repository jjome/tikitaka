import contextlib
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

from backend.app.audio import validate_wav
from scripts.check_audio import main, normalize_wav, matches_test_sentence


def streaming_wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        writer.writeframes(bytes(48000))
    raw = bytearray(output.getvalue())
    struct.pack_into('<I', raw, 4, 0xffffffff)
    struct.pack_into('<I', raw, 40, 0xffffffff)
    return bytes(raw)


class AudioCheckTests(unittest.IsolatedAsyncioTestCase):
    def test_connection_check_allows_name_spelling_variation_but_not_unrelated_text(self):
        self.assertTrue(matches_test_sentence('분호, 나는 겨울이 더 좋아. 여름은 너무 더워.'))
        self.assertFalse(matches_test_sentence(''))
        self.assertFalse(matches_test_sentence('안녕하세요.'))

    def test_streaming_length_sentinels_are_replaced_without_overflow(self):
        normalized = normalize_wav(streaming_wav())
        validate_wav(normalized)
        self.assertEqual(struct.unpack_from('<I', normalized, 4)[0], len(normalized) - 8)
        with wave.open(io.BytesIO(normalized), 'rb') as reader:
            self.assertEqual(reader.getnframes(), 24000)
            self.assertEqual(reader.readframes(24000), bytes(48000))

    async def run_check(self, broken=False):
        class Provider:
            closed = False
            calls = 0
            async def speak(self, *args, **kwargs):
                self.calls += 1
                if broken: raise RuntimeError('do-not-log-this-secret')
                return streaming_wav()
            async def transcribe(self, data, language):
                self.calls += 1
                validate_wav(data)
                return '분호, 나는 겨울이 더 좋아. 여름은 너무 더워.'
            async def close(self): self.closed = True
        provider = Provider()
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only-secret'}), \
                patch('scripts.check_audio.OpenAIAudio', return_value=provider), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            result = await main(directory)
            contents = (Path(directory) / 'audio-check.json').read_text(encoding='utf-8')
            self.assertNotIn('test-only-secret', contents + output.getvalue())
            self.assertNotIn('do-not-log-this-secret', contents + output.getvalue())
            self.assertTrue(provider.closed)
            return result, json.loads(contents), provider.calls

    async def test_streaming_speech_reaches_transcription_and_passes(self):
        result, report, calls = await self.run_check()
        self.assertEqual(result, 0)
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(calls, 2)

    async def test_failure_identifies_stage_without_exception_contents(self):
        result, report, calls = await self.run_check(broken=True)
        self.assertEqual(result, 1)
        self.assertEqual(report['stage'], 'speech')
        self.assertEqual(report['error_type'], 'RuntimeError')
        self.assertEqual(calls, 1)

    async def test_missing_key_never_calls_provider(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}), \
                patch('scripts.check_audio.OpenAIAudio') as factory, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(await main(), 1)
            factory.assert_not_called()
