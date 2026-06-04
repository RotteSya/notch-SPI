// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NotchTutor",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "NotchTutor",
            path: "Sources/NotchTutor"
        )
    ]
)
