// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PasAPas",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "PasAPas", targets: ["PasAPas"]),
    ],
    dependencies: [
        .package(path: "../PasAPasCore"),
    ],
    targets: [
        .executableTarget(
            name: "PasAPas",
            dependencies: ["PasAPasCore"],
            path: "PasAPasApp",
            exclude: [
                "Assets.xcassets",
                "Info.plist",
                "PasAPas.entitlements",
                "PrivacyInfo.xcprivacy",
            ]
        ),
        .testTarget(
            name: "PasAPasTests",
            dependencies: ["PasAPas", "PasAPasCore"],
            path: "PasAPasTests"
        ),
    ]
)
