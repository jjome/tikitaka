import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import secrets
import time
import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException, Header, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ConfigDict

from .content import TOPICS, PERSONAS
from .domain import DomainError, Policy
from .engine import ConversationEngine
from .gateway import configured_gateway
from .repository import SessionRepository
from .audio import OpenAIAudio, MAX_AUDIO_BYTES, validate_wav

ROOT = Path(__file__).resolve().parents[2]


class SessionCreate(BaseModel):
    topic_id: str = Field(default='auto', max_length=30)
    language: Literal['ko', 'en'] = 'ko'


class AudioDiagnostics(BaseModel):
    model_config = ConfigDict(extra='forbid')
    build: str = Field(max_length=50)
    source: str = Field(default='', max_length=160)
    context_state: str = Field(default='', max_length=30)
    track_state: str = Field(default='', max_length=30)
    muted: bool = False
    enabled: bool = True
    peak: float = Field(ge=0, le=1, allow_inf_nan=False)
    frames: int = Field(ge=0, le=1000000)
    speech_starts: int = Field(ge=0, le=1000000)
    results: int = Field(ge=0, le=1000000)
    recognition_error: str = Field(default='', max_length=50)


def create_app(db_path=None, gateway=None, policy=None, audio_gateway=None):
    engines = {}
    audio_busy = set()

    async def expire_sessions():
        for sid in app.state.repository.expired_ids():
            engine = engines.pop(sid, None)
            if engine:
                await engine.close()
            app.state.repository.delete(sid)

    async def cleanup_loop():
        while True:
            await asyncio.sleep(60)
            await expire_sessions()

    async def release_idle_engines():
        # Snapshots remain restorable; only inactive controllers leave memory.
        for sid, engine in list(engines.items()):
            if ((engine.state == 'ended' or engine.state == 'paused' and engine._sink is None)
                    and not any(key[0] == sid for key in audio_busy)):
                await engine.close()
                engines.pop(sid, None)

    @asynccontextmanager
    async def lifespan(app):
        app.state.repository = SessionRepository(db_path or os.getenv('TIKITAKA_DB', str(ROOT / '.runtime/sessions.sqlite3')))
        app.state.gateway = gateway or configured_gateway()
        app.state.audio = audio_gateway or (OpenAIAudio(os.getenv('OPENAI_API_KEY'))
            if app.state.gateway.mode == 'openai' and os.getenv('OPENAI_API_KEY') else None)
        app.state.engines = engines
        await expire_sessions()
        cleanup = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            cleanup.cancel()
            await asyncio.gather(cleanup, return_exceptions=True)
            for engine in engines.values():
                await engine.close()
            await app.state.gateway.close()
            if app.state.audio:
                await app.state.audio.close()
            app.state.repository.close()

    app = FastAPI(title='Tikitaka Voice API', lifespan=lifespan)

    @app.middleware('http')
    async def development_cache(request, call_next):
        response = await call_next(request)
        if request.url.path in {'/', '/lab', '/mic'} or request.url.path.startswith(('/assets/', '/api/')):
            response.headers['Cache-Control'] = 'no-store'
        return response

    def authorized_engine(session_id, token):
        repo = app.state.repository
        if not isinstance(token, str) or not token or not repo.authorize(session_id, token):
            raise HTTPException(404, '세션을 찾을 수 없습니다.')
        if session_id not in engines:
            saved = repo.load(session_id)
            if saved is None:
                raise HTTPException(404, '세션을 찾을 수 없습니다.')
            if len(engines) >= 100:
                raise HTTPException(429, '현재 대화가 많습니다. 잠시 후 다시 시도해주세요.')
            engine = ConversationEngine(session_id, saved['topic_id'], saved['language'],
                                        app.state.gateway, repo, policy, restored=saved)
            engines[session_id] = engine
            repo.save(session_id, engine.snapshot())
        return engines[session_id]

    @app.get('/api/health')
    async def health():
        return {'status': 'ok', 'mode': app.state.gateway.mode,
                'voice_transport': 'api' if app.state.audio else 'browser'}

    @app.get('/api/config')
    async def config():
        return {'mode': app.state.gateway.mode,
                'voice_transport': 'api' if app.state.audio else 'browser',
                'default_language': 'en' if os.getenv('TIKITAKA_LANGUAGE') == 'en' else 'ko',
                'topics': [{'id': key, 'ko': v['ko'], 'en': v['en']} for key, v in TOPICS.items()],
                'personas': [{'id': p.id, 'name': p.name, 'name_en': p.name_en, 'role': p.role} for p in PERSONAS.values()]}

    @app.post('/api/sessions', status_code=201)
    async def create_session(body: SessionCreate):
        topic_id = secrets.choice(list(TOPICS)) if body.topic_id == 'auto' else body.topic_id
        if topic_id not in TOPICS:
            raise HTTPException(422, '지원하지 않는 주제입니다.')
        # This endpoint is for loopback development, not public anonymous hosting.
        await release_idle_engines()
        if len(engines) >= 100:
            raise HTTPException(429, '현재 대화가 많습니다. 잠시 후 다시 시도해주세요.')
        sid, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
        engine = ConversationEngine(sid, topic_id, body.language, app.state.gateway,
                                    app.state.repository, policy)
        app.state.repository.create(sid, token, engine.snapshot())
        engines[sid] = engine
        return {'id': sid, 'token': token, 'snapshot': engine.snapshot()}

    @app.get('/api/sessions/{session_id}')
    async def get_session(session_id: str, x_session_token: str | None = Header(default=None)):
        return authorized_engine(session_id, x_session_token).snapshot()

    @app.delete('/api/sessions/{session_id}', status_code=204)
    async def delete_session(session_id: str, x_session_token: str | None = Header(default=None)):
        engine = authorized_engine(session_id, x_session_token)
        if engine.state != 'ended':
            await engine.handle({'type': 'end'})
        await engine.close()
        engines.pop(session_id, None)
        app.state.repository.delete(session_id)

    @app.post('/api/sessions/{session_id}/audio-diagnostics', status_code=204)
    async def audio_diagnostics(session_id: str, body: AudioDiagnostics,
                                x_session_token: str | None = Header(default=None)):
        authorized_engine(session_id, x_session_token)
        app.state.repository.save_audio_diagnostics(session_id, {'at': time.time(), **body.model_dump()})

    def audio_engine(session_id, token, kind):
        engine = authorized_engine(session_id, token)
        if not app.state.audio:
            raise HTTPException(503, '음성 API 서버를 실행해주세요.')
        if engine.state in {'paused', 'ended'} or time.time() - engine.created_at >= engine.policy.max_session_seconds:
            raise HTTPException(409, '대화가 정지되어 있습니다.')
        if (session_id, kind) in audio_busy:
            raise HTTPException(409, '이전 음성을 처리하고 있습니다.')
        if engine.stats.get(kind, 0) >= engine.policy.max_calls:
            raise HTTPException(429, '음성 요청 상한에 도달했습니다. 새 대화를 시작해주세요.')
        return engine

    async def connected_audio(request, operation, engine):
        task = asyncio.create_task(operation)
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=.2)
                if engine.state in {'paused', 'ended'}:
                    raise HTTPException(409, '대화가 정지되어 있습니다.')
                if done:
                    return await task
                if await request.is_disconnected():
                    raise HTTPException(499, '음성 요청이 취소되었습니다.')
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    @app.post('/api/sessions/{session_id}/transcriptions')
    async def transcribe(session_id: str, request: Request, x_session_token: str | None = Header(default=None)):
        engine = audio_engine(session_id, x_session_token, 'transcriptions')
        audio_busy.add((session_id, 'transcriptions'))
        try:
            if request.headers.get('content-type', '').split(';')[0] != 'audio/wav':
                raise HTTPException(415, 'WAV 음성 데이터가 필요합니다.')
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_AUDIO_BYTES:
                    raise HTTPException(413, '한 번에 20초 이내로 말씀해주세요.')
                data.extend(chunk)
            validate_wav(data)
            # Count failed provider attempts too; do not persist the audio itself.
            engine.stats['transcriptions'] = engine.stats.get('transcriptions', 0) + 1
            engine._save()
            text = await connected_audio(request, app.state.audio.transcribe(bytes(data), engine.language), engine)
            return {'text': text}
        except DomainError as exc:
            raise HTTPException(502, str(exc)) from None
        finally:
            audio_busy.discard((session_id, 'transcriptions'))

    @app.post('/api/sessions/{session_id}/speech/{message_id}')
    async def speech(session_id: str, message_id: str, request: Request, x_session_token: str | None = Header(default=None)):
        engine = audio_engine(session_id, x_session_token, 'speech_calls')
        message = next((m for m in engine.messages if m.id == message_id), None)
        if not message or message.speaker not in {'a', 'b'} or message.delivery != 'pending':
            raise HTTPException(409, '재생할 AI 응답이 없습니다.')
        audio_busy.add((session_id, 'speech_calls'))
        try:
            engine.stats['speech_calls'] = engine.stats.get('speech_calls', 0) + 1
            engine._save()
            data = await connected_audio(request, app.state.audio.speak(message.text, message.speaker, engine.language), engine)
            if message.delivery != 'pending' or engine.state != 'speaking':
                raise HTTPException(409, '중단된 AI 응답입니다.')
            return Response(data, media_type='audio/mpeg', headers={'Cache-Control': 'no-store'})
        except DomainError as exc:
            raise HTTPException(502, str(exc)) from None
        finally:
            audio_busy.discard((session_id, 'speech_calls'))

    @app.websocket('/api/sessions/{session_id}/events')
    async def session_events(ws: WebSocket, session_id: str):
        # Same-origin browser client or a native client with no Origin.
        origin = ws.headers.get('origin')
        if origin and origin not in {f'http://{ws.headers.get("host")}', f'https://{ws.headers.get("host")}'}:
            await ws.close(code=1008)
            return
        await ws.accept()
        engine, epoch = None, None
        send_lock = asyncio.Lock()

        async def send(event):
            async with send_lock:
                await asyncio.wait_for(ws.send_json(event), 2)

        try:
            auth = await asyncio.wait_for(ws.receive_json(), 5)
            if not isinstance(auth, dict) or auth.get('type') != 'authenticate':
                await ws.close(code=1008)
                return
            try:
                engine = authorized_engine(session_id, auth.get('token'))
            except HTTPException:
                await ws.close(code=1008)
                return
            epoch = await engine.attach(send)
            while True:
                raw = await asyncio.wait_for(ws.receive_text(), (policy or Policy()).heartbeat_timeout + 2)
                if len(raw) > 8192:
                    await ws.close(code=1009)
                    return
                import json
                try:
                    command = json.loads(raw)
                    if not isinstance(command, dict) or not isinstance(command.get('type'), str):
                        raise ValueError()
                    await engine.handle(command, epoch)
                except (ValueError, TypeError):
                    await send({'type': 'error', 'code': 'invalid_command', 'message': '요청 형식을 확인하세요.'})
                except DomainError as exc:
                    await send({'type': 'error', 'code': exc.code, 'message': str(exc)})
                    if exc.code == 'stale_connection':
                        await ws.close(code=1008)
                        return
        except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
            pass
        finally:
            if engine and epoch is not None:
                await engine.disconnect(epoch)

    web_path = ROOT / 'apps/pc'
    if web_path.exists():
        app.mount('/assets', StaticFiles(directory=web_path), name='assets')

        @app.get('/')
        async def index():
            return FileResponse(web_path / 'index.html')

        @app.get('/lab')
        async def lab():
            return FileResponse(web_path / 'lab.html')

        @app.get('/mic')
        async def mic():
            return FileResponse(web_path / 'mic.html')

    return app


app = create_app()

