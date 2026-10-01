import unittest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.main import create_app
from backend.app.gateway import DemoGateway


class APITests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(':memory:', DemoGateway(.001)))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def session(self):
        return self.client.post('/api/sessions', json={'topic_id': 'food', 'language': 'ko'}).json()

    def test_create_and_authorized_snapshot(self):
        s = self.session()
        route = f'/api/sessions/{s["id"]}'
        self.assertEqual(self.client.get(route).status_code, 404)
        result = self.client.get(route, headers={'X-Session-Token': s['token']})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['state'], 'paused')
        self.assertNotIn('token', result.json())

    def test_unknown_topic_and_language_rejected(self):
        for body in ({'topic_id': 'unknown'}, {'language': 'ja'}):
            self.assertEqual(self.client.post('/api/sessions', json=body).status_code, 422)

    def test_audio_diagnostics_requires_token_and_forbids_raw_audio(self):
        s = self.session()
        route = f'/api/sessions/{s["id"]}/audio-diagnostics'
        report = {'build': 'test', 'peak': 0, 'frames': 100, 'speech_starts': 0, 'results': 0}
        self.assertEqual(self.client.post(route, json=report).status_code, 404)
        headers = {'X-Session-Token': s['token']}
        self.assertEqual(self.client.post(route, json=report, headers=headers).status_code, 204)
        for invalid in ({**report, 'peak': -1}, {**report, 'audio': 'raw'}, {**report, 'source': 'x' * 161}):
            self.assertEqual(self.client.post(route, json=invalid, headers=headers).status_code, 422)
        row = self.client.app.state.repository.db.execute('SELECT payload FROM audio_diagnostics WHERE session_id=?', (s['id'],)).fetchone()
        self.assertIn('"peak": 0.0', row[0])
        self.assertNotIn(s['token'], row[0])

    def test_development_pages_are_not_cached(self):
        for route in ('/', '/mic', '/assets/voice.mjs'):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_one_button_defaults_choose_a_topic(self):
        from backend.app.content import TOPICS
        result = self.client.post('/api/sessions', json={})
        self.assertEqual(result.status_code, 201)
        self.assertIn(result.json()['snapshot']['topic_id'], TOPICS)
        self.assertEqual(result.json()['snapshot']['state'], 'paused')

    def test_default_language_configured_for_release(self):
        from unittest.mock import patch
        with patch.dict('os.environ', {'TIKITAKA_LANGUAGE': 'en'}):
            self.assertEqual(self.client.get('/api/config').json()['default_language'], 'en')

    def test_socket_authentication_required(self):
        s = self.session()
        with self.client.websocket_connect(f'/api/sessions/{s["id"]}/events') as ws:
            ws.send_json({'type': 'authenticate', 'token': 'wrong'})
            with self.assertRaises(WebSocketDisconnect):
                ws.receive_json()

    def test_socket_observation_interruption_and_pause(self):
        s = self.session()
        with self.client.websocket_connect(f'/api/sessions/{s["id"]}/events') as ws:
            ws.send_json({'type': 'authenticate', 'token': s['token']})
            while ws.receive_json()['type'] != 'snapshot': pass
            ws.send_json({'type': 'resume'})
            events = []
            while True:
                event = ws.receive_json()
                events.append(event)
                if event['type'] == 'message':
                    break
            self.assertEqual(event['message']['speaker'], 'a')
            ws.send_json({'type': 'speech_started'})
            while True:
                event = ws.receive_json()
                if event['type'] == 'state' and event['state'] == 'listening': break
            ws.send_json({'type': 'user_message', 'text': '난 짬뽕', 'client_message_id': 'u1'})
            while True:
                event = ws.receive_json()
                if event['type'] == 'message' and event['message']['speaker'] != 'user': break
            self.assertIn('난 짬뽕', event['message']['text'])
        snapshot = self.client.get(f'/api/sessions/{s["id"]}', headers={'X-Session-Token': s['token']}).json()
        self.assertEqual(snapshot['state'], 'paused')

    def test_invalid_socket_command_does_not_disconnect(self):
        s = self.session()
        with self.client.websocket_connect(f'/api/sessions/{s["id"]}/events') as ws:
            ws.send_json({'type': 'authenticate', 'token': s['token']})
            while ws.receive_json()['type'] != 'snapshot': pass
            ws.send_text('[]')
            self.assertEqual(ws.receive_json()['code'], 'invalid_command')
            ws.send_json({'type': 'heartbeat'})
            self.assertEqual(ws.receive_json()['type'], 'heartbeat')

    def test_cross_origin_socket_rejected(self):
        s = self.session()
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(f'/api/sessions/{s["id"]}/events', headers={'origin': 'https://example.com'}):
                pass

    def test_non_string_auth_token_is_rejected(self):
        s = self.session()
        with self.client.websocket_connect(f'/api/sessions/{s["id"]}/events') as ws:
            ws.send_json({'type': 'authenticate', 'token': 123})
            with self.assertRaises(WebSocketDisconnect):
                ws.receive_json()

