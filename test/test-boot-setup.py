"""Isolated setup checks: no host Docker, sudo or systemd mutations."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'setup.sh'


class BootSetupTest(unittest.TestCase):
    def test_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix='rdp setup ') as directory:
            root = Path(directory)
            unit = root / 'rdp-link.service'
            log = root / 'calls'
            script = root / 'setup.sh'
            script.write_text(SOURCE.read_text().replace(
                'UNIT=/etc/systemd/system/rdp-link.service', f'UNIT="{unit}"'))
            (root / '.env').touch()
            (root / 'compose.yaml').write_text('services: {}\n')
            mocks = {
                'docker': 'exit 0',
                'id': 'echo rdpuser',
                'systemctl': 'echo "$*" >> "$CALLS"',
                'sudo': '''if [ "$1" = install ]; then
shift
while [ "$1" != 0644 ]; do shift; done
shift
cp "$1" "$2"
else
exec "$@"
fi''',
            }
            # Docker's executable path must not contain spaces; repo paths may.
            with tempfile.TemporaryDirectory(prefix='rdp-mocks-') as mock_dir:
                for name, body in mocks.items():
                    path = Path(mock_dir) / name
                    path.write_text('#!/bin/bash\nset -eu\n' + body + '\n')
                    path.chmod(0o755)
                env = dict(os.environ, PATH=mock_dir + ':' + os.environ['PATH'],
                           CALLS=str(log), SUDO_USER='rdpuser')
                def run(answer='', *args):
                    return subprocess.run(['bash', str(script), *args], input=answer,
                                          text=True, capture_output=True, env=env)
                self.assertEqual(run('\n').returncode, 0)
                self.assertFalse(unit.exists())
                self.assertFalse(log.exists())
                first = run('y\n')
                self.assertEqual(first.returncode, 0, first.stderr)
                generated = unit.read_text()
                self.assertIn(f'WorkingDirectory={root}', generated)
                self.assertIn('User=rdpuser\n', generated)
                self.assertIn(' compose stop\n', generated)
                self.assertEqual(run('yes\n').returncode, 0)
                self.assertEqual(unit.read_text(), generated)
                self.assertEqual(log.read_text().splitlines(),
                                 ['daemon-reload', 'enable --now rdp-link.service'] * 2)
                self.assertEqual(run('\n').returncode, 0)
                self.assertEqual(unit.read_text(), generated)
                self.assertEqual(run('', '--disable').returncode, 0)
                self.assertFalse(unit.exists())
                self.assertEqual(run('', '--disable').returncode, 0)
                unit.write_text('# unrelated service\n')
                self.assertNotEqual(run('y\n').returncode, 0)
                self.assertNotEqual(run('', '--disable').returncode, 0)
                self.assertEqual(unit.read_text(), '# unrelated service\n')


if __name__ == '__main__':
    unittest.main()
