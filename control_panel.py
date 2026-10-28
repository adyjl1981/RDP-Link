#!/usr/bin/env python3
"""Small local desktop controller for the web Compose deployment."""
import ipaddress
import json
import os
from pathlib import Path
import queue
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from tkinter.scrolledtext import ScrolledText

REPO = Path(__file__).resolve().parent
SERVICE = 'rdp-link.service'
TARGET = 'http://127.0.0.1:8080'


def run(*args, check=True):
    result = subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                            timeout=180, stdin=subprocess.DEVNULL)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or
                           f'{args[0]} failed ({result.returncode})')
    return result.stdout.strip()


def admin(*args):
    executable = shutil.which(args[0])
    if not executable:
        raise RuntimeError(f'{args[0]} is not installed.')
    return run('pkexec', executable, *args[1:])


def service_info():
    values = {}
    output = run('systemctl', 'show', SERVICE, '--property=LoadState,ActiveState,UnitFileState,WorkingDirectory', check=False)
    for line in output.splitlines():
        key, _, value = line.partition('=')
        values[key] = value
    if not values:
        raise RuntimeError('Cannot read system service status.')
    return values


def check_service_repo(info):
    if info.get('LoadState') != 'loaded':
        raise RuntimeError('Install the boot service first.')
    if Path(info.get('WorkingDirectory', '')).resolve() != REPO:
        raise RuntimeError('The existing service belongs to another checkout. No change made.')


def serve_ownership(config, dns):
    """Only touch an unused port or the exact private RDP-Link mapping."""
    endpoint = dns + ':443'
    web = config.get('Web', {})
    tcp = config.get('TCP', {})
    entry = web.get(endpoint)
    for key in web:
        if key.endswith(':443') and key != endpoint:
            raise RuntimeError('HTTPS port 443 has another Serve configuration. Manage it separately.')
    if entry is not None and entry != {'Handlers': {'/': {'Proxy': TARGET}}}:
        raise RuntimeError('HTTPS port 443 serves other content. No Serve change made.')
    if '443' in tcp and (tcp['443'] != {'HTTPS': True} or entry is None):
        raise RuntimeError('Port 443 has another forwarding configuration.')
    if any(config.get('AllowFunnel', {}).values()):
        raise RuntimeError('Funnel is configured. Review it separately before changing access.')
    return entry is not None


def env_updated(text, updates):
    lines = text.splitlines()
    for key, value in updates.items():
        lines = [line for line in lines if not re.match(r'^\s*(?:export\s+)?' + re.escape(key) + r'\s*=', line)]
        lines.append(f'{key}={value}')
    return '\n'.join(lines) + '\n'


