import Foundation

/// Non-secret metadata only. A credential is addressed separately by profile UUID.
public struct Profile: Codable, Identifiable, Equatable {
    public var id: UUID
    public var name: String
    public var host: String
    public var port: Int
    public var username: String
    public init(id: UUID = UUID(), name: String, host: String, port: Int = 3389, username: String) {
        self.id = id; self.name = name; self.host = host; self.port = port; self.username = username
    }
    public func validate() throws {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !host.isEmpty, host == host.trimmingCharacters(in: .whitespacesAndNewlines),
              !host.contains(where: { $0.isWhitespace || $0.isNewline }),
              !host.contains("/"), !host.contains("@"), (1...65535).contains(port)
        else { throw ProfileError.invalidFields }
        // Host is a bare DNS name/IP (IPv6 allowed), never a gateway URL.
    }
}
public enum ProfileError: Error { case invalidFields }

public struct ProfileStore {
    private let defaults: UserDefaults
    private let key = "rdplink.native.profiles.v1"
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func load() throws -> [Profile] {
        guard let data = defaults.data(forKey: key) else { return [] }
        let profiles = try JSONDecoder().decode([Profile].self, from: data)
        try profiles.forEach { try $0.validate() }
        guard Set(profiles.map(\.id)).count == profiles.count else { throw ProfileError.invalidFields }
        return profiles
    }
    public func save(_ profiles: [Profile]) throws {
        try profiles.forEach { try $0.validate() }
        guard Set(profiles.map(\.id)).count == profiles.count else { throw ProfileError.invalidFields }
        defaults.set(try JSONEncoder().encode(profiles), forKey: key)
    }
}
