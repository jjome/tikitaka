"""Two paid calls with a fixed synthetic test sentence, not microphone audio."""
import asyncio
import io
import json
import os
from pathlib import Path
import sys
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.audio import OpenAIAudio
from backend.app.domain import DomainError


async def main():
    key = os.getenv('OPENAI_API_KEY')
    if not key:
        print('API key is missing. No requests made.')
        return 1
    root = Path(__file__).resolve().parents[1] / '.runtime'
    root.mkdir(exist_ok=True)
    audio = OpenAIAudio(key)
    report = {'status': 'running', 'synthetic_input': '준호, 나는 겨울이 더 좋아. 여름은 너무 더워.'}
    try:
        raw = await audio.speak(report['synthetic_input'], 'a', 'ko', format='wav')
        # Speech streaming WAVs can use an unknown RIFF length. Finalize the
        # header for the finite fixture before validating or playing it.
        with wave.open(io.BytesIO(raw), 'rb') as reader:
            params = reader.getparams()
            frames = reader.readframes(reader.getnframes())
        output = io.BytesIO()
        with wave.open(output, 'wb') as writer:
            writer.setparams(params); writer.writeframes(frames)
        fixture = output.getvalue()
        (root / 'audio-check.wav').write_bytes(fixture)
        text = await audio.transcribe(fixture, 'ko')
        report.update(status='passed' if '겨울' in text and '준호' in text else 'failed', transcription=text,
                      speech_bytes=len(fixture))
        print('Synthetic speech -> transcription: ' + report['status'])
        return 0 if report['status'] == 'passed' else 1
    except DomainError as error:
        report.update(status='failed', error_code=error.code)
        print(str(error))
        return 1
    except Exception:
        report.update(status='failed', error_code='audio_check_failed')
        print('Audio check failed. See the local report.')
        return 1
    finally:
        (root / 'audio-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        await audio.close()


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
