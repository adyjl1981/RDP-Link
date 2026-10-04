import XCTest
@testable import RDPLinkCore

final class CoreTests: XCTestCase {
    func testProfilesRoundTripWithoutCredentials() throws {
        let suite = "rdplink.tests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProfileStore(defaults: defaults)
        let profile = Profile(name: "Desktop", host: "192.168.1.2", port: 3390, username: "rdp")
        try store.save([profile])
        XCTAssertEqual(try store.load(), [profile])
        let data = try JSONEncoder().encode(profile)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["id", "name", "host", "port", "username"])
        try store.save([]); XCTAssertEqual(try store.load(), [])
    }
    func testRejectsURLsAndInvalidPorts() {
        for host in ["https://desktop", "user@desktop", " desktop", "a b"] {
            XCTAssertThrowsError(try Profile(name: "D", host: host, username: "u").validate())
        }
        for port in [0, 65536, -1] {
            XCTAssertThrowsError(try Profile(name: "D", host: "desktop", port: port, username: "u").validate())
        }
        XCTAssertNoThrow(try Profile(name: "D", host: "2001:db8::1", username: "u").validate())
    }
    func testCorruptStorageIsNotSilentlyOverwritten() {
        let suite = "rdplink.tests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Data("invalid".utf8), forKey: "rdplink.native.profiles.v1")
        XCTAssertThrowsError(try ProfileStore(defaults: defaults).load())
        XCTAssertEqual(defaults.data(forKey: "rdplink.native.profiles.v1"), Data("invalid".utf8))
    }
    func testUnavailableEngineNeverReportsConnected() async {
        let engine = UnavailableRDPEngine()
        do {
            for try await _ in engine.connect(profile: Profile(name: "D", host: "desktop", username: "u"), credentials: Credentials(password: "test"), certificate: .systemTrust) {
                XCTFail("Unavailable engine emitted an event")
            }
            XCTFail("Expected unavailable error")
        } catch { XCTAssertTrue(error is EngineError) }
        XCTAssertThrowsError(try engine.send(.pointer(x: 1, y: 1)))
        engine.disconnect()
    }
}
