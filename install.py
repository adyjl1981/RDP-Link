#!/usr/bin/env python3
"""Interactive Ubuntu installer. Run as a normal user from the web checkout."""
import argparse
import grp
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent


def ask(message):
    return input(message + ' [y/N] ').strip().lower() in ('y', 'yes')


def command(*args, capture=False, check=True):
    result = subprocess.run(args, cwd=REPO, text=True, check=False,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed. Resolve the error and rerun ./install.py. '
                           'Existing settings have not been reset.')
    return result


def apt_install(packages):
    print('Required Ubuntu packages: ' + ', '.join(packages))
    if not ask('Install these packages using sudo?'):
        raise RuntimeError('Required packages were declined. Install them manually, then rerun.')
    command('sudo', 'apt-get', 'update')
    command('sudo', 'apt-get', 'install', '--no-remove', '-y', *packages)


def desktop_dependencies():
    missing = []
    if importlib.util.find_spec('tkinter') is None:
        missing.append('python3-tk')
    for tool, package in [('pkexec', 'pkexec'), ('xdg-user-dir', 'xdg-user-dirs'),
                          ('x-terminal-emulator', 'xterm'), ('curl', 'curl'),
                          ('update-desktop-database', 'desktop-file-utils')]:
        if not shutil.which(tool):
            missing.append(package)
    if missing:
        apt_install(missing)


def docker_ready():
    if not shutil.which('docker'):
        print('A fresh Docker installation uses Ubuntu packages docker.io and docker-compose-v2.\n'
              'APT is forbidden from removing packages; existing conflicting installations need manual review.')
        apt_install(['docker.io', 'docker-compose-v2'])
        command('sudo', 'systemctl', 'enable', '--now', 'docker.service')
    if command('docker', 'compose', 'version', capture=True, check=False).returncode:
        ce = command('dpkg-query', '-W', '-f=${Status}', 'docker-ce', capture=True, check=False)
        distro = command('dpkg-query', '-W', '-f=${Status}', 'docker.io', capture=True, check=False)
        if 'install ok installed' in (ce.stdout or ''):
            apt_install(['docker-compose-plugin'])
        elif 'install ok installed' in (distro.stdout or ''):
            apt_install(['docker-compose-v2'])
        else:
            raise RuntimeError('Install the Compose plugin matching your Docker installation; see USER_MANUAL.md.')
        command('docker', 'compose', 'version', capture=True)
    endpoint = os.environ.get('DOCKER_HOST') or command(
        'docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', capture=True).stdout.strip()
    if endpoint not in ('unix:///var/run/docker.sock', 'unix:///run/docker.sock'):
        raise RuntimeError('Use the local system Docker daemon; remote/rootless/Desktop contexts are not supported.')
    if command('docker', 'info', capture=True, check=False).returncode == 0:
        return True
    print('Docker is not accessible to this login. The app needs Docker access without sudo.')
    try:
        group = grp.getgrnam('docker')
    except KeyError:
        raise RuntimeError('No docker group exists. Review your Docker installation.')
    if group.gr_gid not in os.getgroups():
        print('Docker group membership grants extensive control over this machine.')
        if ask('Add your current account to the docker group?'):
            command('sudo', 'usermod', '-aG', 'docker', command('id', '-un', capture=True).stdout.strip())
            print('Sign out of Ubuntu completely, sign back in, then rerun ./install.py.\n'
                  'No app configuration or containers have been changed.')
            return False
        raise RuntimeError('Docker access is required. See the manual before continuing.')
    if ask('Try starting the system Docker service?'):
        command('sudo', 'systemctl', 'start', 'docker.service')
        command('docker', 'info', capture=True)
        return True
    raise RuntimeError('Docker remains unavailable. Check its service and login permissions.')


