import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from backend.app.local_credentials import persist_requested_key


class LocalCredentialsTests(unittest.TestCase):
    def test_no_marker_does_not_persist_anything(self):
        with tempfile.TemporaryDirectory() as directory, patch('backend.app.local_credentials.subprocess.run') as run:
            persist_requested_key(Path(directory))
            run.assert_not_called()

    def test_explicit_request_saves_without_key_in_arguments_or_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / '.runtime/credentials'; folder.mkdir(parents=True)
            (folder / 'save.request').touch()
            with patch('backend.app.local_credentials.sys.platform', 'win32'), patch.dict(os.environ, {
                'OPENAI_API_KEY': 'test-only-secret', 'SystemRoot': 'C:/Windows', 'PSModulePath': 'incompatible-test-modules',
            }), patch('backend.app.local_credentials.subprocess.run') as run:
                persist_requested_key(root)
            self.assertEqual((folder / 'save.status').read_text(), 'saved')
            self.assertFalse((folder / 'save.request').exists())
            args, kwargs = run.call_args
            self.assertNotIn('test-only-secret', repr(args))
            self.assertEqual(kwargs['stdout'], subprocess.DEVNULL)
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            self.assertFalse(any(key.casefold() == 'psmodulepath' for key in kwargs['env']))

    def test_failed_save_retains_request_and_does_not_log_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / '.runtime/credentials'; folder.mkdir(parents=True)
            (folder / 'save.request').touch()
            with patch('backend.app.local_credentials.sys.platform', 'win32'), patch.dict(os.environ, {
                'OPENAI_API_KEY': 'test-only-secret', 'SystemRoot': 'C:/Windows',
            }), patch('backend.app.local_credentials.subprocess.run', side_effect=OSError('private-error')):
                persist_requested_key(root)
            self.assertEqual((folder / 'save.status').read_text(), 'failed')
            self.assertTrue((folder / 'save.request').exists())
