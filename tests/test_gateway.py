import unittest
import httpx
from backend.app.gateway import ResponsesGateway
from backend.app.domain import GenerationRequest, DomainError


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_response_uses_stateless_instructions_and_parses_output(self):
        import json
        seen = []
        def handler(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200, json={'status': 'completed', 'output': [
                {'type': 'reasoning', 'summary': []},
                {'type': 'message', 'content': [{'type': 'output_text', 'text': 'I see your point.'}]}],
                'usage': {'input_tokens': 20, 'output_tokens': 8}})
        client = httpx.AsyncClient(base_url='https://example.test/v1/', transport=httpx.MockTransport(handler))
        gateway = ResponsesGateway('test-key', 'configured-test-model', client)
        result = await gateway.generate(GenerationRequest('a', 'en', 'food', (), 'continue', 1))
        self.assertEqual(result.text, 'I see your point.')
        self.assertFalse(seen[0]['store'])
        self.assertNotIn('test-key', str(seen))
        self.assertEqual(result.usage['output_tokens'], 8)
        await gateway.close()

    async def test_incomplete_response_is_not_spoken(self):
        def handler(request): return httpx.Response(200, json={'status': 'incomplete', 'output': []})
        client = httpx.AsyncClient(base_url='https://example.test/', transport=httpx.MockTransport(handler))
        gateway = ResponsesGateway('test-key', 'model', client)
        with self.assertRaises(DomainError):
            await gateway.generate(GenerationRequest('a', 'ko', 'food', (), 'continue', 1))
        await gateway.close()

