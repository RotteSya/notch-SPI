// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NotchSPI",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "Vendor/BotAvatarsKit"), .package(url: "https://github.com/mgriebling/SwiftMath.git", exact: "1.7.3")],
    targets: [
        .executableTarget(
            name: "NotchSPI",
            dependencies: [.product(name: "SwiftMath", package: "SwiftMath"), .product(name: "BotAvatarsKit", package: "BotAvatarsKit")],
            path: "Sources/NotchSPI"
        ),
        .testTarget(
            name: "NotchSPITests",
            dependencies: ["NotchSPI"],
            path: "Tests",
            sources: ["NotchSPITests"],
            resources: [.copy("Fixtures")]
        )
    ]
)
