"""Control-panel backend tests; no host service or network changes."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('panel', Path(__file__).resolve().parents[1] / 'control_panel.py')
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)


class ControlPanelTests(unittest.TestCase):
    def test_serve_guards(self):
        own = {'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Proxy': panel.TARGET}}}},
               'TCP': {'443': {'HTTPS': True}}}
        self.assertTrue(panel.serve_ownership(own, 'pc.ts.net'))
        self.assertFalse(panel.serve_ownership({}, 'pc.ts.net'))
        for config in [dict(own, AllowFunnel={'pc.ts.net:443': True}),
                       {'TCP': {'443': {'TCPForward': 'localhost:22'}}},
                       {'Web': {'other.ts.net:443': {}}},
                       {'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Path': '/tmp'}}}}}]:
            with self.assertRaises(RuntimeError):
                panel.serve_ownership(config, 'pc.ts.net')

    def test_env_preserves_secrets_and_replaces_duplicate_keys(self):
        original = 'SECRET=unchanged\n# comment\nPUBLIC_ORIGINS=old\nexport PUBLIC_ORIGINS=duplicate\n'
        updated = panel.env_updated(original, {'PUBLIC_ORIGINS': 'http://192.168.1.3:8080'})
        self.assertIn('SECRET=unchanged\n# comment', updated)
        self.assertEqual(updated.count('PUBLIC_ORIGINS='), 1)

    def test_lan_apply_and_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / '.env'
            original = 'SECRET=test\n'
            env.write_text(original)
            calls = []
            def run(*args, **kwargs):
                calls.append(args)
                if args == ('hostname', '-I'):
                    return '192.168.1.3'
                return ''
            with patch.object(panel, 'REPO', root), patch.object(panel.shutil, 'which', return_value=None), \
                 patch.object(panel, 'run', side_effect=run):
                panel.apply_access('lan', '192.168.1.3')
                self.assertIn('RDP_BIND_ADDRESS=192.168.1.3', env.read_text())
                self.assertEqual(env.stat().st_mode & 0o777, 0o600)
                self.assertIn(('docker', 'compose', 'up', '-d'), calls)
                with self.assertRaises(RuntimeError):
                    panel.apply_access('lan', '8.8.8.8')
                with self.assertRaises(RuntimeError):
                    panel.apply_access('lan', '192.168.1.99')
                env.write_text(original)
                def failing(*args, **kwargs):
                    if args == ('docker', 'compose', 'up', '-d'):
                        raise RuntimeError('failure')
                    return run(*args, **kwargs)
                with patch.object(panel, 'run', side_effect=failing):
                    with self.assertRaises(RuntimeError):
                        panel.apply_access('lan', '192.168.1.3')
                self.assertEqual(env.read_text(), original)

    def test_tailscale_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text('SECRET=test\n')
            def run(*args, **kwargs):
                if args == ('tailscale', 'status', '--json'):
                    return json.dumps({'BackendState': 'Running', 'Self': {'DNSName': 'pc.ts.net.'}})
                if args == ('tailscale', 'serve', 'status', '--json'):
                    return '{}'
                return ''
            with patch.object(panel, 'REPO', root), patch.object(panel.shutil, 'which', return_value='/bin/tailscale'), \
                 patch.object(panel, 'run', side_effect=run), patch.object(panel, 'admin') as admin:
                panel.apply_access('tailscale', '')
                self.assertIn('PUBLIC_ORIGINS=https://pc.ts.net', (root / '.env').read_text())
                self.assertIn('RDP_BIND_ADDRESS=127.0.0.1', (root / '.env').read_text())
                admin.assert_called_once_with('tailscale', 'serve', '--bg', '--https=443', panel.TARGET)

    def test_outside_lan_status(self):
        state = {'BackendState': 'Running'}
        config = {'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Proxy': panel.TARGET}}}}}
        self.assertIn('Enabled (private Tailscale)', panel.outside_access_status(state, config))
        self.assertIn('https://pc.ts.net/', panel.outside_access_status(state, config))
        self.assertIn('Disabled', panel.outside_access_status(state, {}))
        self.assertIn('disconnected', panel.outside_access_status({}, config))
        config['AllowFunnel'] = {'pc.ts.net:443': True}
        self.assertIn('public Funnel', panel.outside_access_status(state, config))
        unrelated = {'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://localhost:3000'}}}}}
        self.assertIn('Disabled', panel.outside_access_status(state, unrelated))

    def test_service_checkout_guard(self):
        with self.assertRaises(RuntimeError):
            panel.check_service_repo({'LoadState': 'loaded', 'WorkingDirectory': '/other'})


if __name__ == '__main__':
    unittest.main()
