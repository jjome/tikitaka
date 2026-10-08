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


def normalize_wav(raw):
    """Replace streaming length sentinels with the size actually received."""
    with wave.open(io.BytesIO(raw), 'rb') as reader:
        params = reader.getparams()
        frames = reader.readframes(reader.getnframes())
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        # Do not copy the provider's unknown/placeholder frame count. Python's
        # WAV writer can overflow its RIFF length before it gets to patch it.
        writer.setparams(params._replace(nframes=0))
        writer.writeframes(frames)
    return output.getvalue()


async def main(report_directory=None):
    key = os.getenv('OPENAI_API_KEY')
    if not key:
        print('API key is missing. No requests made.')
        return 1
    root = Path(report_directory) if report_directory is not None else Path(__file__).resolve().parents[1] / '.runtime'
    root.mkdir(exist_ok=True)
    audio = OpenAIAudio(key)
    report = {'status': 'running', 'stage': 'speech', 'synthetic_input': '준호, 나는 겨울이 더 좋아. 여름은 너무 더워.'}
    try:
        raw = await audio.speak(report['synthetic_input'], 'a', 'ko', format='wav')
        report['stage'] = 'normalize_wav'
        fixture = normalize_wav(raw)
        (root / 'audio-check.wav').write_bytes(fixture)
        report['stage'] = 'transcription'
        text = await audio.transcribe(fixture, 'ko')
        report.update(status='passed' if '겨울' in text and '준호' in text else 'failed', transcription=text,
                      speech_bytes=len(fixture))
        print('Synthetic speech -> transcription: ' + report['status'])
        return 0 if report['status'] == 'passed' else 1
    except DomainError as error:
        report.update(status='failed', error_code=error.code)
        print(str(error))
        return 1
    except Exception as error:
        # Exception messages may contain provider content; only store the type.
        report.update(status='failed', error_code='audio_check_failed', error_type=type(error).__name__)
        print(f'Audio check failed at {report["stage"]} ({report["error_type"]}). See the local report.')
        return 1
    finally:
        (root / 'audio-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        await audio.close()


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