def write_env(text):
    fd, name = tempfile.mkstemp(prefix='.env-', dir=REPO)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.replace(name, REPO / '.env')
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply_access(mode, lan_ip):
    if mode not in ('lan', 'tailscale'):
        raise RuntimeError('Choose a supported access mode.')
    env_path = REPO / '.env'
    original = env_path.read_text()
    # Require Docker access and valid current config before changing anything.
    run('docker', 'info')
    run('docker', 'compose', 'config', '--quiet')
    dns, configured = '', False
    if shutil.which('tailscale'):
        state = json.loads(run('tailscale', 'status', '--json'))
        dns = state.get('Self', {}).get('DNSName', '').rstrip('.')
        config = json.loads(run('tailscale', 'serve', 'status', '--json'))
        configured = serve_ownership(config, dns)
        if mode == 'tailscale' and (state.get('BackendState') != 'Running' or not dns):
            raise RuntimeError('Sign in to Tailscale and connect first.')
    elif mode == 'tailscale':
        raise RuntimeError('Install and sign in to Tailscale first (tailscale.com/download).')
    if mode == 'lan':
        address = ipaddress.IPv4Address(lan_ip.strip())
        if not any(address in ipaddress.ip_network(net) for net in
                   ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
            raise RuntimeError('Choose a private LAN IPv4 address assigned to this machine.')
        local = run('hostname', '-I').split()
        if str(address) not in local:
            raise RuntimeError('That address is not assigned to this machine.')
        binding, origin = str(address), f'http://{address}:8080'
    else:
        binding, origin = '127.0.0.1', f'https://{dns}'
    updated = env_updated(original, {'RDP_BIND_ADDRESS': binding, 'PUBLIC_ORIGINS': origin})
    # Remove only our known Serve mapping before switching to LAN access.
    if mode == 'lan' and configured:
        admin('tailscale', 'serve', '--bg', '--https=443', 'off')
    write_env(updated)
    try:
        run('docker', 'compose', 'config', '--quiet')
        run('docker', 'compose', 'up', '-d')
    except Exception:
        write_env(original)
        raise RuntimeError('Access change failed. Original .env restored; inspect Docker status and reapply. '
                           'A removed Serve mapping is not automatically restored.')
    if mode == 'tailscale':
        try:
            admin('tailscale', 'serve', '--bg', '--https=443', TARGET)
        except Exception as error:
            raise RuntimeError('Gateway is now local-only, but Tailscale Serve setup failed. '
                               'Retry private Tailscale access. ' + str(error)) from error
    return f'Access configured: {origin}'


class Panel:
    def __init__(self, root):
        self.root = root
        root.title('RDP-Link')
        root.geometry('660x700')
        root.minsize(640, 700)
        self.events = queue.Queue()
        self.busy = False
        self.buttons = []
        frame = ttk.Frame(root, padding=22)
        frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='RDP-Link', font=('', 22, 'bold')).pack(anchor='w')
        ttk.Label(frame, text='Web remote desktop • Ubuntu control panel').pack(anchor='w', pady=(0, 16))
        self.status = tk.StringVar(value='Reading status…')
        status_box = ScrolledText(frame, height=6, width=64, wrap='word', font=('', 10))
        status_box.pack(fill='x')
        def render_status(*_):
            status_box.configure(state='normal')
            status_box.delete('1.0', 'end')
            status_box.insert('1.0', self.status.get())
            status_box.configure(state='disabled')
        self.status.trace_add('write', render_status)
        render_status()
        row = ttk.Frame(frame)
        row.pack(fill='x', pady=14)
        for label, callback in [('Refresh', self.refresh), ('Start', lambda: self.service('start')),
                                ('Stop', lambda: self.service('stop'))]:
            self.button(row, label, callback).pack(side='left', padx=(0, 8))
        boot = ttk.LabelFrame(frame, text='Start at boot', padding=12)
        boot.pack(fill='x')
        for label, callback in [('Install boot service', self.install),
                                ('Enable at boot', lambda: self.service('enable')),
                                ('Disable at boot', lambda: self.service('disable'))]:
            self.button(boot, label, callback).pack(side='left', padx=(0, 8))
        access = ttk.LabelFrame(frame, text='Access', padding=12)
        access.pack(fill='x', pady=16)
        self.mode = tk.StringVar(value='')
        ttk.Radiobutton(access, text='LAN only — use a private address on this machine', variable=self.mode,
                        value='lan').pack(anchor='w')
        self.ip = tk.StringVar()
        ttk.Entry(access, textvariable=self.ip, width=24).pack(anchor='w', padx=22, pady=5)
        ttk.Radiobutton(access, text='Outside the LAN — private Tailscale HTTPS', variable=self.mode,
                        value='tailscale').pack(anchor='w')
        ttk.Label(access, text='Tailscale is required on both devices. This does not enable public internet access.',
                  wraplength=570).pack(anchor='w', pady=8)
        self.button(access, 'Apply access choice…', self.access).pack(anchor='w')
        ttk.Label(frame, text='Access changes may disconnect sessions. Administrator actions open an authentication prompt.\n'
                  'Closing this window leaves the service running.', wraplength=610).pack(anchor='w')
        self.notice = tk.StringVar()
        ttk.Label(frame, textvariable=self.notice, wraplength=610).pack(anchor='w', pady=12)
        self.refresh()
        root.after(100, self.poll)

    def button(self, parent, label, callback):
        button = ttk.Button(parent, text=label, command=callback)
        self.buttons.append(button)
        return button

    def work(self, function):
        if self.busy:
            return
        self.busy = True
        for button in self.buttons:
            button.state(['disabled'])
        self.notice.set('Working…')
        def worker():
            try:
                self.events.put((True, function()))
            except Exception as error:
                self.events.put((False, str(error)))
        threading.Thread(target=worker, daemon=True).start()

    def poll(self):
        try:
            ok, result = self.events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            for button in self.buttons:
                button.state(['!disabled'])
            self.notice.set('' if isinstance(result, dict) else result)
            if not ok:
                messagebox.showerror('RDP-Link', result)
            elif isinstance(result, dict):
                self.status.set(result['status'])
                if not self.ip.get():
                    self.ip.set(result['ip'])
            else:
                self.refresh()
        self.root.after(100, self.poll)

    def refresh(self):
        def inspect():
            info = service_info()
            summary = [f"Boot service: {info.get('LoadState', 'unknown')} • "
                       f"{info.get('ActiveState', 'unknown')} • boot: {info.get('UnitFileState', 'unknown')}"]
            try:
                binding = run('docker', 'compose', 'port', 'gateway', '8080', check=False)
                summary.append('Gateway binding: ' + (binding or 'not published'))
                summary.append('Containers:\n' + (run('docker', 'compose', 'ps', '--format',
                                                    '{{.Service}}: {{.Status}}') or 'Stopped'))
            except Exception:
                summary.append('Containers: unavailable — check Docker access.')
            if shutil.which('tailscale'):
                try:
                    state = json.loads(run('tailscale', 'status', '--json'))
                    summary.append('Tailscale: ' + state.get('BackendState', 'unknown'))
                    summary.append(run('tailscale', 'serve', 'status') or 'Serve: not configured')
                except Exception:
                    summary.append('Tailscale: installed; status unavailable')
            else:
                summary.append('Tailscale: not installed')
            addresses = run('hostname', '-I', check=False).split()
            ips = [ip for ip in addresses if re.match(r'^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)', ip)]
            return {'status': '\n'.join(summary), 'ip': ips[0] if ips else ''}
        self.work(inspect)

    def service(self, action):
        if action == 'stop' and not messagebox.askokcancel('Stop RDP-Link?', 'This disconnects active sessions.'):
            return
        def change():
            info = service_info()
            if info.get('LoadState') == 'not-found' and action in ('start', 'stop'):
                run('docker', 'compose', 'up', '-d') if action == 'start' else run('docker', 'compose', 'stop')
            else:
                check_service_repo(info)
                admin('systemctl', action, SERVICE)
            return ('Boot preference updated; running state unchanged.' if action in ('enable', 'disable')
                    else f'RDP-Link {action} completed.')
        self.work(change)

    def install(self):
        def launch():
            info = service_info()
            if info.get('LoadState') != 'not-found':
                return 'A boot service already exists. Use Enable at boot or Disable at boot.'
            terminal = shutil.which('x-terminal-emulator')
            if not terminal:
                raise RuntimeError('No terminal found. Run ./setup.sh from a terminal in the repository.')
            command = f'cd {shlex.quote(str(REPO))} && ./setup.sh; printf "\\nPress Enter to close."; read -r answer'
            subprocess.Popen([terminal, '-e', 'bash', '-c', command], cwd=REPO)
            return 'Complete setup in the terminal, then click Refresh.'
        self.work(launch)

    def access(self):
        mode, ip = self.mode.get(), self.ip.get()
        if not mode:
            messagebox.showinfo('Choose access', 'Choose LAN only or private Tailscale access first.')
            return
        if messagebox.askokcancel('Apply access?',
                'This updates the gateway binding and replaces trusted browser origins with the selected URL. '
                'It recreates the gateway and may disconnect sessions. LAN mode removes only the matching '
                'RDP-Link Tailscale Serve route. Continue?'):
            self.work(lambda: apply_access(mode, ip))


if __name__ == '__main__':
    root = tk.Tk()
    Panel(root)
    root.mainloop()
