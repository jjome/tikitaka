"""Explicit, local-only migration from an already-running Windows dev server.

No HTTP endpoint exposes this operation. The developer must create a local
save.request marker; the API key never appears in command arguments or output.
"""
import os
from pathlib import Path
import subprocess
import sys


def persist_requested_key(root: Path):
    folder = root / '.runtime' / 'credentials'
    request = folder / 'save.request'
    if sys.platform != 'win32' or not request.is_file():
        return
    if not os.environ.get('OPENAI_API_KEY'):
        (folder / 'save.status').write_text('no_key', encoding='ascii')
        return
    try:
        # Windows PowerShell 5 must build its own module path instead of
        # inheriting PowerShell 7 modules through the Python server process.
        child_environment = {key: value for key, value in os.environ.items() if key.casefold() != 'psmodulepath'}
        subprocess.run([
            str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            '-NoProfile', '-NonInteractive', '-File', str(root / 'scripts/windows-key-store.ps1'),
            '-SaveEnvironmentKey',
        ], check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=child_environment,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        request.unlink()
        (folder / 'save.status').write_text('saved', encoding='ascii')
    except (OSError, KeyError, subprocess.SubprocessError) as error:
        (folder / 'save.status').write_text('failed', encoding='ascii')
        (folder / 'save.error-type').write_text(type(error).__name__, encoding='ascii')
