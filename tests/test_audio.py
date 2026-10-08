import asyncio
import io
import json
import unittest
import wave

import httpx
from fastapi.testclient import TestClient

from backend.app.audio import OpenAIAudio, validate_wav
from backend.app.domain import DomainError, Message
from backend.app.gateway import DemoGateway
from backend.app.main import create_app


def wav(seconds=.3):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
        audio.writeframes(b'\x00\x00' * int(16000 * seconds))
    return output.getvalue()


class FakeAudio:
    def __init__(self): self.inputs = []
    async def transcribe(self, data, language): self.inputs.append((data, language)); return '준호, 겨울이 좋아'
    async def speak(self, text, speaker, language): self.inputs.append((text, speaker, language)); return b'fake-mp3'
    async def close(self): pass


class AudioAPITests(unittest.TestCase):
    def setUp(self):
        self.audio = FakeAudio()
        self.client = TestClient(create_app(':memory:', DemoGateway(.001), audio_gateway=self.audio))
        self.client.__enter__()
        self.session = self.client.post('/api/sessions', json={}).json()
        self.engine = self.client.app.state.engines[self.session['id']]
        self.engine.state = 'listening'
        self.url = f'/api/sessions/{self.session["id"]}'
        self.headers = {'X-Session-Token': self.session['token'], 'Content-Type': 'audio/wav'}

    def tearDown(self): self.client.__exit__(None, None, None)

    def test_audio_configuration_and_authorization(self):
        self.assertEqual(self.client.get('/api/config').json()['voice_transport'], 'api')
        self.assertEqual(self.client.post(self.url + '/transcriptions', content=wav()).status_code, 404)
        self.assertEqual(self.audio.inputs, [])

    def test_transcription_is_bounded_and_audio_is_not_persisted(self):
        response = self.client.post(self.url + '/transcriptions', content=wav(), headers=self.headers)
        self.assertEqual(response.json()['text'], '준호, 겨울이 좋아')
        self.assertEqual(self.engine.stats['transcriptions'], 1)
        self.assertNotIn('RIFF', json.dumps(self.engine.snapshot()))
        for content in (b'invalid', wav(22)):
            self.assertGreaterEqual(self.client.post(self.url + '/transcriptions', content=content, headers=self.headers).status_code, 400)
        self.assertEqual(len(self.audio.inputs), 1)
        self.assertEqual(self.client.post(self.url + '/transcriptions', content=b'0' * 2_500_001, headers=self.headers).status_code, 413)

    def test_stopped_or_exhausted_sessions_cannot_buy_more_transcriptions(self):
        self.engine.state = 'ended'
        self.assertEqual(self.client.post(self.url + '/transcriptions', content=wav(), headers=self.headers).status_code, 409)
        self.engine.state = 'listening'; self.engine.stats['transcriptions'] = 60
        self.assertEqual(self.client.post(self.url + '/transcriptions', content=wav(), headers=self.headers).status_code, 429)
        self.assertEqual(self.audio.inputs, [])

    def test_speech_uses_authorized_pending_ai_message_only(self):
        message = Message('b', '반가워요', 1, 1, delivery='pending')
        self.engine.messages.append(message); self.engine.state = 'speaking'
        route = self.url + '/speech/' + message.id
        self.assertEqual(self.client.post(route).status_code, 404)
        response = self.client.post(route, headers=self.headers)
        self.assertEqual(response.content, b'fake-mp3')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(self.audio.inputs, [('반가워요', 'b', 'ko')])
        message.delivery = 'interrupted'
        self.assertEqual(self.client.post(route, headers=self.headers).status_code, 409)
        self.assertEqual(len(self.audio.inputs), 1)


class AudioGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_deleting_active_session_cancels_pending_audio_provider_request(self):
        started, cancelled = asyncio.Event(), asyncio.Event()
        class SlowAudio(FakeAudio):
            async def transcribe(self, data, language):
                started.set()
                try:
                    await asyncio.Future()
                finally:
                    cancelled.set()
        app = create_app(':memory:', DemoGateway(.001), audio_gateway=SlowAudio())
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                session = (await client.post('/api/sessions', json={})).json()
                route = f'/api/sessions/{session["id"]}'
                headers = {'X-Session-Token': session['token'], 'Content-Type': 'audio/wav'}
                app.state.engines[session['id']].state = 'listening'
                pending = asyncio.create_task(client.post(route + '/transcriptions', content=wav(), headers=headers))
                await asyncio.wait_for(started.wait(), 2)
                self.assertEqual((await client.delete(route, headers=headers)).status_code, 204)
                self.assertEqual((await asyncio.wait_for(pending, 2)).status_code, 409)
                self.assertTrue(cancelled.is_set())

    async def test_transcription_multipart_and_speaker_specific_speech(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={'text': '겨울이 좋아'}) if request.url.path.endswith('transcriptions') else httpx.Response(200, content=b'mp3')
        client = httpx.AsyncClient(base_url='https://example.test/', transport=httpx.MockTransport(handler))
        audio = OpenAIAudio('not-a-real-key', client)
        self.assertEqual(await audio.transcribe(wav(), 'ko'), '겨울이 좋아')
        self.assertIn(b'utterance.wav', requests[0].content)
        self.assertIn(b'gpt-4o-mini-transcribe', requests[0].content)
        await audio.speak('hello', 'a', 'en'); await audio.speak('hi', 'b', 'en')
        self.assertNotEqual(json.loads(requests[1].content)['voice'], json.loads(requests[2].content)['voice'])
        await audio.close()

    async def test_provider_error_does_not_leak_response_or_key(self):
        client = httpx.AsyncClient(base_url='https://example.test/', transport=httpx.MockTransport(
            lambda request: httpx.Response(401, text='secret-error-body')))
        audio = OpenAIAudio('not-a-real-key', client)
        with self.assertRaises(DomainError) as error: await audio.transcribe(wav(), 'ko')
        self.assertNotIn('secret-error-body', str(error.exception))
        self.assertEqual(error.exception.code, 'audio_auth')
        await audio.close()

    def test_invalid_wav_is_rejected(self):
        for data in (b'', b'RIFFbad', wav(.01)):
            with self.assertRaises(DomainError): validate_wav(data)
