# RDP-Link user manual

This manual covers the **web version** of RDP-Link on Ubuntu. You run the gateway
and control panel on Ubuntu, then use Safari on an iPhone to control an Ubuntu
remote desktop. A native iOS app is not required.

All network addresses and names in this manual are fictional examples or
placeholders. Replace them with your own values. No credentials are supplied.
Run terminal commands on the Ubuntu machine unless a step says otherwise.

## Contents

1. [What you need](#1-what-you-need)
2. [Install the prerequisites](#2-install-the-prerequisites)
3. [Download RDP-Link](#3-download-rdp-link)
4. [Prepare Ubuntu Remote Desktop](#4-prepare-ubuntu-remote-desktop)
5. [Configure and start RDP-Link](#5-configure-and-start-rdp-link)
6. [Open the control panel and install icons](#6-open-the-control-panel-and-install-icons)
7. [Choose LAN access](#7-choose-lan-access)
8. [Set up Tailscale for access away from home](#8-set-up-tailscale-for-access-away-from-home)
9. [Connect and use the remote desktop](#9-connect-and-use-the-remote-desktop)
10. [Start at boot and everyday controls](#10-start-at-boot-and-everyday-controls)
11. [Configuration reference and terminal alternatives](#11-configuration-reference-and-terminal-alternatives)
12. [Troubleshooting](#12-troubleshooting)
13. [Updates, backups and removal](#13-updates-backups-and-removal)

## 1. What you need

- An Ubuntu desktop with built-in RDP support, such as Ubuntu 24.04 LTS or later.
  Settings labels may vary between releases.
- An administrator account for installing software and configuring services.
- Docker Engine with the `docker compose` plugin, using the system Docker daemon.
  The boot installer expects a system service named `docker.service`; rootless
  Docker and Docker Desktop are not covered by that installer.
- Python 3 with Tk for the Ubuntu control panel. The Docker image supplies Node.js
  for the web gateway; you do not need Node.js installed on Ubuntu for normal use.
- An iPhone with Safari, or another suitable browser/device for testing.
- Internet access for downloading dependencies. Away-from-home access also needs
  Tailscale on Ubuntu and on the connecting device.

The Ubuntu machine must remain powered on, awake and connected to its network.
Starting the gateway at boot does not wake the machine or automatically sign in
to a graphical desktop. Desktop Sharing needs an existing desktop session;
Remote Login has different session requirements.

### Choose how you will connect

| Choice | Browser address | Requirements |
| --- | --- | --- |
| Local test on Ubuntu | `http://localhost:8080` | Gateway running on loopback |
| LAN only | `http://YOUR_LAN_IP:8080` | Both devices on the same trusted private network |
| Outside the LAN | The HTTPS URL shown by Tailscale Serve | Both devices connected to the same permitted tailnet |

A **tailnet** is your private Tailscale network. The outside-LAN option uses
private Tailscale HTTPS access. It does not publish a public website.
There is no separate RDP-Link gateway account or access key. Restrict network
access to people you trust; RDP credentials are still required to open a desktop.
LAN HTTP does not encrypt browser-to-gateway traffic. Prefer Tailscale HTTPS
when confidentiality on the local network matters. Do not forward the gateway,
guacd or RDP ports from your router to the public internet for this setup.

## 2. Install the prerequisites

### Basic desktop tools

```sh
sudo apt update
sudo apt install git curl ca-certificates python3 python3-tk pkexec xdg-utils desktop-file-utils
```

The control panel uses PolicyKit (`pkexec`) for administrator authentication and
Ubuntu's terminal application for the optional boot installer. Use the panel as
your normal desktop user, not as root.

### Docker Engine and Compose

If Docker already works, check it first and skip installation:

```sh
docker --version
docker compose version
docker info
```

For a fresh supported Ubuntu installation, the following uses Docker's package
repository. If you already have another Docker installation, consult the
[official Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/)
for conflicts and migration before changing packages.

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker.service
```

Give your normal account Docker access:

```sh
sudo usermod -aG docker "$(id -un)"
```

**Sign out of Ubuntu completely and sign back in**, then check:

```sh
docker info
docker compose version
docker run --rm hello-world
```

Docker group membership grants extensive control over the machine. Grant it only
to trusted users. See Docker's [Linux post-installation guide](https://docs.docker.com/engine/install/linux-postinstall/).
Continue only when Docker works without `sudo`, because the panel and boot
service run Docker as your normal account.

## 3. Download RDP-Link

Obtain the **web repository** URL from the project's source/download page or
maintainer. In the command below, replace the quoted placeholder with that URL.
Do not use the separate native iOS repository.

```sh
git clone "REPLACE_WITH_WEB_REPOSITORY_URL" "$HOME/RDP-Link"
cd "$HOME/RDP-Link"
```

If you already have a checkout, open it instead of cloning over it. The examples
use `~/RDP-Link`; if you chose another location, use that location throughout.
Keep the checkout in a permanent location: the boot service and desktop launchers
refer to its absolute path.

## 4. Prepare Ubuntu Remote Desktop

1. On the Ubuntu desktop, open **Settings → System → Remote Desktop**.
2. Choose **Desktop Sharing** to control the existing signed-in desktop, or
   **Remote Login** for login access. Enable remote control if offered.
3. Note the **port**, **username** and **password** shown for the selected mode.
   Do not assume the RDP password is your normal Ubuntu login password.
4. Keep these details private. You will enter the password in the browser when
   connecting; it does not belong in `.env`.

If both modes are enabled, they can use different ports. Always use the displayed
port rather than assuming `3389`. For version-specific session requirements,
see [Ubuntu's Remote Desktop guide](https://documentation.ubuntu.com/desktop/en/latest/how-to/share-your-desktop-remotely/).

For a desktop on the same Ubuntu machine as Docker, the connection form's
**Desktop address** will be `host.docker.internal`. This special name is resolved
inside the guacd container. Ubuntu's RDP server must accept connections from
Docker's network; an RDP listener restricted to localhost is insufficient.
If a firewall blocks this connection, allow only the required RDP port from the
actual Docker network. Do not add a broad public RDP rule as a shortcut.

### Understand the two addresses

- **Browser address:** where Safari opens the RDP-Link website, for example
  `http://192.168.1.50:8080` or the HTTPS URL from Tailscale.
- **Desktop address:** what the gateway connects to using RDP, for example
  `host.docker.internal` with the port from Ubuntu settings.

They serve different purposes. Do not enter the website URL into Desktop address.

## 5. Configure and start RDP-Link

In the checkout, create your private settings file **once**:

```sh
cd "$HOME/RDP-Link"
cp -n .env.example .env
chmod 600 .env
nano .env
```

`cp -n` leaves an existing `.env` alone. In the editor, start with:

```dotenv
PUBLIC_ORIGINS=http://localhost:8080
RDP_TARGETS=host.docker.internal:3389
RDP_IGNORE_CERT=false
RDP_BIND_ADDRESS=127.0.0.1
```

Replace `3389` if Ubuntu shows a different port. Save with **Ctrl+O**, Enter,
then exit with **Ctrl+X**. Keep each setting on its own line.
These initial settings permit a local browser test; choose phone access later.

### RDP certificates

With `RDP_IGNORE_CERT=false`, guacd verifies the remote desktop's certificate.
A self-signed certificate may cause the RDP connection to fail. Prefer a
certificate chain trusted by guacd. Managing that trust inside a custom container
image is an advanced administrator task, outside this basic setup.

For a known, trusted desktop using a self-signed certificate, you can explicitly
choose `RDP_IGNORE_CERT=true` in `.env`. This disables RDP certificate verification
and reduces protection against impersonation. It does not affect Safari's HTTPS
certificate checking. Do not change it merely to bypass an unexplained error.

### Build and start

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

The first start downloads guacd and builds the gateway image, so it can take time.
Both `gateway` and `guacd` should be running. In Ubuntu's browser, open
`http://localhost:8080`. You should see the RDP-Link connection form.
A visible form proves the website loads; a successful RDP connection is a separate
check. An allowlist error after opening an IP instead of `localhost` means you
need to configure that exact browser origin.

## 6. Open the control panel and install icons

From the checkout, run as your normal desktop user:

```sh
./install_desktop.py
./control_panel.py
```

The icon installer adds **RDP-Link** to your application menu and configured
desktop folder. Search for **RDP-Link** in Ubuntu's app menu. If prompted,
right-click the desktop icon and select **Allow Launching**. Rerunning the installer
updates its existing shortcuts; it refuses to overwrite an unrelated launcher.
Closing the panel leaves the gateway running.

| Panel item | Meaning or action |
| --- | --- |
| Outside LAN | Shows matching Tailscale Serve routes: enabled, disabled, disconnected, or unknown |
| Gateway binding | Shows the address/port published by Docker |
| Containers | Shows gateway/guacd status separately from the boot service |
| Refresh | Reads current status; use after changes made outside the panel |
| Start / Stop | Starts or stops the service, or Compose directly when no boot service exists |
| Install boot service | Opens setup in a terminal when no service exists |
| Enable / Disable at boot | Changes the boot preference without starting/stopping the stack |
| Apply access choice | Changes binding and trusted origin, recreates the stack, and configures the selected access mode |

Changing access or stopping the stack may disconnect active sessions. Administrator
actions show an authentication prompt. Existing boot services must point to this
checkout before the panel controls them.

**Outside LAN: Enabled** reports a configured RDP-Link Serve route with Tailscale
connected; it does not prove the gateway or RDP desktop is reachable. It also
identifies public Funnel if previously configured. Other proxies, direct
Tailscale-IP access and router forwarding are not detected by this indicator.

## 7. Choose LAN access

Use this option when both devices are on the same trusted home/office network.
Tailscale is not needed for this mode.

1. On Ubuntu, find the active Wi-Fi/Ethernet IPv4 address in **Settings → Network**
   or **Wi-Fi → connection details**. `hostname -I` also lists assigned addresses;
   it may include Docker and VPN addresses, so select the physical LAN connection.
2. In the panel choose **LAN only**. Enter that private IPv4 address. The suggested
   address may need correcting if the machine has multiple interfaces.
3. Click **Apply access choice…** and confirm the change.
4. On the iPhone, connect to the same LAN and open `http://YOUR_LAN_IP:8080` in Safari.
   For example, if your address were `192.168.1.50`, use `http://192.168.1.50:8080`.
5. Continue with [the connection form](#9-connect-and-use-the-remote-desktop).

The panel accepts assigned RFC1918 addresses (`10.*`, `172.16–31.*`, `192.168.*`).
It binds to the chosen address rather than all interfaces and trusts only that
browser origin. It removes the matching RDP-Link Tailscale Serve route if present,
but refuses to modify conflicting content or Funnel settings. It does not change
other proxies, firewall or router rules. Docker-published ports can bypass ordinary
UFW rules; do not rely on UFW alone to restrict them. See [Docker's firewall notes](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

Reserve the address in your router's DHCP settings so it stays stable. If the
address changes, apply LAN access again. Guest Wi-Fi/client isolation can prevent
devices on the same router from reaching each other.

## 8. Set up Tailscale for access away from home

Tailscale is optional. Use this route to reach RDP-Link through a private network
while the iPhone is on mobile data or another Wi-Fi network.

### A. Install and connect Tailscale on Ubuntu

If already installed and connected, run `tailscale status` and skip installation.
Otherwise, download the official installer, inspect it, and run it:

```sh
curl -fsSL https://tailscale.com/install.sh -o /tmp/rdp-link-tailscale-install.sh
less /tmp/rdp-link-tailscale-install.sh
sh /tmp/rdp-link-tailscale-install.sh
sudo systemctl enable --now tailscaled.service
sudo tailscale up
```

Press **q** to leave `less`. The installer may ask for your administrator password.
`tailscale up` supplies a sign-in link. Open it, sign in, and approve the Ubuntu
device. If you belong to several tailnets, choose the one you will use on the
phone. Check that the Ubuntu device appears in your Tailscale device list:

```sh
tailscale status
```

Use the [official Linux installation instructions](https://tailscale.com/docs/install/linux)
if the installer reports an unsupported system or you prefer package-specific steps.

### B. Install and connect Tailscale on the iPhone

1. Install **Tailscale** from the App Store using the link in the
   [official iOS guide](https://tailscale.com/docs/install/ios).
2. Open it and sign into the same tailnet used by Ubuntu.
3. Accept iOS's request to add a VPN configuration, then connect Tailscale.
4. Confirm that the Ubuntu device is listed. If your tailnet requires device
   approval, have its administrator approve the devices and permit access.

Tailscale must remain connected on the phone when using the private HTTPS URL.
An exit node, subnet router and router port forwarding are not required here.

### C. Enable Serve/HTTPS and choose outside-LAN access

On a new tailnet, HTTPS may need approval. Use a terminal for the initial setup so
you can see any consent URL. Before configuring port 443, inspect existing routes:

```sh
tailscale serve status
```

If HTTPS port 443 already serves another application, stop here and resolve the
conflict with its administrator. Do not reset or overwrite unrelated routes.
If unused, or already serving this RDP-Link gateway, run:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

If Tailscale displays a setup/consent link, open it and approve the required HTTPS
settings with an account allowed to manage the tailnet. Rerun the command if
requested. Use **Serve**, not **Funnel**. Follow the
[official Serve setup guide](https://tailscale.com/docs/features/tailscale-serve)
for consent and access-policy requirements.

Then open the RDP-Link control panel:

1. Select **Outside the LAN — private Tailscale HTTPS**.
2. Click **Apply access choice…**, confirm the change and authenticate if asked.
3. Click **Refresh**. Outside LAN should show **Enabled (private Tailscale)** and
   your own HTTPS address.
4. Check `tailscale serve status` if you need to copy the full URL.

The panel sets the gateway binding to `127.0.0.1`, trusts the actual HTTPS origin,
and configures Serve to forward to `http://127.0.0.1:8080`. Applying this mode
replaces a previous LAN binding and origin; the old LAN browser URL no longer
works. The panel does not install or sign into Tailscale for you.

### D. Test from the iPhone

1. While on home Wi-Fi, leave Tailscale connected and open the exact HTTPS URL
   shown for your Ubuntu machine in Safari.
2. Connect to the desktop using [section 9](#9-connect-and-use-the-remote-desktop).
3. Disconnect the RDP session, turn off Wi-Fi on the phone, and keep Tailscale
   connected over mobile data.
4. Reopen the same HTTPS address and connect again.
5. Restore Wi-Fi afterward if wanted.

A successful mobile-data session tests outside-LAN access. The panel's status
alone does not. Your Ubuntu machine still needs power, network access and a
working RDP session/server.

### E. What persists and how to turn it off

Background Serve configuration (`--bg`) persists across reboots while Tailscale
is running and authenticated. This is independent of starting the Docker stack.
See the [Serve command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

To switch to LAN access, apply **LAN only** in the panel. To turn off just the
known RDP-Link HTTPS route without opening a LAN listener, first confirm that
port 443 contains only that route with `tailscale serve status`, then run:

```sh
sudo tailscale serve --bg --https=443 off
```

This removes the port's Serve configuration, so do not use it if it also serves
other content. Refresh the panel afterward. Stopping RDP-Link leaves Serve's route
configured but without a running backend. Disconnecting Tailscale affects all
services using it, so it is not the normal way to disable only RDP-Link access.

## 9. Connect and use the remote desktop

Open your configured browser URL on the iPhone. In the connection form:

| Field | What to enter |
| --- | --- |
| Profile name | A name you choose, such as `My desktop` |
| Desktop address | `host.docker.internal` when Ubuntu's RDP server is on the Docker host |
| Port | The RDP port shown in Ubuntu settings; it must match `.env` |
| Username | The remote desktop username shown in Ubuntu settings |
| RDP password | That desktop's RDP password, entered for each connection |

Tap **Save profile** if you want to retain the address, port, username and zoom
preference on this browser/device, then tap **Connect**. Passwords are not saved.
The address and port must exactly match a pair in `RDP_TARGETS`; substituting an
IP for an allowed hostname does not count as the same destination.

Select a saved desktop to reuse or edit it. **Delete selected profile** removes
it from this browser. Profiles are stored per browser origin: switching from a
LAN URL to a Tailscale URL can show a different saved-profile list.

### Touch and session controls

| Gesture/control | Action |
| --- | --- |
| Move one finger | Move the remote pointer like a trackpad |
| Tap | Left-click at the pointer |
| Hold about half a second | Right-click |
| Two-finger vertical movement | Scroll |
| Pinch | Zoom the local view |
| Move the pointer to the view edge | Pan across the remote desktop |
| **••• → Fit screen** | Fit the desktop in the phone's view |
| **••• → Disconnect** | End the session |

The initial desktop request is 1920×1080 at 96 DPI. Zoom, rotation and keyboard
layout changes adjust the local view; they do not resize the remote desktop or
reconnect it. Audio and drive/file redirection are not enabled.

### Keyboard and sensitive input

Open **••• → Keyboard** for the software keyboard. The local typing preview
supports typing, paste and composition. **Clear** clears only that preview;
**Done** dismisses it. Use the view arrows to pan while typing.

Tap **Hide before entering passwords or other secrets**. RDP-Link cannot reliably
recognize remote password fields. The visible preview is local typing history,
not a copy of the remote field or its caret. Changing the remote caret with the
mouse or application can make edits diverge; clear or reopen the preview after
switching fields. Hiding/dismissing the keyboard or disconnecting discards the
preview. It is not saved to local storage.

### Clipboard and reconnecting

Use **••• → Clipboard** to exchange text explicitly. **Send to desktop** sends the
panel's text; **Copy to iPhone** copies received text when Safari permits it.
Clipboard support also depends on Ubuntu's RDP server. File transfer is not offered.

A lost connection, leaving the page or an explicit disconnect ends the session.
Reconnect by entering the password and tapping Connect again. There is no automatic
reconnect or password retention. Safari's **Share → Add to Home Screen** can add a
shortcut to the configured website on the phone.

## 10. Start at boot and everyday controls

Manual setup is the default: RDP-Link does not install a systemd boot service
until you explicitly opt in. Existing Docker `restart: unless-stopped` policies
still restart previously running containers independently when Docker restarts.

To install the service, choose **Install boot service** in the panel or run:

```sh
cd "$HOME/RDP-Link"
./setup.sh
```

The prompt is:

```text
Start RDP-Link automatically when this machine boots? [y/N]
```

Press **Enter** or answer **n** to leave existing behavior unchanged. Answer **y**
to validate Docker access, install `/etc/systemd/system/rdp-link.service`, reload
systemd, and enable and start the service. Authenticate with sudo when requested.
The unit uses the installing user and the checkout's absolute path, waits for
Docker/network-online, starts with `docker compose up -d`, and stops with
`docker compose stop`. An active service can correctly show **active (exited)**:
its containers continue running separately.

To inspect the generated unit without installing it, run `./setup.sh --print-unit`.
To inspect an installed unit, run `systemctl cat rdp-link.service`.

Rerunning setup updates the same managed service. It refuses to overwrite an
unrelated existing service. Use only a trusted checkout, since the service runs
its Compose configuration. The installer currently accepts ordinary Linux
usernames and repository paths made from letters, digits, spaces, `/`, `.`, `_`
and `-`; move to such a path if it rejects unusual characters.

| Task | Control panel | Terminal equivalent |
| --- | --- | --- |
| Start now | Start | `sudo systemctl start rdp-link.service` |
| Stop now | Stop | `sudo systemctl stop rdp-link.service` |
| Enable boot startup only | Enable at boot | `sudo systemctl enable rdp-link.service` |
| Disable boot startup only | Disable at boot | `sudo systemctl disable rdp-link.service` |
| Check status | Refresh | `systemctl status rdp-link.service` |

Without an installed service, use `docker compose up -d` and `docker compose stop`
from the checkout instead. Disabling the boot preference alone leaves running
containers running. To stop now and disable boot startup, run
`sudo systemctl disable --now rdp-link.service` or use both panel actions.
Stopping the containers also matters for their Docker restart policies.

To verify reboot behavior, save your work, arrange local access, reboot when
convenient, then check the panel, containers and actual phone connection. This
manual does not imply that boot startup also signs in, unlocks the desktop,
overrides sleep settings or fixes RDP session availability.

## 11. Configuration reference and terminal alternatives

`.env` is private local configuration, ignored by Git. Keep it mode 0600 and do
not paste it into support requests. Changes take effect after `docker compose up -d`.

| Setting | Purpose |
| --- | --- |
| `PUBLIC_ORIGINS` | Comma-separated exact browser origins, such as `http://localhost:8080`; no paths, trailing slash, wildcards or credentials |
| `PUBLIC_ORIGIN` | Legacy single-origin fallback when `PUBLIC_ORIGINS` is empty/unset; default `http://localhost:8080` |
| `RDP_BIND_ADDRESS` | Host IPv4 address publishing port 8080; default `127.0.0.1` |
| `RDP_TARGETS` | Comma-separated exact desktop `host:port` pairs; no spaces between entries |
| `RDP_IGNORE_CERT` | `false` by default; `true` disables verification of the RDP server certificate |

The GUI replaces `PUBLIC_ORIGINS` with the selected URL and updates
`RDP_BIND_ADDRESS`. It preserves other settings. If Compose fails during an access
change it restores the old `.env`, but the running deployment may need repair;
a removed Serve route is not automatically restored.

### Configure LAN access without the GUI

Edit `.env`, substituting your actual assigned private LAN IP for the fictional
address below:

```dotenv
PUBLIC_ORIGINS=http://192.168.1.50:8080
RDP_BIND_ADDRESS=192.168.1.50
```

Then run `docker compose up -d`. If switching from Tailscale, separately remove
only the known RDP-Link Serve route as described in section 8.

### Configure Tailscale access without the GUI

Complete Tailscale installation, sign-in and Serve consent in section 8. Copy
the actual HTTPS origin from `tailscale serve status` into `PUBLIC_ORIGINS`
without a trailing slash, and set `RDP_BIND_ADDRESS=127.0.0.1`. Run:

```sh
docker compose up -d
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

### Additional origins and custom proxies

Advanced users can allow multiple origins with comma-separated values. The binding
must also make the chosen routes reachable; an allowlist entry alone opens no
network listener. The supplied GUI's LAN and Tailscale modes are alternatives;
applying a mode replaces custom origins.

A custom HTTPS reverse proxy can forward to `127.0.0.1:8080` instead of using
Tailscale. Configure WebSocket forwarding, preserve the browser Origin header,
and explicitly trust the proxy's browser origin. For example, Caddy can use:

```caddy
rdp.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Here `rdp.example.com` is a placeholder requiring your own DNS/certificate setup.
The gateway uses HTTP/WS behind the proxy; Safari uses HTTPS/WSS outside it.
The origin allowlist does not replace authentication or the destination allowlist.
The panel does not manage this proxy. Do not publish guacd port 4822.

## 12. Troubleshooting

Start with **Refresh** in the panel. These read-only checks are useful from the
checkout:

```sh
docker compose ps
docker compose logs --tail=100 gateway guacd
systemctl status rdp-link.service
tailscale status
tailscale serve status
```

The last two commands require Tailscale to be installed. Inspect logs locally;
redact usernames, addresses and other private data before sharing them. Do not
share `.env`, passwords, sign-in URLs or authentication tokens.

| Symptom | Checks and next steps |
| --- | --- |
| `docker compose` missing | Install the Compose plugin for your existing Docker installation; the app uses `docker compose`, not legacy `docker-compose` |
| Docker permission denied | Confirm Docker is running and your desktop login has the Docker group; sign out/in after adding membership |
| Python reports missing `tkinter` | Install `python3-tk`, then reopen the panel |
| Panel cannot open a display | Launch it from your Ubuntu graphical desktop as the normal user, not an SSH session without graphical access |
| Administrator prompt fails | Confirm `pkexec`, a desktop authentication agent and administrator rights; boot setup can also run in a terminal |
| Icon missing from menu | Rerun `./install_desktop.py`; search for RDP-Link, and sign out/in if the desktop has cached the menu |
| Desktop icon opens as text | Right-click → Allow Launching; executable/trusted desktop launchers depend on the desktop environment |
| Local page will not load | Check both containers, the gateway binding and whether port 8080 is occupied; use `localhost`, not an untrusted IP origin |
| LAN page will not load | Check assigned IP, port, same network, guest/client isolation and binding; an obsolete DHCP address needs reapplying |
| Tailscale page will not load | Both devices must be connected to the correct tailnet; check Ubuntu power/network, Serve route, HTTPS consent, access policy and any expired device authentication |
| Outside LAN is Unknown | The panel cannot read Tailscale state; inspect `tailscale status` and `tailscale serve status` rather than treating this as disabled |
| Outside LAN is Enabled but fails | A configured route is not an end-to-end test; check the gateway containers, then test from another device |
| Access application refuses port 443 | Another Serve service or Funnel is configured; review it separately instead of resetting all Serve configuration |
| Page loads but Connect is rejected | Browser origin must exactly match `PUBLIC_ORIGINS`; Desktop address and port must exactly match `RDP_TARGETS` |
| RDP connection fails | Check Ubuntu's selected sharing/login mode, its port, RDP username/password, Docker-to-host reachability and certificate verification |
| RDP works only while signed in | Check the difference between Desktop Sharing and Remote Login and the Ubuntu release's session requirements |
| Boot service is active but no desktop | Check container status and Ubuntu RDP separately; the oneshot service status does not prove either is healthy |
| Service belongs to another checkout | Inspect `systemctl cat rdp-link.service`; do not overwrite it blindly; the panel requires a matching WorkingDirectory |
| Gateway disappeared after failed access change | Inspect restored `.env` and logs, run `docker compose up -d` after fixing the cause, and reapply the intended mode |
| Clipboard or keyboard behaves differently on the phone | Check Safari permissions, server support and the local-preview limitations; clear/reopen the keyboard after changing remote fields |

If authentication or desktop sharing still fails, compare with a conventional
RDP client using the same server/port/credentials. Keep any such test private and
avoid changing multiple settings at once.

## 13. Updates, backups and removal

### Update the web app

Disconnect active sessions and save local work first:

```sh
cd "$HOME/RDP-Link"
git status --short
```

If there are changes, preserve and review them before updating; do not discard
unknown changes. With a clean checkout on the intended tracked branch:

```sh
git pull --ff-only
docker compose up --build -d
```

Check the containers and reconnect from the phone. Relaunch the panel to load its
updated code. Existing `.env` settings remain in place. Do not copy `.env.example`
over a configured `.env` during updates. External Docker/Ubuntu/Tailscale package
updates follow their own documented procedures.

### Backups and moving the checkout

Back up `.env` privately and record any custom service or proxy configuration.
Browser profiles are stored on each browser/device, not in the checkout. The
provided Compose stack does not define persistent application data volumes.

Before moving a managed checkout, stop its service. After moving, rerun `setup.sh`
and opt in again if desired, then rerun `install_desktop.py` from the new location.
Review an unmanaged/custom service manually; the installer will not replace it.

### Remove the managed boot service

```sh
./setup.sh --disable
```

This stops/disables and removes only a service marked as managed by the installer,
then reloads systemd. For an unmanaged service it refuses removal; inspect that
unit and disable it through `systemctl` if appropriate.

### Remove access, containers and shortcuts

1. Remove only the matching RDP-Link Serve route, following section 8, if enabled.
2. Stop/disable the boot service first so it cannot restart the stack.
3. From the checkout, run `docker compose down` to remove this stack's containers
   and network. This disconnects sessions; it does not uninstall Docker or Tailscale.
4. Delete `org.rdp-link.ControlPanel.desktop` from your configured desktop folder
   and `~/.local/share/applications` (or `$XDG_DATA_HOME/applications` if customized).
5. Remove saved browser profiles with **Delete selected profile** if desired.
   Remove any iPhone Home Screen shortcut separately.
6. Delete the checkout only after saving any configuration you want to keep.

Keep Docker and Tailscale installed if other applications use them. This process
does not disable Ubuntu Remote Desktop; change that separately in Ubuntu settings
if you no longer want it available.
