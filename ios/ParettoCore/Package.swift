// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ParettoCore",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ParettoCore", targets: ["ParettoCore"]),
    ],
    targets: [
        .target(
            name: "ParettoCore",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "ParettoCoreTests",
            dependencies: ["ParettoCore"]
        ),
    ]
)
