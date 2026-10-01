"""One controller per conversation; user speech always invalidates AI work."""
import asyncio
import time
import uuid
from dataclasses import asdict
from collections.abc import Awaitable, Callable

from .domain import Message, Policy, GenerationRequest, DomainError

Sink = Callable[[dict], Awaitable[None]]


class ConversationEngine:
    def __init__(self, session_id, topic_id, language, gateway, repository, policy=None, restored=None):
        self.id = session_id
        self.topic_id = topic_id
        self.language = language
        self.gateway = gateway
        self.repository = repository
        self.policy = policy or Policy()
        self.state = 'paused'
        self.revision = 0
        self.messages = []
        self.next_speaker = 'a'
        self.created_at = time.time()
        self.stats = {'calls': 0, 'cancelled': 0, 'discarded': 0, 'errors': 0, 'input_tokens': 0, 'output_tokens': 0}
        self.stop_reason = None
        self.events = []
        self._lock = asyncio.Lock()
        self._provider_lock = asyncio.Lock()
        self._job = None
        self._generation_guard = None
        self._tasks = set()
        self._sink = None
        self._connection_epoch = 0
        self._last_heartbeat = time.monotonic()
        if restored:
            self.revision = restored['revision'] + 1
            self.messages = [Message(**m) for m in restored['messages']]
            self.stats.update(restored['stats'])
            self.next_speaker = restored['next_speaker']
            self.created_at = restored['created_at']
            self.events = restored.get('events', [])
            self.stop_reason = restored.get('stop_reason')
            self.state = 'ended' if restored['state'] == 'ended' else 'paused'
            for m in self.messages:
                if m.delivery == 'pending':
                    m.delivery = 'interrupted'

    def snapshot(self):
        return {'id': self.id, 'topic_id': self.topic_id, 'language': self.language,
                'state': self.state, 'revision': self.revision, 'next_speaker': self.next_speaker,
                'created_at': self.created_at, 'messages': [m.public() for m in self.messages],
                'stats': dict(self.stats), 'mode': self.gateway.mode, 'stop_reason': self.stop_reason,
                'events': list(self.events), 'policy': asdict(self.policy)}

    def _save(self):
        self.repository.save(self.id, self.snapshot())

    def _spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def _emit(self, event_type, **data):
        event = {'type': event_type, 'revision': self.revision, 'at': time.time(), **data}
        # Events contain only control metadata, not raw audio or provider error bodies.
        self.events.append({k: v for k, v in event.items() if k != 'message'})
        self.events = self.events[-80:]
        self._save()
        if self._sink:
            try:
                await self._sink(event)
            except (ConnectionError, RuntimeError, asyncio.TimeoutError):
                # The connection watcher or websocket finally block pauses the session.
                self._sink = None

    async def _state(self, state):
        self.state = state
        await self._emit('state', state=state, next_speaker=self.next_speaker,
                         stats=dict(self.stats), stop_reason=self.stop_reason)

    def _invalidate(self):
        self.revision += 1
        if self._job and not self._job.done() and self._job is not asyncio.current_task():
            self._job.cancel()
        self._job = None
        if (self._generation_guard and not self._generation_guard.done()
                and self._generation_guard is not asyncio.current_task()):
            self._generation_guard.cancel()
        self._generation_guard = None

    async def _interrupt_pending(self):
        for m in self.messages:
            if m.delivery == 'pending':
                m.delivery = 'interrupted'
                await self._emit('delivery', message_id=m.id, delivery=m.delivery)
        await self._emit('interrupt')

    async def attach(self, sink):
        async with self._lock:
            self._connection_epoch += 1
            epoch = self._connection_epoch
            self._sink = sink
            self._last_heartbeat = time.monotonic()
            self._invalidate()
            await self._interrupt_pending()
            if self.state != 'ended':
                self.state = 'paused'
            self._save()
            await sink({'type': 'snapshot', **self.snapshot()})
            self._spawn(self._watch_connection(epoch))
            return epoch

    async def disconnect(self, epoch):
        async with self._lock:
            if epoch != self._connection_epoch:
                return
            self._sink = None
            self._connection_epoch += 1
            if self.state != 'ended':
                self._invalidate()
                await self._interrupt_pending()
                await self._state('paused')

    async def _watch_connection(self, epoch):
        while epoch == self._connection_epoch:
            await asyncio.sleep(min(.5, self.policy.heartbeat_timeout / 3, self.policy.max_session_seconds / 3))
            if time.time() - self.created_at >= self.policy.max_session_seconds:
                async with self._lock:
                    if epoch == self._connection_epoch and self.state != 'ended':
                        self._invalidate()
                        await self._interrupt_pending()
                        self.stop_reason = 'session_limit'
                        await self._state('ended')
                return
            if time.monotonic() - self._last_heartbeat > self.policy.heartbeat_timeout:
                await self.disconnect(epoch)
                return

    async def handle(self, command, epoch=None):
        async with self._lock:
            if epoch is not None and epoch != self._connection_epoch:
                raise DomainError('stale_connection', '새 연결에서 대화를 이어가세요.')
            self._last_heartbeat = time.monotonic()
            kind = command['type']
            if kind == 'heartbeat':
                await self._emit('heartbeat')
                return
            if kind not in {'resume', 'pause', 'end', 'speech_started', 'speech_activity', 'speech_cancelled',
                            'user_message', 'playback_finished', 'playback_failed'}:
                raise DomainError('invalid_command', '알 수 없는 요청입니다.')
            if self.state == 'ended':
                raise DomainError('session_ended', '종료한 대화입니다. 새 대화를 시작하세요.')
            if kind == 'resume':
                if self.state != 'paused':
                    return
                self._invalidate()
                self.stop_reason = None
                await self._begin_generation()
            elif kind in {'pause', 'end'}:
                self._invalidate()
                await self._interrupt_pending()
                self.stop_reason = 'user_ended' if kind == 'end' else None
                await self._state('ended' if kind == 'end' else 'paused')
            elif kind == 'speech_started':
                if self.state in {'paused', 'listening'}:
                    return
                self._invalidate()
                await self._interrupt_pending()
                await self._state('listening')
                self._job = self._spawn(self._speech_watchdog(self.revision))
            elif kind == 'speech_activity':
                if self.state == 'listening':
                    if self._job:
                        self._job.cancel()
                    self._job = self._spawn(self._speech_watchdog(self.revision))
            elif kind == 'speech_cancelled':
                if self.state != 'listening':
                    return
                self._invalidate()
                await self._state('pacing')
                self._job = self._spawn(self._pace(self.revision))
            elif kind == 'user_message':
                raw_text = command.get('text', '')
                if not isinstance(raw_text, str) or not isinstance(command.get('client_message_id'), str):
                    raise DomainError('invalid_message', '메시지는 문자열이어야 합니다.')
                text = raw_text.strip()
                client_id = command.get('client_message_id', '')
                if not text or len(text) > 1000 or not client_id or len(client_id) > 80:
                    raise DomainError('invalid_message', '1~1000자의 메시지와 전송 식별자가 필요합니다.')
                existing = next((m for m in self.messages if m.client_message_id == client_id), None)
                if existing:
                    await self._emit('message', message=existing.public())
                    return
                was_paused = self.state == 'paused'
                self._invalidate()
                await self._interrupt_pending()
                msg = Message('user', text, self.revision, len(self.messages) + 1,
                              client_message_id=client_id)
                self.messages.append(msg)
                lowered = text.casefold()
                self.next_speaker = 'b' if ('준호' in text or 'junho' in lowered) else 'a'
                await self._emit('message', message=msg.public())
                if was_paused:
                    await self._state('paused')
                else:
                    await self._begin_generation()
            elif kind in {'playback_finished', 'playback_failed'}:
                current = self.messages[-1] if self.messages else None
                if (self.state != 'speaking' or not current or current.delivery != 'pending'
                        or command.get('message_id') != current.id
                        or command.get('revision') != self.revision):
                    return
                self._invalidate()
                current.delivery = 'played' if kind == 'playback_finished' else 'interrupted'
                await self._emit('delivery', message_id=current.id, delivery=current.delivery)
                if kind == 'playback_failed':
                    await self._emit('error', code='playback_failed', message='음성 재생에 실패했습니다. 음성 설정을 확인하세요.')
                    await self._state('paused')
                else:
                    await self._state('pacing')
                    self._job = self._spawn(self._pace(self.revision))

    async def _begin_generation(self):
        if (self.stats['calls'] >= self.policy.max_calls
                or time.time() - self.created_at >= self.policy.max_session_seconds):
            self.stop_reason = 'session_limit'
            await self._state('ended')
            return
        await self._state('generating')
        self._job = self._spawn(self._generate(self.revision))
        self._generation_guard = self._spawn(self._generation_watchdog(self.revision))

    async def _generation_watchdog(self, revision):
        try:
            await asyncio.sleep(self.policy.generation_timeout)
            async with self._lock:
                if self.revision == revision and self.state == 'generating':
                    self.stats['errors'] += 1
                    self._invalidate()
                    await self._emit('error', code='generation_timeout', message='응답이 늦어 대화를 정지했습니다.')
                    await self._state('paused')
        except asyncio.CancelledError:
            pass

    async def _generate(self, revision):
        try:
            async with self._provider_lock:
                async with self._lock:
                    if self.revision != revision or self.state != 'generating':
                        return
                    self.stats['calls'] += 1
                    self._save()
                    history = [m.public() for m in self.messages[-24:]]
                    latest_user = next((m for m in reversed(self.messages) if m.speaker == 'user'), None)
                    if latest_user and not any(m['id'] == latest_user.id for m in history):
                        history.insert(0, latest_user.public())
                    request = GenerationRequest(
                        self.next_speaker, self.language, self.topic_id, tuple(history),
                        'react_user' if history and history[-1]['speaker'] == 'user' else 'continue', revision)
                result = await asyncio.wait_for(self.gateway.generate(request), self.policy.generation_timeout)
            async with self._lock:
                for key in ('input_tokens', 'output_tokens'):
                    self.stats[key] += result.usage.get(key, 0)
                if self.revision != revision or self.state != 'generating':
                    self.stats['discarded'] += 1
                    self._save()
                    return
                if not result.text.strip() or len(result.text) > (180 if self.language == 'ko' else 400):
                    raise DomainError('invalid_output', 'AI 응답을 확인할 수 없어 정지했습니다.')
                msg = Message(request.speaker, result.text, revision, len(self.messages) + 1, delivery='pending')
                self.messages.append(msg)
                if self._generation_guard:
                    self._generation_guard.cancel()
                self.next_speaker = 'b' if request.speaker == 'a' else 'a'
                await self._state('speaking')
                await self._emit('message', message=msg.public())
                self._job = self._spawn(self._playback_watchdog(revision, msg.id))
        except asyncio.CancelledError:
            self.stats['cancelled'] += 1
            self._save()
        except (DomainError, asyncio.TimeoutError) as exc:
            async with self._lock:
                if self.revision != revision or self.state != 'generating':
                    return
                self.stats['errors'] += 1
                self._invalidate()
                await self._emit('error', code=getattr(exc, 'code', 'generation_timeout'),
                                 message=str(exc) if isinstance(exc, DomainError) else '응답이 늦어 대화를 정지했습니다.')
                await self._state('paused')
        except Exception:
            # Never expose provider bodies, credentials or tracebacks to clients.
            async with self._lock:
                if self.revision == revision and self.state == 'generating':
                    self.stats['errors'] += 1
                    self._invalidate()
                    await self._emit('error', code='generation_failed', message='AI 응답에 문제가 있어 정지했습니다.')
                    await self._state('paused')

    async def _pace(self, revision):
        try:
            await asyncio.sleep(self.policy.pacing_seconds)
            async with self._lock:
                if self.revision == revision and self.state == 'pacing':
                    await self._begin_generation()
        except asyncio.CancelledError:
            pass

    async def _speech_watchdog(self, revision):
        try:
            await asyncio.sleep(self.policy.speech_timeout)
            async with self._lock:
                if self.revision == revision and self.state == 'listening':
                    # Do not generate over an unheard/untranscribed long utterance.
                    self._invalidate()
                    await self._emit('error', code='transcript_timeout', message='말씀을 인식하지 못했습니다. 마이크를 확인하고 재개해주세요.')
                    await self._state('paused')
        except asyncio.CancelledError:
            pass

    async def _playback_watchdog(self, revision, message_id):
        try:
            await asyncio.sleep(self.policy.playback_timeout)
            async with self._lock:
                if self.revision == revision and self.state == 'speaking':
                    self._invalidate()
                    await self._interrupt_pending()
                    await self._emit('error', code='playback_timeout', message='음성 재생 완료를 확인하지 못했습니다. 다시 재개해주세요.')
                    await self._state('paused')
        except asyncio.CancelledError:
            pass

    async def close(self):
        self._connection_epoch += 1
        self._sink = None
        async with self._lock:
            self._invalidate()
            await self._interrupt_pending()
            if self.state != 'ended':
                await self._state('paused')
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

