import Foundation
import AppifyHostCore

enum AppifyHostRuntime {
    static var configuration: AppifyHostConfiguration?

    static func loadConfiguration() throws -> AppifyHostConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let bundleURL: URL
        if let bundlePath = environment["APPIFY_HOST_BUNDLE_PATH"], !bundlePath.isEmpty {
            bundleURL = URL(fileURLWithPath: bundlePath, isDirectory: true)
        } else {
            bundleURL = Bundle.main.bundleURL
        }

        let loadedConfiguration = try AppifyHostConfigurationLoader.load(bundleURL: bundleURL, environment: environment)
        configuration = loadedConfiguration
        return loadedConfiguration
    }

    static func requireConfiguration() throws -> AppifyHostConfiguration {
        if let configuration {
            return configuration
        }

        return try loadConfiguration()
    }
}
