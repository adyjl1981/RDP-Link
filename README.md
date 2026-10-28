# RDP-Link

RDP-Link is a web remote-desktop client for Ubuntu, designed for use in iPhone
Safari. A Docker Compose stack runs a Node gateway and Apache Guacamole's guacd;
a small Ubuntu control panel manages the stack, optional boot startup and access.
This repository contains the web app. 
## Installation and user manual

**Start with the [RDP-Link user manual](USER_MANUAL.md).** It walks through:

- Installing Docker, Compose and the desktop prerequisites.
- Enabling Ubuntu Remote Desktop and configuring the RDP destination.
- Building the gateway and installing desktop/app-menu icons.
- Choosing LAN access or installing Tailscale on Ubuntu and iPhone for private
  outside-LAN HTTPS access.
- Using the phone controls, keyboard, profiles and clipboard.
- Optional boot startup, everyday controls, troubleshooting, updates and removal.

All examples use fictional values or placeholders. Copy `.env.example` to a private
`.env` once, then configure your own values. Never publish your `.env` or passwords.
The initial example listens only on loopback and trusts `http://localhost:8080`;
use the manual to configure access from a phone.

Boot service installation is opt-in. Docker's existing `unless-stopped` restart
policies remain independent of that option. Tailscale Serve is also configured
separately. The GUI's outside-LAN mode uses private Serve access, not public Funnel.

## Development and verification

Normal Docker use does not require Node.js on the host. For local development,
install Node.js 22 or newer, run `npm ci`, and provide an existing guacd on
localhost:4822. Set `RDP_TARGETS` and browser origins explicitly, then use `npm start`.
The host Node process does not automatically read `.env`; export its settings or
use a suitable Node environment-file option. See the
[configuration reference](USER_MANUAL.md#11-configuration-reference-and-terminal-alternatives).

```sh
npm test
npm audit
bash -n setup.sh
python3 -B test/test-boot-setup.py
python3 -B test/test-control-panel.py
python3 -B test/test-desktop-launcher.py
```

The JavaScript tests simulate guacd; they do not prove a live RDP connection.
Python tests isolate service/network/launcher operations rather than changing the
host deployment. A successful test run does not verify real iPhone interaction,
outside-LAN reachability, authentication, or reboot behavior.

Before considering a deployment ready, test on a real iPhone: RDP credentials and
certificates, portrait/landscape, keyboard and hidden input, pointer/click/right-click,
scroll/pinch, clipboard, network loss/reconnection and mobile-data access if used.
Verify Desktop Sharing and Remote Login separately if both are required. For boot
startup, arrange a deliberate reboot test with local recovery access.

## Implementation notes

- Initial desktop negotiation requests 1920×1080 at 96 DPI; local zoom/pan, keyboard
  changes and rotation do not request remote desktop resizing.
- Passwords are not saved in profiles. The gateway holds credentials during the
  handshake; JavaScript strings cannot reliably be zeroed. Single-use connection
  tickets expire after ten seconds, with at most four pending/active sessions.
- There is no separate gateway account, automatic reconnection, file/drive
  redirection or audio. This is a personal-use development app, not a public
  multi-user gateway.
- The npm `guacamole-common-js` client is a third-party distribution, with its
  Apache license included. Dependencies are locked; Compose uses guacd 1.6.0.

## References

- [Apache Guacamole protocol](https://guacamole.apache.org/doc/gug/guacamole-protocol.html)
- [Guacamole JavaScript API](https://guacamole.apache.org/doc/gug/guacamole-common-js.html)
- [Guacamole RDP configuration](https://guacamole.apache.org/doc/gug/configuring-guacamole.html)
- [Ubuntu Remote Desktop](https://documentation.ubuntu.com/desktop/en/latest/how-to/share-your-desktop-remotely/)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
