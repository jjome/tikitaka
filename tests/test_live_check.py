import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.app.domain import DomainError, GenerationResult
from scripts.check_openai import check


class LiveCheckTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_credentials_never_calls_provider(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': '', 'TIKITAKA_MODEL': ''}), \
                patch('scripts.check_openai.ResponsesGateway') as factory, \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(await check('ko'), 1)
            factory.assert_not_called()

    async def run_check(self, failure=False):
        class Provider:
            calls = 0
            closed = False
            async def generate(self, request):
                self.calls += 1
                if failure and self.calls == 2:
                    raise DomainError('provider_auth', 'AI 연결을 확인해주세요.')
                return GenerationResult('지수야, 네 이야기를 듣고 있어.', {'output_tokens': 10})
            async def close(self):
                self.closed = True
        provider = Provider()
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / 'report.json'
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only-secret', 'TIKITAKA_MODEL': 'test-model'}), \
                    patch('scripts.check_openai.ResponsesGateway', return_value=provider), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result = await check('ko', report_path)
            contents = report_path.read_text(encoding='utf-8')
            self.assertNotIn('test-only-secret', contents)
            self.assertIn('지수', contents)
            self.assertTrue(provider.closed)
            return result, json.loads(contents), provider.calls

    async def test_report_keeps_korean_without_shell_encoding_and_bounds_calls(self):
        result, report, calls = await self.run_check()
        self.assertEqual(result, 0)
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(calls, 3)
        self.assertEqual([turn['speaker'] for turn in report['turns']], ['a', 'b', 'a'])

    async def test_failure_preserves_partial_report_and_stops_calls(self):
        result, report, calls = await self.run_check(failure=True)
        self.assertEqual(result, 1)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['error_code'], 'provider_auth')
        self.assertEqual(len(report['turns']), 1)
        self.assertEqual(calls, 2)
