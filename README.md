# RDP-Link

An iPhone-focused RDP web client for Ubuntu desktop. Open it in Safari; optionally use **Share → Add to Home Screen**. This first version uses a small Node gateway and Apache Guacamole's `guacd` RDP engine. There is no custom RDP implementation, database, native iOS build, account system, or background reconnect service.

This LAN-only development build has no separate gateway access key. Connections use the Ubuntu RDP username and password.

## Run on Ubuntu

Requires Docker with Compose. In this repository:

```sh
cp .env.example .env
# Set PUBLIC_ORIGINS to your exact browser URLs and RDP_TARGETS to your desktop's host:port.
docker compose up --build -d
```

Put an HTTPS reverse proxy in front of `127.0.0.1:8080`, with WebSocket forwarding. For example, this Caddy configuration automatically obtains a certificate for a domain pointing to your Ubuntu machine:

```caddy
rdp.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set `PUBLIC_ORIGINS=https://rdp.example.com` exactly, without a trailing slash. Use a private network/VPN for access where possible. Compose publishes the gateway on the LAN on port 8080; `guacd` has no published port. Do not expose guacd directly. HTTPS protects the iPhone-to-gateway connection; RDP handles gateway-to-desktop transport separately. Desktop destinations must exactly match the `RDP_TARGETS` allowlist.

For local development, `npm ci`, then supply `RDP_TARGETS` and run `npm start` with an existing guacd on localhost:4822. Plain HTTP is allowed on `localhost`, `127.0.0.1`, and RFC1918 private LAN addresses (`10.x.x.x`, `172.16–31.x.x`, and `192.168.x.x`), including from an iPhone. Include the exact LAN URL in `PUBLIC_ORIGINS`, such as `http://192.168.1.50:8080`. Normal/public addresses require HTTPS.

## Trusted browser origins and Tailscale Serve

The supplied configuration explicitly trusts both browser URLs:

```dotenv
PUBLIC_ORIGINS=http://192.168.1.50:8080,https://desktop.example.ts.net
```

`PUBLIC_ORIGINS` is a comma-separated list of exact HTTP(S) origins. Whitespace around configuration entries is ignored. Nonempty `PUBLIC_ORIGINS` takes precedence over the legacy `PUBLIC_ORIGIN`; when unset or empty, the legacy setting still works, defaulting to `http://localhost:8080`. Invalid entries fail startup. Do not include paths, trailing slashes, credentials or wildcards. Both POST `/session` and WebSocket `/tunnel` reject missing, malformed and unknown Origin headers. This is an origin allowlist, not a change to the RDP destination allowlist or credentials.

For these URLs, `.env.example` includes the list and Compose forwards it to the gateway. Existing `.env` files need the same entry. Restart/recreate the gateway after configuration changes.

To serve the gateway privately over Tailscale HTTPS, follow the [Tailscale Serve CLI documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) and on this Ubuntu machine run:

```sh
tailscale serve --bg http://127.0.0.1:8080
```

Open `https://desktop.example.ts.net` on a device in the tailnet. Tailscale Serve terminates HTTPS and proxies HTTP and WebSocket upgrades to the local gateway. The browser selects WSS automatically for an HTTPS page; the backend remains HTTP/WS. Preserve the browser's Origin header through any proxy. The gateway does not trust forwarded headers to expand its origin list. Verify the actual Serve URL matches the configured origin; a different machine name or port requires an explicit entry. LAN HTTP access remains available at the other listed URL. This configuration does not enable public Tailscale Funnel access.

## Ubuntu desktop setup

In **Settings → System → Remote Desktop**, enable Desktop Sharing for the existing desktop or Remote Login for a login session. These can use different ports; use the port shown in Ubuntu settings, and the remote desktop credentials shown there. Do not assume the normal Ubuntu login password is the RDP password. The gateway uses Ubuntu's RDP stack directly; xrdp is not required.

When the desktop is the Docker host, use `host.docker.internal` as the profile address and `host.docker.internal:3389` (or the displayed port) in `RDP_TARGETS`. Ubuntu must accept RDP connections from Docker's network; localhost-only RDP binding will not work.

Certificate validation is enabled by default. For a known desktop with a self-signed RDP certificate, `RDP_IGNORE_CERT=true` is an explicit opt-in that disables RDP certificate verification. Prefer installing a certificate trusted by the guacd container. This setting does not change HTTPS validation in Safari.

## Using RDP-Link

