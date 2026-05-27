# tw App Source

This folder is the app-specific source for `tw.app`.

`main.sh` starts `ttyd`, runs Tabiew's `tw` command for the opened data file,
and reports the loopback URL back to the shared Appify host.

## Hack On It

1. Edit `main.sh` to change terminal flags, file handling, or the `tw` command.
2. Open a supported table file such as CSV, TSV, JSON, Parquet, Arrow, SQLite,
   or Excel.
3. Reopen the document or use View > Reload after changing runtime behavior.

## Clone Into A New App

Copy `tw.app`, rename the bundle, update document types in `Contents/Info.plist`,
and replace the command in this folder. The shared host only requires a local URL
printed as `APPIFY_HOST_OPEN_URL=`.

Credits: Tabiew provides the table UI; ttyd provides the browser terminal.
