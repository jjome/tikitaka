"""Bounded audio requests. Raw microphone audio stays in memory only."""
import io
import os
import wave

import httpx

from .domain import DomainError

MAX_AUDIO_BYTES = 2_500_000


def validate_wav(data):
    try:
        with wave.open(io.BytesIO(data), 'rb') as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            if (audio.getnchannels() != 1 or audio.getsampwidth() != 2 or
                    not 8000 <= rate <= 48000 or not .15 <= frames / rate <= 21 or
                    len(audio.readframes(frames)) != frames * 2):
                raise ValueError()
    except (wave.Error, EOFError, ValueError, ZeroDivisionError):
        raise DomainError('invalid_audio', '음성 데이터 형식이나 길이를 확인해주세요.') from None


class OpenAIAudio:
    def __init__(self, key, client=None):
        self.client = client or httpx.AsyncClient(base_url='https://api.openai.com/v1/',
            headers={'Authorization': f'Bearer {key}'}, timeout=20)
        self.transcription_model = os.getenv('TIKITAKA_TRANSCRIPTION_MODEL', 'gpt-4o-mini-transcribe')
        self.speech_model = os.getenv('TIKITAKA_SPEECH_MODEL', 'gpt-4o-mini-tts')

    async def request(self, path, **kwargs):
        try:
            response = await self.client.post(path, **kwargs)
            response.raise_for_status()
            return response
        except httpx.TimeoutException:
            raise DomainError('audio_timeout', '음성 처리 응답이 늦습니다. 대화를 다시 시작해주세요.') from None
        except httpx.HTTPStatusError as exc:
            code = 'audio_auth' if exc.response.status_code in (401, 403) else 'audio_unavailable'
            raise DomainError(code, '음성 API 연결을 확인해주세요. API 권한과 사용 한도를 확인할 수 있습니다.') from None
        except httpx.RequestError:
            raise DomainError('audio_unavailable', '음성 API에 연결하지 못했습니다. 다시 시도해주세요.') from None

    async def transcribe(self, data, language):
        validate_wav(data)
        response = await self.request('audio/transcriptions',
            files={'file': ('utterance.wav', data, 'audio/wav')},
            data={'model': self.transcription_model, 'language': language, 'response_format': 'json',
                  'prompt': '등장인물 이름: 민지, 준호.' if language == 'ko' else 'Names in this conversation: Minji, Junho.'})
        try:
            text = response.json()['text']
            if not isinstance(text, str) or len(text) > 1000:
                raise ValueError()
            return text.strip()
        except (KeyError, TypeError, ValueError):
            raise DomainError('invalid_transcription', '인식한 문장을 확인하지 못했습니다. 짧게 다시 말씀해주세요.') from None

    async def speak(self, text, speaker, language, format='mp3'):
        response = await self.request('audio/speech', json={
            'model': self.speech_model, 'input': text, 'voice': 'coral' if speaker == 'a' else 'ash',
            'response_format': format,
            'instructions': f'Speak naturally as a friendly conversational partner in {"Korean" if language == "ko" else "English"}.',
        })
        if not response.content or len(response.content) > 3_000_000:
            raise DomainError('invalid_speech', 'AI 음성을 생성하지 못했습니다.')
        return response.content

    async def close(self):
        await self.client.aclose()
