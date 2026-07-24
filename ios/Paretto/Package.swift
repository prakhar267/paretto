// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Paretto",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Paretto", targets: ["Paretto"]),
    ],
    dependencies: [
        .package(path: "../ParettoCore"),
    ],
    targets: [
        .executableTarget(
            name: "Paretto",
            dependencies: ["ParettoCore"],
            path: "ParettoApp",
            exclude: [
                "Assets.xcassets",
                "Info.plist",
                "Paretto.entitlements",
                "PrivacyInfo.xcprivacy",
            ]
        ),
        .testTarget(
            name: "ParettoTests",
            dependencies: ["Paretto", "ParettoCore"],
            path: "ParettoTests"
        ),
    ]
)
