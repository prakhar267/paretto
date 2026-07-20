// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PasAPasCore",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "PasAPasCore", targets: ["PasAPasCore"]),
    ],
    targets: [
        .target(
            name: "PasAPasCore",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "PasAPasCoreTests",
            dependencies: ["PasAPasCore"]
        ),
    ]
)
