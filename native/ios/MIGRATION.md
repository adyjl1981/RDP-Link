# Direct native migration decision

Research date: 4 October 2026. Conditional technical feasibility: proceed to a macOS integration spike. FreeRDP currently documents iOS support, but this research is not a successful build or interoperability result. No native dependency is vendored or pinned yet; select and record an exact release/commit only after its device/simulator build succeeds. Upstream master documentation can differ from a chosen release.

## Target architecture

```text
SwiftUI profile/session UI
  → session coordinator (main actor; explicit cancellation)
  → original Objective-C/C shim (opaque native context; worker thread)
  → FreeRDP + WinPR + approved dependencies (bundled libraries)
  → direct RDP TCP/TLS to GNOME Remote Desktop on Ubuntu
```

There is no Node service, Docker, guacd, Guacamole protocol, WebSocket tunnel or gateway in this path. Ubuntu must provide an enabled, reachable RDP server; “no companion installation” does not mean no server configuration. Supported Ubuntu/GNOME desktop installations may already supply GNOME Remote Desktop. Other distributions/installations may need that component. A reachable LAN or existing private VPN route is needed; a Tailscale **Serve HTTPS URL is not an RDP endpoint**. Use the machine's LAN/VPN host and RDP port. Do not expose RDP publicly as a convenience workaround.

Keep the root fallback byte-for-byte intact. Use native profile storage independently. First reproduce the existing 1920×1080 / 96 DPI handshake and server-reported size without remote resize. Add copied frame rendering (CoreGraphics initially; bounded latest-frame buffering), then local zoom/pan and pointer transforms. Keep worker calls and FreeRDP callbacks off the main actor. A shim must own settings, context, event handles, framebuffer lifetime and teardown; disconnect must signal the worker, release input state and join/free safely. Never pass a freed framebuffer to Swift. Add text/scancode input with composition and hardware keyboard tests. Explicit clipboard transfer can follow later; no automatic clipboard reading.

## FreeRDP iOS viability

