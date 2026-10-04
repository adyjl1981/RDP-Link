import Foundation

public struct Credentials {
    public let password: String
    public init(password: String) { self.password = password }
}
public enum CertificatePolicy: Equatable {
    case systemTrust
    /// SHA-256 DER certificate digest, bound to this host and port by the adapter.
    /// Only set after the user compares GNOME's displayed encryption fingerprint.
    case pinnedSHA256(Data)
}
public struct DesktopFrame {
    public let width: Int
    public let height: Int
    public let bytesPerRow: Int
    public let bgra: Data
    public init(width: Int, height: Int, bytesPerRow: Int, bgra: Data) {
        self.width = width; self.height = height; self.bytesPerRow = bytesPerRow; self.bgra = bgra
    }
}
public enum RDPEvent {
    case connected
    case frame(DesktopFrame)
    case disconnected
}
public enum RDPInput {
    case pointer(x: Int, y: Int)
    case button(number: Int, down: Bool)
    case wheel(delta: Int)
    case scanCode(UInt16, down: Bool, extended: Bool)
    case unicode(UInt16, down: Bool)
}
/// Future adapter owns FreeRDP context/event loop on a dedicated worker, never the UI thread.
/// Yield copied, bounded frames; reject certificates before authentication; cancel joins worker.
/// Stream completion/error must follow full native context cleanup, including cancellation.
public protocol RDPEngine: AnyObject {
    func connect(profile: Profile, credentials: Credentials, certificate: CertificatePolicy) -> AsyncThrowingStream<RDPEvent, Error>
    func send(_ input: RDPInput) throws
    func disconnect()
}
public enum EngineError: Error { case unavailable }
/// Honest foundation: no sockets, FreeRDP library, simulated desktop, or success event.
public final class UnavailableRDPEngine: RDPEngine {
    public init() {}
    public func connect(profile: Profile, credentials: Credentials, certificate: CertificatePolicy) -> AsyncThrowingStream<RDPEvent, Error> {
        AsyncThrowingStream { $0.finish(throwing: EngineError.unavailable) }
    }
    public func send(_ input: RDPInput) throws { throw EngineError.unavailable }
    public func disconnect() {}
}