def prepare_env(panel):
    path = REPO / '.env'
    if path.is_symlink():
        raise RuntimeError('Refusing to replace a symlinked .env; manage it manually.')
    existing = path.exists()
    if existing:
        print('Existing .env found. Its contents will not be displayed or reset.')
        if not ask('Edit the RDP destination and certificate setting?'):
            return
        text = path.read_text()
    else:
        text = (REPO / '.env.example').read_text()
    print('In Ubuntu Settings → System → Remote Desktop, enable sharing/login and note its port.\n'
          'The default destination is the Ubuntu machine hosting Docker. Never enter an RDP password here.')
    host = input('RDP desktop hostname or IPv4 address [host.docker.internal]: ').strip() or 'host.docker.internal'
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', host):
        raise RuntimeError('Use a plain hostname or IPv4 address, without a URL, spaces or shell syntax.')
    raw_port = input('RDP port shown in Ubuntu settings [3389]: ').strip() or '3389'
    if not raw_port.isdecimal() or not 1 <= int(raw_port) <= 65535:
        raise RuntimeError('Port must be a number from 1 to 65535.')
    print('Certificate verification is enabled unless you explicitly disable it for a known self-signed desktop.')
    ignore = ask('Disable RDP certificate verification for this trusted desktop?')
    updated = panel.env_updated(text, {'RDP_TARGETS': f'{host}:{int(raw_port)}',
                                      'RDP_IGNORE_CERT': str(ignore).lower()})
    panel.write_env(updated)
    print('Private .env saved (mode 0600). Other settings were preserved.')


def tailscale_setup(panel):
    if not shutil.which('tailscale'):
        print('Tailscale is optional and needs an account and a client on the phone.\n'
              'The official installer comes from https://tailscale.com/install.sh.')
        if not ask('Download and run the official Tailscale installer?'):
            raise RuntimeError('Tailscale installation declined. Existing access settings were preserved.')
        with tempfile.TemporaryDirectory(prefix='rdp-link-tailscale-') as directory:
            script = Path(directory) / 'install.sh'
            command('curl', '-fsSL', 'https://tailscale.com/install.sh', '-o', str(script))
            if ask('View the downloaded script before running it?'):
                command('cat', str(script))
            command('sh', str(script))
        command('sudo', 'systemctl', 'enable', '--now', 'tailscaled.service')
    state = command('tailscale', 'status', '--json', capture=True, check=False)
    try:
        connected = json.loads(state.stdout or '{}').get('BackendState') == 'Running'
    except ValueError:
        connected = False
    if not connected:
        print('Follow the sign-in link below. Use the same tailnet on Ubuntu and the phone.')
        command('sudo', 'tailscale', 'up')
    state = json.loads(command('tailscale', 'status', '--json', capture=True).stdout)
    dns = state.get('Self', {}).get('DNSName', '').rstrip('.')
    if state.get('BackendState') != 'Running' or not dns:
        raise RuntimeError('Tailscale is not connected with a DNS name. Complete sign-in and rerun.')
    config = json.loads(command('tailscale', 'serve', 'status', '--json', capture=True).stdout)
    panel.serve_ownership(config, dns)
    print('The next command enables private HTTPS Serve. Follow any consent URL, then rerun if requested.')
    # Use inherited terminal I/O for first-time HTTPS consent, not the GUI subprocess wrapper.
    command('sudo', 'tailscale', 'serve', '--bg', '--https=443', panel.TARGET)
    print(panel.apply_access('tailscale', ''))
    print('Install Tailscale on the phone, connect to the same tailnet, and open the displayed HTTPS URL.\n'
          'Test from mobile data. No public Funnel or router port forwarding is configured.')