- Add, edit and delete named profiles with **Save profile** and **Delete selected profile**. Select a saved desktop to fill its address, port and username in one action. Each profile remembers its last session zoom. Enter the RDP password for every connection; it is never written to local storage or URLs. Saving a profile does not require connecting.
- Connections negotiate an initial 1920×1080 desktop at 96 DPI with GNOME Desktop Sharing, which exposes the already-running Ubuntu session. This size is only for the initial handshake; no remote resize requests are sent afterward. Local pan bounds and transforms use Guacamole’s reported display dimensions when available, with 1920×1080 as the initial fallback. The phone starts at 100% scale as a viewport over that desktop: one-finger movement controls the pointer, exact-edge cursor following pans, taps click at the cursor, and pinch zoom and optional Fit screen transform only the local display. Rotation and keyboard changes affect only the local viewport, preserving the client and WebSocket. Pointer coordinates account for pan, zoom, and the server’s desktop dimensions.
- Touch acts as a trackpad: move the pointer, tap to click, hold for half a second to right-click, two-finger vertical movement for mouse-wheel scrolling, and pinch to zoom around the gesture center. Scrolling and pinch lock to one mode until both fingers lift; neither can click. A physical mouse also works.
- Tap Keyboard for the iPhone software keyboard. The bar shows a local typing preview, including native editing, spaces, punctuation, paste, autocorrection and composition. Composition is forwarded only when committed. Long lines scroll horizontally. Clear resets only the local preview; Done dismisses it. Opening a fresh keyboard session, dismissing it, hiding the page or disconnecting discards the preview. Session controls close and stay hidden while typing; local pan controls remain available.
- Tap Hide **before entering passwords or other sensitive text**. Hidden mode masks composition and clears committed text immediately, without retaining a local edit history. Switching modes clears the preview; the preference lasts only in memory. Browser/OS composition temporarily requires text in the masked field. Typed contents are never saved, logged or added to clipboard by the preview. Remote password fields cannot reliably be detected through RDP, so hidden mode is manual. Visible mode temporarily contains what you type, so avoid using it for secrets.
- This is local typing history, not a live mirror of the remote application's text or caret. Edits send relative arrow/backspace keystrokes and assume the remote caret still corresponds to the local input; remote mouse clicks, application transformations and navigation can invalidate that assumption. Clear or reopen the keyboard after changing remote fields. Hardware modifier shortcuts and iOS input methods still require real-device testing.
- Clipboard exchanges text explicitly. Received desktop text appears in the Clipboard panel; send its contents to Ubuntu or tap Copy to iPhone. Clipboard availability depends on the Ubuntu RDP server and Safari permissions.
- Disconnect, network loss, or leaving the page closes the session. Reconnect by entering credentials and pressing Connect again. No password retention or automatic retries.

The gateway holds credentials only during the connection handshake, and uses single-use tickets expiring after ten seconds. JavaScript strings cannot be reliably zeroed in memory. Profiles remain on the device until forgotten. There is a maximum of four pending/active sessions; this is a personal MVP, not a multi-user public service.

## Verification

```sh
npm test
npm audit
```

Tests cover profile CRUD, migration, storage failures, password exclusion, long-press cancellation, scroll/pinch arbitration, anchored zoom-out, exact-edge cursor following, profile and mouse UI integration, rotation/session preservation, profile sanitization, aspect ratio, Unicode protocol framing, origin and RDP credential checks, destination restrictions, single-use tickets, fragmented guacd handshakes, input, keepalive and disconnect cleanup. They use a simulated guacd, not a live Ubuntu desktop.

Before calling this device-ready, test on a real iPhone against your Ubuntu Wayland desktop: certificate/authentication, portrait/landscape, keyboard show/hide, text/backspace/Enter, long-press/right-click/scroll, clipboard both ways, network interruption and reconnect. Remote Login and Desktop Sharing should be checked separately if both are needed. Linux development cannot validate iPhone Safari behavior without a device, and no live RDP credentials are supplied with the repository.

## Architecture references

- [Apache Guacamole protocol and handshake](https://guacamole.apache.org/doc/gug/guacamole-protocol.html)
- [Guacamole JavaScript API](https://guacamole.apache.org/doc/gug/guacamole-common-js.html)
- [RDP configuration](https://guacamole.apache.org/doc/gug/configuring-guacamole.html)
- [Ubuntu Remote Desktop setup](https://documentation.ubuntu.com/desktop/en/24.04/how-to/share-your-desktop-remotely/)

The npm `guacamole-common-js` package is a third-party distribution of the Apache client library; its Apache license is included in the dependency. Dependency versions are locked. guacd runs from the Apache 1.6.0 image.

## Phase 1 iPhone regression check

Before deploying beyond the existing phone test, verify tap and long press at the tracked cursor, slow pinch-out and reversal near every desktop edge, vertical two-finger scrolling without clicks, and rotation in both orientations while connected. Test selecting, editing and deleting multiple profiles, reconnecting with the remembered zoom, keyboard and clipboard, and errors/offline/disconnect. Fit screen remains an explicit session action. All zoom is local; the gateway and GNOME Desktop Sharing negotiation are unchanged.
