import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.repository import SessionRepository


class RetentionTests(unittest.TestCase):
    def test_expiry_invalidates_token_and_snapshot_without_extending_on_save(self):
        repo = SessionRepository(':memory:')
        self.addCleanup(repo.close)
        with patch('backend.app.repository.time.time', return_value=1000):
            repo.create('s', 'secret-token', {'text': 'private'})
        with patch('backend.app.repository.time.time', return_value=1001):
            repo.save('s', {'text': 'updated'})
            self.assertTrue(repo.authorize('s', 'secret-token'))
        with patch('backend.app.repository.time.time', return_value=1000 + repo.RETENTION_SECONDS):
            self.assertFalse(repo.authorize('s', 'secret-token'))
            self.assertIsNone(repo.load('s'))
            self.assertEqual(repo.expired_ids(), ['s'])

    def test_delete_removes_record_diagnostics_and_access(self):
        repo = SessionRepository(':memory:')
        self.addCleanup(repo.close)
        repo.create('s', 'secret-token', {'text': 'private'})
        repo.save_audio_diagnostics('s', {'peak': .1})
        repo.delete('s')
        self.assertIsNone(repo.load('s'))
        self.assertFalse(repo.authorize('s', 'secret-token'))
        self.assertEqual(repo.db.execute('SELECT count(*) FROM audio_diagnostics').fetchone()[0], 0)

    def test_legacy_database_migration_preserves_existing_records(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'legacy.sqlite3'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, payload TEXT NOT NULL)')
            db.execute('INSERT INTO sessions VALUES (?, ?, ?)', ('s', SessionRepository.digest('token'), '{"state":"paused"}'))
            db.commit(); db.close()
            repo = SessionRepository(path)
            try:
                self.assertTrue(repo.authorize('s', 'token'))
                self.assertEqual(repo.load('s'), {'state': 'paused'})
                expires = repo.db.execute('SELECT expires_at FROM sessions').fetchone()[0]
                self.assertGreater(expires, time.time() + 6 * 24 * 60 * 60)
            finally:
                repo.close()
