import Foundation
import WebappHostCore

enum WebappHostRuntime {
    static var configuration: WebappHostConfiguration?

    static func loadConfiguration() throws -> WebappHostConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let bundleURL: URL
        if let bundlePath = environment["WEBAPP_HOST_BUNDLE_PATH"], !bundlePath.isEmpty {
            bundleURL = URL(fileURLWithPath: bundlePath, isDirectory: true)
        } else {
            bundleURL = Bundle.main.bundleURL
        }

        let loadedConfiguration = try WebappHostConfigurationLoader.load(bundleURL: bundleURL, environment: environment)
        configuration = loadedConfiguration
        return loadedConfiguration
    }

    static func requireConfiguration() throws -> WebappHostConfiguration {
        if let configuration {
            return configuration
        }

        return try loadConfiguration()
    }
}
