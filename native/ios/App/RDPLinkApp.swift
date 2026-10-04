import SwiftUI
import RDPLinkCore

@main
struct RDPLinkApp: App {
    @StateObject private var model = SessionModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .privacySensitive()
                .onChange(of: scenePhase) { phase in
                    if phase != .active { model.disconnect() }
                }
        }
    }
}
struct ContentView: View {
    @ObservedObject var model: SessionModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var id = UUID()
    @State private var name = "Ubuntu"
    @State private var host = ""
    @State private var port = "3389"
    @State private var username = ""
    @State private var password = ""
    @State private var remember = false
    private var profile: Profile { Profile(id: id, name: name, host: host, port: Int(port) ?? 0, username: username) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Saved desktops") {
                    ForEach(model.profiles) { saved in
                        Button(saved.name) {
                            id = saved.id; name = saved.name; host = saved.host
                            port = String(saved.port); username = saved.username
                            password = ""; remember = false
                        }
                    }.onDelete { offsets in
                        let selected = offsets.map { model.profiles[$0] }
                        selected.forEach { model.delete($0) }
                    }
                    Button("New profile") { id = UUID(); name = "Ubuntu"; host = ""; port = "3389"; username = ""; password = ""; remember = false }
                }
                Section("Direct RDP destination") {
                    TextField("Profile name", text: $name)
                    TextField("Host or IP address", text: $host)
                    TextField("Port shown in Ubuntu settings", text: $port).keyboardType(.numberPad)
                    TextField("RDP username", text: $username)
                    SecureField("RDP password", text: $password)
                    Toggle("Save password in this device’s Keychain", isOn: $remember)
                    Text("Saving with this switch off removes any saved password for this profile.").font(.caption)
                    Button("Save profile") { model.save(profile, password: password, remember: remember); password = "" }
                    Button("Connect") { model.connect(profile, password: password); password = "" }
                    Button("Disconnect") { model.disconnect(); password = "" }
                }
                Section("Status") {
                    Text(model.message)
                    Text("Enable GNOME Desktop Sharing to use the current desktop. No gateway is used by the native design.").font(.caption)
                }
            }
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .navigationTitle("RDP-Link Native")
            .onChange(of: scenePhase) { phase in if phase != .active { password = "" } }
        }
    }
}
