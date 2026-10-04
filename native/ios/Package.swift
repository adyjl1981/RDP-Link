// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "RDPLinkCore", platforms: [.iOS(.v16)], products: [
    .library(name: "RDPLinkCore", targets: ["RDPLinkCore"])
], targets: [.target(name: "RDPLinkCore"), .testTarget(name: "RDPLinkCoreTests", dependencies: ["RDPLinkCore"])])
