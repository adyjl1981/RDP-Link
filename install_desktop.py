#!/usr/bin/env python3
"""Install this checkout's desktop and application-menu launchers for the current user."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent
NAME = 'org.rdp-link.ControlPanel.desktop'
MARKER = 'X-RDP-Link-Managed=true'


def exec_quote(value):
    if '\n' in value or '\r' in value:
        raise ValueError('Launcher paths cannot contain newlines.')
    escapes = {'\\': '\\\\\\\\', '"': '\\\\"', '`': '\\\\`', '$': '\\\\$'}
    return '"' + ''.join(escapes.get(c, c) for c in value).replace('%', '%%') + '"'


def desktop_entry(repo=REPO):
    return '\n'.join([
        '[Desktop Entry]', 'Type=Application', 'Version=1.0', 'Name=RDP-Link',
        'Comment=Control RDP-Link, boot startup and private remote access',
        f'Exec={exec_quote(sys.executable)} {exec_quote(str(repo / "control_panel.py"))}',
        'Icon=computer', 'Terminal=false',
        'Categories=Network;RemoteAccess;', 'Keywords=RDP;Remote Desktop;Tailscale;',
        'StartupNotify=false', MARKER, '',
    ])


def install():
    if os.geteuid() == 0:
        raise RuntimeError('Run as your normal desktop user, without sudo.')
    data = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
    if not data.is_absolute():
        raise RuntimeError('XDG_DATA_HOME must be an absolute path.')
    desktop = Path.home() / 'Desktop'
    if shutil.which('xdg-user-dir'):
        result = subprocess.run(['xdg-user-dir', 'DESKTOP'], text=True, capture_output=True, check=True)
        candidate = Path(result.stdout.strip())
        if candidate.is_absolute() and candidate != Path.home():
            desktop = candidate
    destinations = [data / 'applications' / NAME, desktop / NAME]
    for path in destinations:
        if path.exists() and MARKER not in path.read_text().splitlines():
            raise RuntimeError(f'Refusing to overwrite an unrelated launcher: {path}')
    entry = desktop_entry()
    for path in destinations:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.rdp-link-')
        try:
            with os.fdopen(fd, 'w') as stream:
                stream.write(entry)
            os.chmod(temporary, 0o755)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print(f'Installed: {path}')
    if shutil.which('gio'):
        result = subprocess.run(['gio', 'set', str(destinations[1]), 'metadata::trusted', 'true'],
                                text=True, capture_output=True)
        if result.returncode:
            print('Desktop may require right-click → Allow Launching.')
    if shutil.which('update-desktop-database'):
        subprocess.run(['update-desktop-database', str(data / 'applications')], check=True)


if __name__ == '__main__':
    install()
