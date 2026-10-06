"""Three bounded real model calls; never falls back to the scripted provider."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.domain import DomainError, GenerationRequest
from backend.app.gateway import ResponsesGateway


async def check(language, report_path=None):
    key, model = os.getenv('OPENAI_API_KEY'), os.getenv('TIKITAKA_MODEL')
    if not key or not model:
        print('API 키와 모델 설정이 없습니다. 실제 API를 호출하지 않았습니다.', file=sys.stderr)
        return 1
    gateway = ResponsesGateway(key, model)
    history = []
    report = {'mode': 'openai', 'model': model, 'status': 'running', 'turns': []}
    def save_report():
        if report_path:
            Path(report_path).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    inputs = (['내 이름은 지수야. 오늘 발표를 망쳐서 속상해.',
               '준호, 조언보다 그냥 내 이야기를 들어줬으면 좋겠어.',
               '민지, 아까 말한 내 이름 기억해?'] if language == 'ko' else
              ['My name is Jisu. I feel bad because my presentation went wrong today.',
               'Junho, I would rather you listen than give me advice.',
               'Minji, do you remember the name I told you?'])
    try:
        for turn, (speaker, text) in enumerate(zip(('a', 'b', 'a'), inputs), 1):
            history.append({'speaker': 'user', 'text': text, 'delivery': 'received'})
            started = time.monotonic()
            result = await gateway.generate(GenerationRequest(speaker, language, 'food', tuple(history), 'react_user', turn))
            history.append({'speaker': speaker, 'text': result.text, 'delivery': 'played'})
            entry = {'turn': turn, 'speaker': speaker, 'user': text, 'response': result.text,
                     'seconds': round(time.monotonic() - started, 2), 'usage': result.usage}
            report['turns'].append(entry)
            save_report()
            print(json.dumps(entry, ensure_ascii=False))
        report['status'] = 'passed'
        save_report()
        print('실제 API 응답 3개를 받았습니다. 주제 전환·요청 반영·이름 기억은 위 응답으로 확인하세요. 음성 검사는 별도입니다.')
        return 0
    except DomainError as error:
        report.update(status='failed', error_code=error.code)
        save_report()
        print(f'실제 API 검사 실패 ({error.code}): {error}', file=sys.stderr)
        return 1
    except Exception:
        report.update(status='failed', error_code='check_failed')
        save_report()
        print('실제 API 검사 중 오류가 발생했습니다. 대본 응답을 사용하지 않습니다.', file=sys.stderr)
        return 1
    finally:
        await gateway.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', choices=('ko', 'en'), default='ko')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    sys.exit(asyncio.run(check(args.language, args.report)))
