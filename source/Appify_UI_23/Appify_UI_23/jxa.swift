import Cocoa

func compileAndExecuteJXA(named scriptName: String) {
  let jxaPathBase = "\(scriptName).jxa"
  let scptPathBase = "\(scriptName)"

  DispatchQueue.global(qos: .background).async {
    // Paths for the source and compiled scripts
    guard
      let scriptPath = Bundle.main.path(
        forResource: jxaPathBase, ofType: "js", inDirectory: "Scripts")
    else {
      print("Script not found: \(jxaPathBase).js")
      return
    }

    var compiledScriptPath = scriptPath.replacingOccurrences(of: ".jxa.js", with: ".scpt")

    let shouldRecompile: Bool
    if let scptModificationDate = try? FileManager.default.attributesOfItem(
      atPath: compiledScriptPath)[.modificationDate] as? Date,
      let jsModificationDate = try? FileManager.default.attributesOfItem(atPath: scriptPath)[
        .modificationDate] as? Date
    {
      shouldRecompile = jsModificationDate > scptModificationDate
    } else {
      shouldRecompile = true
    }

    if shouldRecompile {
      print("Compiled script not found or outdated: \(scptPathBase).scpt. Compiling...")
      print("Compiling and executing JXA script: \(scriptPath) -> \(compiledScriptPath)")

      // Compile the .jxa.js to .scpt using osacompile
      let compileProcess = Process()
      compileProcess.executableURL = URL(fileURLWithPath: "/usr/bin/osacompile")
      compileProcess.arguments = ["-l", "JavaScript", "-o", compiledScriptPath, scriptPath]

      do {
        try compileProcess.run()
        compileProcess.waitUntilExit()

        if compileProcess.terminationStatus != 0 {
          print("Compilation failed with status: \(compileProcess.terminationStatus)")
          return
        }
      } catch {
        print("Failed to compile script: \(error.localizedDescription)")
        return
      }
    }

    print("Compiled script found or up-to-date: \(scptPathBase).scpt")
    compiledScriptPath =
      Bundle.main.path(forResource: scptPathBase, ofType: "scpt", inDirectory: "Scripts")
      ?? compiledScriptPath

    // Execute the compiled script on the main thread
    DispatchQueue.main.async {
      print("Executing compiled script: \(compiledScriptPath)")
      executeAppleScript(at: compiledScriptPath)
    }
  }
}

func executeAppleScript(at path: String) {
  var error: NSDictionary?
  if let appleScript = NSAppleScript(contentsOf: URL(fileURLWithPath: path), error: &error) {
    let executionOutput = appleScript.executeAndReturnError(&error)
    if let output = executionOutput.stringValue {
      print("Output: \(output)")
    } else if let error = error {
      print("Execution error: \(error)")
    }
  } else if let error = error {
    print("Error initializing AppleScript: \(error)")
  }
}
