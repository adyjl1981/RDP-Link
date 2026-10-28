"""Guided installation tests; host packages, Docker and services are mocked."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import contextlib

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import control_panel as panel


def result(stdout='', code=0):
    return subprocess.CompletedProcess([], code, stdout, '')


class InstallationTest(unittest.TestCase):
    def test_existing_env_default_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'SECRET=keep\nRDP_TARGETS=custom:3390\n'
            (root / '.env').write_text(original)
            with patch.object(installer, 'REPO', root), patch('builtins.input', return_value=''):
                installer.prepare_env(panel)
            self.assertEqual((root / '.env').read_text(), original)

    def test_new_config_and_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env.example').write_text('PUBLIC_ORIGINS=http://localhost:8080\nKEEP=value\n')
            with patch.object(installer, 'REPO', root), patch.object(panel, 'REPO', root):
                with patch('builtins.input', side_effect=['host.docker.internal', '3390', '']):
                    installer.prepare_env(panel)
                text = (root / '.env').read_text()
                self.assertIn('RDP_TARGETS=host.docker.internal:3390', text)
                self.assertIn('RDP_IGNORE_CERT=false', text)
                self.assertIn('KEEP=value', text)
                self.assertEqual((root / '.env').stat().st_mode & 0o777, 0o600)
                with patch('builtins.input', side_effect=['y', 'bad\nKEY=value']):
                    with self.assertRaises(RuntimeError):
                        installer.prepare_env(panel)
                self.assertEqual((root / '.env').read_text(), text)

    def test_docker_group_pause_and_remote_rejection(self):
        calls = []
        def run(*args, **kwargs):
            calls.append(args)
            if args[:3] == ('docker', 'context', 'inspect'):
                return result('unix:///var/run/docker.sock')
            if args == ('docker', 'info'):
                return result(code=1)
            if args == ('id', '-un'):
                return result('rdpuser\n')
            return result()
        with patch.object(installer.shutil, 'which', return_value='/bin/tool'), \
             patch.object(installer, 'command', side_effect=run), \
             patch.object(installer.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=99999)), \
             patch.object(installer.os, 'getgroups', return_value=[]), \
             patch.dict(installer.os.environ, {'DOCKER_HOST': ''}), \
             patch('builtins.input', return_value='y'):
            self.assertFalse(installer.docker_ready())
            self.assertIn(('sudo', 'usermod', '-aG', 'docker', 'rdpuser'), calls)
            with patch.dict(installer.os.environ, {'DOCKER_HOST': 'tcp://remote.example:2376'}):
                with self.assertRaises(RuntimeError):
                    installer.docker_ready()

    def test_apt_cannot_remove_existing_packages(self):
        with patch.object(installer, 'command') as command, patch('builtins.input', return_value='y'):
            installer.apt_install(['docker.io', 'docker-compose-v2'])
            self.assertIn('--no-remove', command.call_args.args)
        with patch.object(installer, 'command') as command, patch('builtins.input', return_value=''):
            with self.assertRaises(RuntimeError):
                installer.apt_install(['docker.io'])
            command.assert_not_called()

    def test_access_default_keeps_settings(self):
        fake = Mock()
        with patch('builtins.input', return_value=''):
            installer.choose_access(fake)
        fake.apply_access.assert_not_called()

    def test_tailscale_conflict_blocks_serve_mutation(self):
        fake = Mock(TARGET='http://127.0.0.1:8080')
        fake.serve_ownership.side_effect = RuntimeError('conflicting route')
        calls = []
        def run(*args, **kwargs):
            calls.append(args)
            if args == ('tailscale', 'status', '--json'):
                return result(json.dumps({'BackendState': 'Running', 'Self': {'DNSName': 'desktop.example.ts.net.'}}))
            return result('{}')
        with patch.object(installer.shutil, 'which', return_value='/bin/tailscale'), \
             patch.object(installer, 'command', side_effect=run):
            with self.assertRaises(RuntimeError):
                installer.tailscale_setup(fake)
        self.assertFalse(any(call[:3] == ('sudo', 'tailscale', 'serve') for call in calls))
        fake.apply_access.assert_not_called()

    def test_main_decline_or_accept_build(self):
        for build in ('', 'y'):
            with self.subTest(build=build), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'compose.yaml').touch()
                fake = types.SimpleNamespace(REPO=root, admin=None)
                with patch.object(installer, 'REPO', root), \
                     patch.object(installer.os, 'geteuid', return_value=1000), \
                     patch.object(installer.sys.stdin, 'isatty', return_value=True), \
                     patch.object(installer.platform, 'freedesktop_os_release', return_value={'ID': 'ubuntu'}), \
                     patch.object(installer, 'desktop_dependencies'), \
                     patch.object(installer, 'docker_ready', return_value=True), \
                     patch.object(installer, 'prepare_env'), \
                     patch.object(installer, 'command') as command, \
                     patch.object(installer, 'choose_access') as access, \
                     patch.object(installer, 'boot_setup') as boot, \
                     patch.dict(sys.modules, {'control_panel': fake}), \
                     patch.object(sys, 'argv', ['install.py']), \
                     patch('builtins.input', side_effect=['', build]):
                    installer.main()
                    if build:
                        access.assert_called_once_with(fake)
                        boot.assert_called_once_with(fake)
                        self.assertIn((('docker', 'compose', 'up', '--build', '-d'), {}), command.call_args_list)
                    else:
                        access.assert_not_called()
                        boot.assert_not_called()

    def test_fresh_docker_and_first_tailscale_setup(self):
        def docker_command(*args, **kwargs):
            if args[:3] == ('docker', 'context', 'inspect'):
                return result('unix:///var/run/docker.sock')
            return result()
        with patch.object(installer.shutil, 'which', return_value=None), \
             patch.object(installer, 'apt_install') as apt, \
             patch.object(installer, 'command', side_effect=docker_command) as command, \
             patch.dict(installer.os.environ, {'DOCKER_HOST': ''}):
            self.assertTrue(installer.docker_ready())
            apt.assert_called_once_with(['docker.io', 'docker-compose-v2'])
            self.assertIn((('sudo', 'systemctl', 'enable', '--now', 'docker.service'), {}),
                          command.call_args_list)
        fake = Mock(TARGET='http://127.0.0.1:8080')
        def tailscale_command(*args, **kwargs):
            if args == ('tailscale', 'status', '--json'):
                return result(json.dumps({'BackendState': 'Running', 'Self': {'DNSName': 'desktop.example.ts.net.'}}))
            return result('{}')
        with patch.object(installer.shutil, 'which', return_value=None), \
             patch.object(installer, 'command', side_effect=tailscale_command) as command, \
             patch('builtins.input', side_effect=['y', '']):
            installer.tailscale_setup(fake)
            fake.apply_access.assert_called_once_with('tailscale', '')
            self.assertIn((('sudo', 'tailscale', 'serve', '--bg', '--https=443', fake.TARGET), {}),
                          command.call_args_list)

    def test_boot_default_does_not_enable_existing_service(self):
        fake = Mock()
        fake.service_info.return_value = {'LoadState': 'loaded'}
        with patch.object(installer, 'command') as command, patch('builtins.input', return_value=''):
            installer.boot_setup(fake)
            fake.check_service_repo.assert_called_once()
            command.assert_not_called()
        fake.service_info.return_value = {'LoadState': 'not-found'}
        with patch.object(installer, 'command') as command:
            installer.boot_setup(fake)
            command.assert_called_once_with('bash', str(installer.REPO / 'setup.sh'))

    def test_check_does_not_mutate(self):
        with patch.object(installer.shutil, 'which', return_value='/bin/tool'), \
             patch.object(installer, 'command', return_value=result()) as command:
            installer.check_only()
        for call in command.call_args_list:
            self.assertIn(call.args, [('docker', 'compose', 'version'), ('docker', 'info')])


if __name__ == '__main__':
    with contextlib.redirect_stdout(io.StringIO()):
        unittest.main()
