# Expo Field Kit

An Expo Web `.webapp` package that uses React Native Web components inside the
Webapp runner. It is intentionally web-only and avoids native-only modules so it
can demonstrate the Expo developer loop without needing an iOS or Android build.

Expo's dev server is a Terminal UI as well as a web bundler. Today Webapp opens
the printed local web URL; a future Webapp sidebar could expose the terminal log
or TTY alongside the WebView.

Run it directly:

```sh
bun install
bun dev
```