def choose_access(panel):
    print('\nAccess: Enter keeps existing settings; a new install remains local-only.\n'
          '1 = LAN only (HTTP on a trusted private network)\n'
          '2 = Outside LAN (private Tailscale HTTPS)')
    choice = input('Access choice [keep]: ').strip()
    if not choice:
        print('Access settings unchanged.')
    elif choice == '1':
        address = input('Assigned private LAN IPv4 address: ').strip()
        # Validate before any authentication or network change.
        ipaddress.IPv4Address(address)
        print(panel.apply_access('lan', address))
    elif choice == '2':
        tailscale_setup(panel)
    else:
        raise RuntimeError('Choose 1, 2 or Enter. No access change made.')


def boot_setup(panel):
    info = panel.service_info()
    if info.get('LoadState') == 'not-found':
        command('bash', str(REPO / 'setup.sh'))
    else:
        panel.check_service_repo(info)
        print('Existing boot service detected; its unit will not be replaced.')
        if ask('Enable and start the existing RDP-Link boot service?'):
            command('sudo', 'systemctl', 'enable', '--now', panel.SERVICE)
        else:
            print('Existing boot preference unchanged.')


def check_only():
    print('Read-only prerequisite check (no installation or configuration changes):')
    for tool in ('python3', 'docker', 'pkexec', 'x-terminal-emulator', 'tailscale'):
        print(f'{tool}: ' + ('found' if shutil.which(tool) else 'missing'))
    print('Tk: ' + ('found' if importlib.util.find_spec('tkinter') else 'missing'))
    print('.env: ' + ('present (contents hidden)' if (REPO / '.env').exists() else 'not created'))
    if shutil.which('docker'):
        for args in [('docker', 'compose', 'version'), ('docker', 'info')]:
            ready = command(*args, capture=True, check=False).returncode == 0
            print(' '.join(args) + ': ' + ('ready' if ready else 'unavailable'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='read-only prerequisite check')
    args = parser.parse_args()
    if args.check:
        check_only()
        return
    if os.geteuid() == 0:
        raise RuntimeError('Run ./install.py as your normal desktop user, without sudo.')
    if not sys.stdin.isatty():
        raise RuntimeError('Run interactively in an Ubuntu terminal; answers must not be piped.')
    if platform.freedesktop_os_release().get('ID') != 'ubuntu':
        raise RuntimeError('Automatic installation supports Ubuntu only; use the manual on other systems.')
    if not (REPO / 'compose.yaml').is_file():
        raise RuntimeError('Run this script from a complete web repository checkout.')
    print('RDP-Link guided installation\nExisting settings are kept unless you choose to change them.\n'
          'Building/starting or changing access can disconnect existing sessions.\n'
          'Ubuntu Remote Desktop must be enabled in Settings; this installer does not alter it.')
    desktop_dependencies()
    if not docker_ready():
        return
    # Tk is installed before importing the existing shared configuration/access logic.
    sys.dont_write_bytecode = True
    import control_panel as panel
    panel.REPO = REPO
    # Terminal authentication and Tailscale consent need inherited standard input/output.
    panel.admin = lambda *args: command('sudo', *args).stdout
    prepare_env(panel)
    command('docker', 'compose', 'config', '--quiet')
    if ask('Install or update the desktop and app-menu icons?'):
        command(sys.executable, '-B', str(REPO / 'install_desktop.py'))
    if not ask('Build/update and start the RDP-Link containers now?'):
        print('Containers unchanged. Rerun ./install.py when ready, or follow USER_MANUAL.md.')
        return
    command('docker', 'compose', 'up', '--build', '-d')
    choose_access(panel)
    boot_setup(panel)
    command('docker', 'compose', 'ps')
    print('\nSetup steps complete. Open RDP-Link from the app menu or run ./control_panel.py.\n'
          'Use the browser URL for the selected access mode; enter the RDP desktop address/port\n'
          'and credentials in its form. Consult USER_MANUAL.md for phone setup and troubleshooting.\n'
          'A running container is not proof of a working phone/RDP connection.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f'Installation stopped: {error}', file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('\nInstallation stopped. Completed steps remain; rerun to continue.', file=sys.stderr)
        sys.exit(1)
