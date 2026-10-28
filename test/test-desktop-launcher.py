"""Launcher installation in a disposable home directory."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).resolve().parents[1] / 'install_desktop.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTest(unittest.TestCase):
    def test_idempotent_install_and_unrelated_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            data = home / 'data'
            with patch.object(launcher.os, 'geteuid', return_value=1000), \
                 patch.object(launcher.Path, 'home', return_value=home), \
                 patch.object(launcher.shutil, 'which', return_value=None), \
                 patch.dict(os.environ, {'XDG_DATA_HOME': str(data)}), \
                 contextlib.redirect_stdout(io.StringIO()):
                launcher.install()
                menu = data / 'applications' / launcher.NAME
                desktop = home / 'Desktop' / launcher.NAME
                self.assertEqual(menu.read_text(), desktop.read_text())
                self.assertEqual(desktop.stat().st_mode & 0o777, 0o755)
                original = menu.read_text()
                launcher.install()
                self.assertEqual(menu.read_text(), original)
                menu.write_text('unrelated')
                with self.assertRaises(RuntimeError):
                    launcher.install()
                self.assertEqual(menu.read_text(), 'unrelated')

    def test_paths(self):
        entry = launcher.desktop_entry(Path('/tmp/RDP App'))
        self.assertIn('"/tmp/RDP App/control_panel.py"', entry)
        self.assertEqual(launcher.exec_quote('/tmp/100%'), '"/tmp/100%%"')
        with self.assertRaises(ValueError):
            launcher.exec_quote('/tmp/new\nline')


if __name__ == '__main__':
    unittest.main()