The [upstream iOS README](https://github.com/FreeRDP/FreeRDP/blob/master/docs/README.ios) describes iOS 15+, Xcode 26+, CMake, static OpenSSL and FFmpeg for H.264, with separate arm64 device and simulator builds. Optional Azure/Kerberos support adds cJSON and MIT/Heimdal dependencies. This is a native C/C++ integration, not a Swift package dependency or drop-in XCFramework. Use the upstream sample as a build/interoperability probe; package just the required libraries and headers into separate device/simulator slices for the original shell. See [compilation](https://github.com/FreeRDP/FreeRDP/wiki/Compilation) and [releases](https://github.com/FreeRDP/FreeRDP/releases). Inspect actual chosen CMake options rather than assuming wiki defaults.

Start without Azure, Kerberos, USB redirection, printers, drive redirection or unnecessary channels. Required GNOME graphics/codecs must be negotiated and tested: disabling FFmpeg reduces licensing complexity but may fail required AVC/GFX paths or reduce performance. Evaluate Apple's VideoToolbox decoder support in the selected FreeRDP revision; do not assume the upstream client exposes a working replacement on every iPhone. Record TLS, NLA and GFX negotiation before deciding the dependency set.

## License and distribution gate

This is an engineering assessment, not a concluded App Store license clearance. No third-party code is copied into this foundation.

* [FreeRDP core LICENSE](https://github.com/FreeRDP/FreeRDP/blob/master/LICENSE): Apache 2.0. Distribution needs the license, applicable attribution/NOTICE and change notices. Audit WinPR and every linked/transitively bundled file at the pinned revision; a repository-level license is not a license for every file.
* Existing iOS adapter sources include MPL 2.0 headers (for example [ios_freerdp.h API source](https://pub.freerdp.com/api/ios__freerdp_8h_source.html)). Avoid copying that client into this original shell by default. If reused, retain notices and provide covered source including modifications; MPL has file-level source obligations, not automatic disclosure of all independent Swift files. Review the [Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) and compatibility of actual distribution terms.
* [OpenSSL](https://openssl-library.org/source/license/index.html): modern 3.x is Apache 2.0; older versions have different terms. Pin version and preserve required notices. Do not use an obsolete crypto release merely to match an old sample.
* [FFmpeg legal guidance](https://www.ffmpeg.org/legal.html): baseline LGPL 2.1+; enabling GPL parts changes licensing and `nonfree` configurations cannot be redistributed. Static iOS distribution creates relinking/source-compliance concerns; do not assume shipping a static LGPL binary through the App Store is cleared. Prefer a verified permissive/platform codec path, or obtain a concrete compliance review before selecting FFmpeg. H.264 patent questions are separate from copyright licenses. Audit OpenH264 if selected, including binary versus source distribution terms.
* Before release, produce a dependency manifest with exact commits, build flags, licenses, notices, source offers where needed and an in-app acknowledgments page. Review optional codec/compression/auth libraries individually. No final binary dependency inventory exists yet.

Apple distribution requires signed embedded code, valid entitlements, privacy disclosures/policy, accurate feature descriptions, and a functional review environment. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) include software requirements (2.5), review access (2.1), privacy (5.1) and rights (5.2). Bundle the engine; do not download executable plugins. Arrange an accessible test desktop or appropriate review demo/instructions once functional. Check encryption/export compliance for the final crypto build in App Store Connect. Apache licensing makes a commercial shell plausible; neither that nor a prototype guarantees approval.

## GNOME Wayland/current desktop

[GNOME Desktop Sharing](https://help.gnome.org/gnome-help/sharing-desktop.html) exposes the existing desktop via RDP and has separate remote-control and credential settings. It is the intended current-session mode. Remote Login has different session semantics and is not a substitute for mirroring the physical session. When both features are enabled, Remote Login may occupy 3389 and Sharing may use 3390: read the actual settings rather than assuming. Use the displayed RDP credentials and compare Verify Encryption with the client's fingerprint. Built-in GNOME sharing supports Wayland; replacing it with xrdp is not part of this migration. Lock/logout, monitor/headless state, reconnect, concurrent clients and distro/GNOME version remain real-server test cases; do not promise persistence across them.

## iOS security and lifecycle

[Local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy) requires a purpose description and user permission for LAN connections. The generated app includes it; manual host entry requires no Bonjour discovery or multicast entitlement. Handle denied permission distinctly in the real adapter. Raw FreeRDP TLS sockets must enforce trust themselves; an ATS setting does not validate their certificates. Do not add broad insecure transport exceptions.

Fail closed for untrusted/changed certificates before sending credentials. Plan a user-approved SHA-256 pin bound to normalized host/port after comparison with Ubuntu; changed pins require a new explicit decision. The current UI exposes no bypass and uses system trust only. The pin case in the interface is a contract, not implemented verification.

[iOS background execution](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background) can suspend the app. This client should disconnect on inactivity/background and reconnect manually, with no claim of an always-running RDP socket. Test Local Network alert interruptions too. Clear transient password/typing buffers, blank the future remote surface before app-switcher snapshots, and prevent sensitive logs. SwiftUI privacySensitive alone is not a guarantee of snapshot redaction. Cancel callbacks/network work, release pressed keys/buttons and reset gestures. OS keyboard buffers and immutable strings cannot guarantee erasure. Screen capture protection is not promised.

## Concrete next milestones

1. On macOS: generate/build shell, run core tests and real-device Keychain CRUD/locked-device/error cases; validate scene transitions and denied Local Network permission.
2. Pin a supported FreeRDP revision. Build upstream client for arm64 iPhone and arm64 simulator; inventory all linked dependencies and license/build settings. Retain reproducible logs and hashes.
3. Prove that upstream build connects directly to this Ubuntu GNOME **Desktop Sharing** port with verified certificate, remote credentials, NLA and graphics negotiation. Check physical desktop is the session shown. Test Remote Login separately only if required.
4. Integrate an original minimal shim/XCFramework with the protocol, cancellation and certificate handling. Unit-test late callbacks, bounded frame lifetime and certificate rejection with a fake adapter; run live smoke tests before any connected claim.
5. Add renderer, touch, keyboard and optional explicit clipboard. Test portrait/landscape, keyboard, right click, scroll, Unicode, network loss, background/foreground, lock/logout and repeated connect/disconnect on device. Measure CPU/memory/thermal behavior.
6. Only then prepare license notices, privacy/export answers, signing and TestFlight/App Store review. Keep the fallback until native behavior is verified; pushing these local commits requires user confirmation.
