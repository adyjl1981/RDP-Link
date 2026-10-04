import Foundation
import Security

struct KeychainCredentialStore {
    private let service = "com.rdplink.native.rdp-password"
    private func query(_ id: UUID) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: id.uuidString,
         kSecAttrSynchronizable as String: false]
    }
    func read(_ id: UUID) throws -> String? {
        var q = query(id)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else { throw KeychainError.status(status) }
        return value
    }
    func save(_ password: String, for id: UUID) throws {
        let attributes: [String: Any] = [kSecValueData as String: Data(password.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(id) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let inserted = SecItemAdd(query(id).merging(attributes) { _, new in new } as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw KeychainError.status(inserted) }
        } else if status != errSecSuccess { throw KeychainError.status(status) }
    }
    func delete(_ id: UUID) throws {
        let status = SecItemDelete(query(id) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.status(status) }
    }
}
enum KeychainError: Error { case status(OSStatus) }
