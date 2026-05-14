import Foundation

enum TinyTOMLValue: Equatable {
    case string(String)
    case int(Int)
    case stringArray([String])
}

struct TinyTOML {
    var values: [String: TinyTOMLValue]

    static func parse(_ source: String) throws -> TinyTOML {
        var section: String?
        var values: [String: TinyTOMLValue] = [:]

        for (zeroBasedLine, rawLine) in source.components(separatedBy: .newlines).enumerated() {
            let lineNumber = zeroBasedLine + 1
            let line = stripComment(rawLine).trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                continue
            }

            if line.hasPrefix("[") {
                guard line.hasSuffix("]"), line.count > 2 else {
                    throw AppifyCoreError.parseError(line: lineNumber, "Invalid section header.")
                }
                section = String(line.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
                guard section?.isEmpty == false else {
                    throw AppifyCoreError.parseError(line: lineNumber, "Section name is empty.")
                }
                continue
            }

            guard let equals = line.firstIndex(of: "=") else {
                throw AppifyCoreError.parseError(line: lineNumber, "Expected key = value.")
            }

            let key = line[..<equals].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else {
                throw AppifyCoreError.parseError(line: lineNumber, "Key is empty.")
            }

            let rawValue = line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
            let fullKey = section.map { "\($0).\(key)" } ?? String(key)
            guard values[fullKey] == nil else {
                throw AppifyCoreError.parseError(line: lineNumber, "Duplicate key \(fullKey).")
            }

            values[fullKey] = try parseValue(String(rawValue), line: lineNumber)
        }

        return TinyTOML(values: values)
    }

    func requiredString(_ key: String) throws -> String {
        guard let value = values[key] else {
            throw AppifyCoreError.invalidManifest("Missing required key \(key).")
        }
        guard case .string(let string) = value else {
            throw AppifyCoreError.invalidManifest("\(key) must be a string.")
        }
        return string
    }

    func optionalString(_ key: String) throws -> String? {
        guard let value = values[key] else {
            return nil
        }
        guard case .string(let string) = value else {
            throw AppifyCoreError.invalidManifest("\(key) must be a string.")
        }
        return string
    }

    func requiredInt(_ key: String) throws -> Int {
        guard let value = values[key] else {
            throw AppifyCoreError.invalidManifest("Missing required key \(key).")
        }
        guard case .int(let int) = value else {
            throw AppifyCoreError.invalidManifest("\(key) must be an integer.")
        }
        return int
    }

    func optionalStringArray(_ key: String) throws -> [String]? {
        guard let value = values[key] else {
            return nil
        }
        guard case .stringArray(let array) = value else {
            throw AppifyCoreError.invalidManifest("\(key) must be an array of strings.")
        }
        return array
    }

    private static func stripComment(_ rawLine: String) -> String {
        var result = ""
        var isInString = false
        var isEscaped = false

        for character in rawLine {
            if isEscaped {
                result.append(character)
                isEscaped = false
                continue
            }

            if character == "\\" {
                result.append(character)
                isEscaped = true
                continue
            }

            if character == "\"" {
                isInString.toggle()
                result.append(character)
                continue
            }

            if character == "#", !isInString {
                break
            }

            result.append(character)
        }

        return result
    }

    private static func parseValue(_ rawValue: String, line: Int) throws -> TinyTOMLValue {
        if rawValue.hasPrefix("\"") {
            let (string, rest) = try parseQuotedString(rawValue, line: line)
            guard rest.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw AppifyCoreError.parseError(line: line, "Unexpected content after string.")
            }
            return .string(string)
        }

        if rawValue.hasPrefix("[") {
            return .stringArray(try parseStringArray(rawValue, line: line))
        }

        guard let int = Int(rawValue) else {
            throw AppifyCoreError.parseError(line: line, "Unsupported value.")
        }
        return .int(int)
    }

    private static func parseStringArray(_ rawValue: String, line: Int) throws -> [String] {
        guard rawValue.hasSuffix("]") else {
            throw AppifyCoreError.parseError(line: line, "Array must end with ].")
        }

        var rest = String(rawValue.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
        var strings: [String] = []
        while !rest.isEmpty {
            guard rest.hasPrefix("\"") else {
                throw AppifyCoreError.parseError(line: line, "Array items must be strings.")
            }
            let parsed = try parseQuotedString(rest, line: line)
            strings.append(parsed.string)
            rest = parsed.rest.trimmingCharacters(in: .whitespaces)
            if rest.isEmpty {
                break
            }
            guard rest.hasPrefix(",") else {
                throw AppifyCoreError.parseError(line: line, "Array items must be separated by commas.")
            }
            rest = String(rest.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        return strings
    }

    private static func parseQuotedString(_ rawValue: String, line: Int) throws -> (string: String, rest: String) {
        var result = ""
        var isEscaped = false
        var index = rawValue.index(after: rawValue.startIndex)

        while index < rawValue.endIndex {
            let character = rawValue[index]
            index = rawValue.index(after: index)

            if isEscaped {
                switch character {
                case "\"", "\\":
                    result.append(character)
                case "n":
                    result.append("\n")
                case "t":
                    result.append("\t")
                default:
                    throw AppifyCoreError.parseError(line: line, "Unsupported string escape \\\(character).")
                }
                isEscaped = false
                continue
            }

            if character == "\\" {
                isEscaped = true
                continue
            }

            if character == "\"" {
                return (result, String(rawValue[index...]))
            }

            result.append(character)
        }

        throw AppifyCoreError.parseError(line: line, "Unterminated string.")
    }
}
