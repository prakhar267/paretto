// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Loquivo",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Loquivo", targets: ["Loquivo"]),
    ],
    dependencies: [
        .package(path: "../LoquivoCore"),
    ],
    targets: [
        .executableTarget(
            name: "Loquivo",
            dependencies: ["LoquivoCore"],
            path: "LoquivoApp",
            exclude: [
                "Assets.xcassets",
                "Info.plist",
                "Loquivo.entitlements",
                "PrivacyInfo.xcprivacy",
            ]
        ),
        .testTarget(
            name: "LoquivoTests",
            dependencies: ["Loquivo", "LoquivoCore"],
            path: "LoquivoTests"
        ),
    ]
)
