// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "BotAvatarsKit", platforms: [.macOS("12.3")],
    products: [.library(name: "BotAvatarsKit", targets: ["BotAvatarsKit"])],
    targets: [.target(name: "BotAvatarsKit")])
