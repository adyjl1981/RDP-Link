import SwiftUI
import RDPLinkCore

@MainActor
final class SessionModel: ObservableObject {
    @Published var profiles: [Profile] = []
    @Published var message = "Foundation only — FreeRDP engine is not integrated."
    private var storageReadable = true
    private let store = ProfileStore()
    private let secrets = KeychainCredentialStore()
    private let engine: RDPEngine = UnavailableRDPEngine()
    private var connection: Task<Void, Never>?
    private var generation = UUID()
    init() {
        do { profiles = try store.load() }
        catch { storageReadable = false; message = "Saved profiles could not be read. Existing data has been preserved." }
    }
    func save(_ profile: Profile, password: String, remember: Bool) {
        guard storageReadable else { return }
        do {
            try profile.validate()
            var updated = profiles.filter { $0.id != profile.id }; updated.append(profile)
            if remember && !password.isEmpty { try secrets.save(password, for: profile.id) }
            else { try secrets.delete(profile.id) }
            try store.save(updated); profiles = updated
            message = "Profile saved. Password storage: \(remember ? "Keychain" : "off")."
        } catch { message = "Could not save profile or credential. Check fields and device access." }
    }
    func delete(_ profile: Profile) {
        guard storageReadable else { return }
        do {
            try secrets.delete(profile.id)
            let updated = profiles.filter { $0.id != profile.id }
            try store.save(updated); profiles = updated
        } catch { message = "Could not delete profile and credential." }
    }
    func connect(_ profile: Profile, password: String) {
        disconnect()
        do {
            try profile.validate()
            let secret: String
            if password.isEmpty { secret = try secrets.read(profile.id) ?? "" }
            else { secret = password }
            guard !secret.isEmpty else { message = "Enter a password or save it to Keychain first."; return }
            let attempt = generation
            message = "Attempting connection…"
            connection = Task { [weak self, engine] in
                do {
                    for try await event in engine.connect(profile: profile, credentials: Credentials(password: secret), certificate: .systemTrust) {
                        guard !Task.isCancelled, let self, self.generation == attempt else { return }
                        switch event {
                        case .connected: self.message = "Connected"
                        case .disconnected: self.message = "Disconnected"
                        case .frame: break // renderer is a later integration milestone
                        }
                    }
                } catch {
                    guard !Task.isCancelled, let self, self.generation == attempt else { return }
                    self.message = "RDP unavailable: FreeRDP is not linked. No connection was made."
                }
            }
        } catch { message = "Profile or Keychain access failed." }
    }
    func disconnect() {
        generation = UUID(); connection?.cancel(); connection = nil
        engine.disconnect(); message = "Disconnected. Reconnect manually."
    }
}
