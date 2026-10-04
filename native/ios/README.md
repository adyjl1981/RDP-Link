# RDP-Link native iPhone foundation — Phase 3

Status: original SwiftUI shell and testable Swift package; **no linked FreeRDP, no desktop renderer, no live RDP connection**. All existing root web/Guacamole files are unchanged. That implementation remains the stable fallback. This directory does not consume its session API, gateway, environment file or browser profiles.

## Build on a Mac

Requires macOS with Xcode and an iOS SDK. The shell targets iOS 16+; upstream FreeRDP has its own build requirements. Install XcodeGen separately, then from this directory:

```sh
swift test
xcodegen generate
xcodebuild -project RDPLinkNative.xcodeproj -scheme RDPLinkNative \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Open the generated project in Xcode. Set a unique bundle identifier and your signing team for an iPhone. Generated projects and Swift build output are ignored. The package alone is a core library, not an installable app; XcodeGen supplies the application target. No FreeRDP binaries are currently needed for the shell. XcodeGen/project generation, Swift compilation, Keychain behavior and the simulator/device app have **not been verified on the Linux development host**.

Run `swift test` for profile serialization/validation, corrupt-data preservation and the unavailable engine. Run the unchanged root `npm test` for the fallback. There is no root web build script. Keychain and scene behavior require Mac/device validation, not a claim from the portable core tests.

## What the foundation does

Create, select, update and delete profiles. Profiles persist only UUID/name/host/port/username in native UserDefaults. Password entry is cleared on save, connection attempt, disconnect and loss of active scene. Optional retention uses generic-password Keychain items keyed by profile UUID, non-synchronizing, accessible only while unlocked on this device. Turning retention off and saving deletes any old credential; deleting a profile deletes its credential first. Empty connection password uses Keychain if available. No secrets are logged or put in profile JSON. Swift strings cannot promise memory zeroing. Profile and Keychain writes are not a single transaction; errors are surfaced and partial failures should be checked on device. Invalid stored profile data blocks profile writes to avoid silent data loss.

Selecting a profile does not expose its Keychain secret. The retention switch resets to off; the UI explains that saving in this state removes a saved password. Passwords are not migrated from the web app. No automatic retries or background modes are configured. Inactive scenes cancel connection work and disconnect; returning to the app requires a manual connection attempt. The generation token rejects late events from canceled attempts.

The RDP interface accepts destination, credentials and certificate policy, emits copied BGRA frames/session events, accepts pointer/keyboard input and exposes cancellation. `UnavailableRDPEngine` fails immediately and emits no connection events. Neither input forwarding nor rendering nor certificate pinning is implemented yet. See [migration plan](MIGRATION.md).

## Validation record — 4 October 2026

Starting branch: main. Clean worktree. Fresh origin fetch: HEAD and origin/main both `31fabc5b05bf738e50dfe40faf15bcc56d4ce5b7`. Root npm tests: 53 passed with local socket permission; sandbox-only run initially failed in gateway tests due to denied socket/stream access. Swift and xcodebuild are absent. Native tests are supplied but not executed. No live server test, signing, codec build or App Store validation has occurred.
