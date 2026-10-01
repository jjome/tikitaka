import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import secrets
import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException, Header, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .content import TOPICS, PERSONAS
from .domain import DomainError, Policy
from .engine import ConversationEngine
from .gateway import configured_gateway
from .repository import SessionRepository

ROOT = Path(__file__).resolve().parents[2]


class SessionCreate(BaseModel):
    topic_id: str = Field(default='food', max_length=30)
    language: Literal['ko', 'en'] = 'ko'


def create_app(db_path=None, gateway=None, policy=None):
    engines = {}

    @asynccontextmanager
    async def lifespan(app):
        app.state.repository = SessionRepository(db_path or os.getenv('TIKITAKA_DB', str(ROOT / '.runtime/sessions.sqlite3')))
        app.state.gateway = gateway or configured_gateway()
        app.state.engines = engines
        yield
        for engine in engines.values():
            await engine.close()
        await app.state.gateway.close()
        app.state.repository.close()

    app = FastAPI(title='Tikitaka PC Voice Prototype', lifespan=lifespan)

    def authorized_engine(session_id, token):
        repo = app.state.repository
        if not isinstance(token, str) or not token or not repo.authorize(session_id, token):
            raise HTTPException(404, '세션을 찾을 수 없습니다.')
        if session_id not in engines:
            saved = repo.load(session_id)
            engine = ConversationEngine(session_id, saved['topic_id'], saved['language'],
                                        app.state.gateway, repo, policy, restored=saved)
            engines[session_id] = engine
            repo.save(session_id, engine.snapshot())
        return engines[session_id]

    @app.get('/api/health')
    async def health():
        return {'status': 'ok', 'mode': app.state.gateway.mode}

    @app.get('/api/config')
    async def config():
        return {'mode': app.state.gateway.mode,
                'topics': [{'id': key, 'ko': v['ko'], 'en': v['en']} for key, v in TOPICS.items()],
                'personas': [{'id': p.id, 'name': p.name, 'name_en': p.name_en, 'role': p.role} for p in PERSONAS.values()]}

    @app.post('/api/sessions', status_code=201)
    async def create_session(body: SessionCreate):
        if body.topic_id not in TOPICS:
            raise HTTPException(422, '지원하지 않는 주제입니다.')
        # This endpoint is for loopback development, not public anonymous hosting.
        if len(engines) >= 100:
            raise HTTPException(429, '개발 세션 상한에 도달했습니다. 서버를 다시 시작하세요.')
        sid, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
        engine = ConversationEngine(sid, body.topic_id, body.language, app.state.gateway,
                                    app.state.repository, policy)
        app.state.repository.create(sid, token, engine.snapshot())
        engines[sid] = engine
        return {'id': sid, 'token': token, 'snapshot': engine.snapshot()}

    @app.get('/api/sessions/{session_id}')
    async def get_session(session_id: str, x_session_token: str | None = Header(default=None)):
        return authorized_engine(session_id, x_session_token).snapshot()

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

    return app


app = create_app()

