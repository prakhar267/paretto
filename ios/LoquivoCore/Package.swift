// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LoquivoCore",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "LoquivoCore", targets: ["LoquivoCore"]),
    ],
    targets: [
        .target(
            name: "LoquivoCore",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "LoquivoCoreTests",
            dependencies: ["LoquivoCore"]
        ),
    ]
)
