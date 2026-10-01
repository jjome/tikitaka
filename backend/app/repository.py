"""Local durable session snapshots. No credentials or raw audio are stored."""
import hashlib
import json
import secrets
import sqlite3
from pathlib import Path


class SessionRepository:
    def __init__(self, path: str | Path):
        if str(path) != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, payload TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS audio_diagnostics (session_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        self.db.commit()

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def create(self, session_id, token, payload):
        self.db.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                        (session_id, self.digest(token), json.dumps(payload, ensure_ascii=False)))
        self.db.commit()

    def authorize(self, session_id, token):
        row = self.db.execute('SELECT token_hash FROM sessions WHERE id=?', (session_id,)).fetchone()
        return bool(row and secrets.compare_digest(row[0], self.digest(token)))

    def load(self, session_id):
        row = self.db.execute('SELECT payload FROM sessions WHERE id=?', (session_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, session_id, payload):
        self.db.execute('UPDATE sessions SET payload=? WHERE id=?',
                        (json.dumps(payload, ensure_ascii=False), session_id))
        self.db.commit()

    def close(self):
        self.db.close()

    def save_audio_diagnostics(self, session_id, payload):
        self.db.execute('INSERT OR REPLACE INTO audio_diagnostics VALUES (?, ?)',
                        (session_id, json.dumps(payload, ensure_ascii=False)))
        self.db.commit()

