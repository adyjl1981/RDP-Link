# RDP-Link

An iPhone-focused RDP web client for Ubuntu desktop. Open it in Safari; optionally use **Share → Add to Home Screen**. This first version uses a small Node gateway and Apache Guacamole's `guacd` RDP engine. There is no custom RDP implementation, database, native iOS build, account system, or background reconnect service.

This LAN-only development build has no separate gateway access key. Connections use the Ubuntu RDP username and password.

## Run on Ubuntu

Requires Docker with Compose. In this repository:

```sh
cp .env.example .env
# Set PUBLIC_ORIGIN to your HTTPS URL and RDP_TARGETS to your desktop's host:port.
docker compose up --build -d
```

Put an HTTPS reverse proxy in front of `127.0.0.1:8080`, with WebSocket forwarding. For example, this Caddy configuration automatically obtains a certificate for a domain pointing to your Ubuntu machine:

```caddy
rdp.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set `PUBLIC_ORIGIN=https://rdp.example.com` exactly, without a trailing slash. Use a private network/VPN for access where possible. The gateway is bound to localhost; `guacd` has no published port. Do not expose guacd directly. HTTPS protects the iPhone-to-gateway connection; RDP handles gateway-to-desktop transport separately. Desktop destinations must exactly match the `RDP_TARGETS` allowlist.

For local development, `npm ci`, then supply `RDP_TARGETS` and run `npm start` with an existing guacd on localhost:4822. `http://localhost:8080` is allowed for development; an iPhone accessing a LAN address must use HTTPS.

## Ubuntu desktop setup

In **Settings → System → Remote Desktop**, enable Desktop Sharing for the existing desktop or Remote Login for a login session. These can use different ports; use the port shown in Ubuntu settings, and the remote desktop credentials shown there. Do not assume the normal Ubuntu login password is the RDP password. The gateway uses Ubuntu's RDP stack directly; xrdp is not required.

When the desktop is the Docker host, use `host.docker.internal` as the profile address and `host.docker.internal:3389` (or the displayed port) in `RDP_TARGETS`. Ubuntu must accept RDP connections from Docker's network; localhost-only RDP binding will not work.

Certificate validation is enabled by default. For a known desktop with a self-signed RDP certificate, `RDP_IGNORE_CERT=true` is an explicit opt-in that disables RDP certificate verification. Prefer installing a certificate trusted by the guacd container. This setting does not change HTTPS validation in Safari.

## Using the MVP

- Save named profiles containing address, port and username only. Enter the RDP password for every connection; it is never written to local storage or URLs.
- The desktop starts at 1280×720. The actual size reported by Ubuntu is fitted to the available screen with its aspect ratio intact. Rotate the phone for a larger view. It does not renegotiate resolution when the keyboard opens.
- Touch acts as a trackpad: move the pointer, tap to click, two-finger tap for right click, two-finger movement for scrolling, hold and move to drag. A physical mouse also works.
- Tap Keyboard for the iPhone software keyboard. Text and basic special keys are forwarded. Hardware modifier shortcuts and complex input methods need further device testing.
- Clipboard exchanges text explicitly. Received desktop text appears in the Clipboard panel; send its contents to Ubuntu or tap Copy to iPhone. Clipboard availability depends on the Ubuntu RDP server and Safari permissions.
- Disconnect, network loss, or leaving the page closes the session. Reconnect by entering credentials and pressing Connect again. No password retention or automatic retries.

The gateway holds credentials only during the connection handshake, and uses single-use tickets expiring after ten seconds. JavaScript strings cannot be reliably zeroed in memory. Profiles remain on the device until forgotten. There is a maximum of four pending/active sessions; this is a personal MVP, not a multi-user public service.

## Verification

```sh
npm test
npm audit
```

Tests cover profile sanitization, aspect ratio, Unicode protocol framing, origin and RDP credential checks, destination restrictions, single-use tickets, fragmented guacd handshakes, input, keepalive and disconnect cleanup. They use a simulated guacd, not a live Ubuntu desktop.

Before calling this device-ready, test on a real iPhone against your Ubuntu Wayland desktop: certificate/authentication, portrait/landscape, keyboard show/hide, text/backspace/Enter, drag/right-click/scroll, clipboard both ways, network interruption and reconnect. Remote Login and Desktop Sharing should be checked separately if both are needed. Linux development cannot validate iPhone Safari behavior without a device, and no live RDP credentials are supplied with the repository.

## Architecture references

- [Apache Guacamole protocol and handshake](https://guacamole.apache.org/doc/gug/guacamole-protocol.html)
- [Guacamole JavaScript API](https://guacamole.apache.org/doc/gug/guacamole-common-js.html)
- [RDP configuration](https://guacamole.apache.org/doc/gug/configuring-guacamole.html)
- [Ubuntu Remote Desktop setup](https://documentation.ubuntu.com/desktop/en/24.04/how-to/share-your-desktop-remotely/)

The npm `guacamole-common-js` package is a third-party distribution of the Apache client library; its Apache license is included in the dependency. Dependency versions are locked. guacd runs from the Apache 1.6.0 image.
