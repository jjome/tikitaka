import asyncio
import tempfile
from pathlib import Path
import unittest

from backend.app.domain import GenerationResult, Policy, DomainError
from backend.app.engine import ConversationEngine
from backend.app.gateway import DemoGateway
from backend.app.repository import SessionRepository


async def eventually(predicate, timeout=.8):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(.002)


class ControlledGateway:
    mode = 'test'

    def __init__(self, ignore_cancel=False):
        self.ignore_cancel = ignore_cancel
        self.requests = []
        self.release = asyncio.Event()
        self.active = 0
        self.max_active = 0

    async def generate(self, request):
        self.requests.append(request)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            while not self.release.is_set():
                try:
                    await self.release.wait()
                except asyncio.CancelledError:
                    if not self.ignore_cancel:
                        raise
            return GenerationResult(f'{request.speaker} revision {request.revision}')
        finally:
            self.active -= 1

    async def close(self):
        pass


class EngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.repo = SessionRepository(':memory:')
        self.engines = []
        self.events = []

    async def asyncTearDown(self):
        for engine in self.engines:
            if isinstance(engine.gateway, ControlledGateway):
                engine.gateway.release.set()
            await engine.close()
        self.repo.close()

    async def make(self, gateway=None, policy=None):
        engine = ConversationEngine('s' + str(len(self.engines)), 'food', 'ko',
                                    gateway or DemoGateway(.001), self.repo,
                                    policy or Policy(pacing_seconds=.005))
        self.repo.create(engine.id, 'token', engine.snapshot())
        self.engines.append(engine)

        async def sink(event):
            self.events.append(event)
        self.epoch = await engine.attach(sink)
        return engine

    async def speak(self, engine):
        await engine.handle({'type': 'resume'})
        await eventually(lambda: engine.state == 'speaking')
        return engine.messages[-1]

    async def test_a_b_alternate_only_after_playback(self):
        e = await self.make()
        first = await self.speak(e)
        self.assertEqual(first.speaker, 'a')
        await asyncio.sleep(.02)
        self.assertEqual(len(e.messages), 1)
        await e.handle({'type': 'playback_finished', 'message_id': first.id, 'revision': first.revision})
        await eventually(lambda: len(e.messages) == 2)
        self.assertEqual(e.messages[-1].speaker, 'b')
        self.assertEqual(first.delivery, 'played')

    async def test_late_result_after_interruption_is_discarded(self):
        g = ControlledGateway(ignore_cancel=True)
        e = await self.make(g)
        await e.handle({'type': 'resume'})
        await eventually(lambda: len(g.requests) == 1)
        await e.handle({'type': 'speech_started'})
        await asyncio.sleep(.005)
        await e.handle({'type': 'user_message', 'text': '난 반대야', 'client_message_id': 'u1'})
        g.release.set()
        await eventually(lambda: e.state == 'speaking')
        self.assertEqual([m.speaker for m in e.messages], ['user', 'a'])
        self.assertGreater(e.messages[-1].revision, g.requests[0].revision)
        self.assertEqual(e.stats['discarded'], 1)
        self.assertEqual(g.max_active, 1)

    async def test_replay_completion_after_barge_in_does_not_advance(self):
        e = await self.make()
        m = await self.speak(e)
        await e.handle({'type': 'speech_started'})
        await e.handle({'type': 'playback_finished', 'message_id': m.id, 'revision': m.revision})
        await asyncio.sleep(.02)
        self.assertEqual(e.state, 'listening')
        self.assertEqual(m.delivery, 'interrupted')
        self.assertEqual(len(e.messages), 1)

    async def test_wrong_playback_id_is_ignored(self):
        e = await self.make()
        m = await self.speak(e)
        await e.handle({'type': 'playback_finished', 'message_id': 'wrong', 'revision': m.revision})
        self.assertEqual(e.state, 'speaking')

    async def test_duplicate_user_message_keeps_revision_and_order(self):
        e = await self.make()
        command = {'type': 'user_message', 'text': '짜장', 'client_message_id': 'u1'}
        await e.handle(command)
        revision = e.revision
        await e.handle(command)
        self.assertEqual(len(e.messages), 1)
        self.assertEqual(e.revision, revision)
        self.assertEqual(e.state, 'paused')

    async def test_named_b_responds_first(self):
        e = await self.make()
        await self.speak(e)
        await e.handle({'type': 'user_message', 'text': '준호, 나는 반대야', 'client_message_id': 'u1'})
        await eventually(lambda: e.state == 'speaking')
        self.assertEqual(e.messages[-1].speaker, 'b')

    async def test_pause_and_resume_never_replays_old_audio(self):
        e = await self.make()
        old = await self.speak(e)
        await e.handle({'type': 'pause'})
        self.assertEqual(old.delivery, 'interrupted')
        await asyncio.sleep(.02)
        self.assertEqual(e.state, 'paused')
        await e.handle({'type': 'resume'})
        await eventually(lambda: len(e.messages) == 2)
        self.assertNotEqual(e.messages[-1].id, old.id)

    async def test_disconnect_stops_and_old_connection_cannot_control(self):
        e = await self.make()
        await self.speak(e)
        epoch = self.epoch
        await e.disconnect(epoch)
        self.assertEqual(e.state, 'paused')
        with self.assertRaises(DomainError):
            await e.handle({'type': 'resume'}, epoch)

    async def test_replaced_connection_cannot_pause_new_connection(self):
        e = await self.make()
        old = self.epoch
        async def sink(event): pass
        new = await e.attach(sink)
        await e.handle({'type': 'resume'}, new)
        await e.disconnect(old)
        await eventually(lambda: e.state == 'speaking')
        self.assertEqual(e.state, 'speaking')

    async def test_playback_watchdog_pauses(self):
        e = await self.make(policy=Policy(playback_timeout=.02))
        await self.speak(e)
        await eventually(lambda: e.state == 'paused')
        self.assertEqual(e.messages[-1].delivery, 'interrupted')
        self.assertTrue(any(x.get('code') == 'playback_timeout' for x in self.events))

    async def test_speech_activity_extends_transcription_lease(self):
        e = await self.make(policy=Policy(speech_timeout=.04))
        await self.speak(e)
        await e.handle({'type': 'speech_started'})
        await asyncio.sleep(.025)
        await e.handle({'type': 'speech_activity'})
        await asyncio.sleep(.025)
        self.assertEqual(e.state, 'listening')
        await eventually(lambda: e.state == 'paused')

    async def test_provider_error_pauses_without_leaking_body(self):
        class Broken(DemoGateway):
            async def generate(self, request):
                raise RuntimeError('secret-private-provider-response')
        e = await self.make(Broken())
        await e.handle({'type': 'resume'})
        await eventually(lambda: e.state == 'paused')
        self.assertNotIn('secret-private-provider-response', str(self.events))
        self.assertEqual(e.stats['errors'], 1)

    async def test_generation_timeout_pauses(self):
        e = await self.make(ControlledGateway(), Policy(generation_timeout=.02))
        await e.handle({'type': 'resume'})
        await eventually(lambda: e.state == 'paused')
        self.assertEqual(e.stats['calls'], 1)

    async def test_call_budget_ends_session(self):
        e = await self.make(policy=Policy(max_calls=1, pacing_seconds=.001))
        m = await self.speak(e)
        await e.handle({'type': 'playback_finished', 'message_id': m.id, 'revision': m.revision})
        await eventually(lambda: e.state == 'ended')
        self.assertEqual(e.stats['calls'], 1)
        self.assertEqual(e.stop_reason, 'session_limit')

    async def test_timeout_pauses_even_when_provider_ignores_cancel(self):
        g = ControlledGateway(ignore_cancel=True)
        e = await self.make(g, Policy(generation_timeout=.02))
        await e.handle({'type': 'resume'})
        await eventually(lambda: e.state == 'paused')
        g.release.set()
        await eventually(lambda: e.stats['discarded'] == 1)
        self.assertEqual(e.messages, [])

    async def test_end_rejects_new_input(self):
        e = await self.make()
        await e.handle({'type': 'end'})
        with self.assertRaises(DomainError):
            await e.handle({'type': 'user_message', 'text': '안녕', 'client_message_id': 'u1'})
        self.assertEqual(len(e.messages), 0)

    async def test_time_limit_ends_even_while_waiting_for_audio(self):
        e = await self.make(policy=Policy(max_session_seconds=.04))
        await self.speak(e)
        await eventually(lambda: e.state == 'ended')
        self.assertEqual(e.stop_reason, 'session_limit')
        self.assertEqual(e.messages[-1].delivery, 'interrupted')

    async def test_restoration_keeps_history_and_pauses(self):
        e = await self.make()
        m = await self.speak(e)
        saved = self.repo.load(e.id)
        restored = ConversationEngine(e.id, 'food', 'ko', e.gateway, self.repo, restored=saved)
        self.assertEqual(restored.state, 'paused')
        self.assertEqual(restored.messages[0].id, m.id)
        self.assertEqual(restored.messages[0].delivery, 'interrupted')
        self.assertGreater(restored.revision, e.revision)

    async def test_invalid_message_types_are_rejected(self):
        e = await self.make()
        for text in (None, 10, [], '', ' '):
            with self.assertRaises(DomainError):
                await e.handle({'type': 'user_message', 'text': text, 'client_message_id': 'u'})


class RepositoryTests(unittest.TestCase):
    def test_durable_record_and_hashed_token(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'sessions.db'
            repo = SessionRepository(path)
            repo.create('s', 'private-token', {'state': 'paused'})
            self.assertTrue(repo.authorize('s', 'private-token'))
            self.assertFalse(repo.authorize('s', 'wrong'))
            repo.close()
            self.assertNotIn(b'private-token', path.read_bytes())
            repo = SessionRepository(path)
            self.assertEqual(repo.load('s')['state'], 'paused')
            repo.close()

