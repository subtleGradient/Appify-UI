import { expect, test } from "bun:test";
import {
  analyzeWebForm,
  createSourceHash,
  injectDocumentHeadHTML,
  renderWebForm,
  saveWebFormSource,
} from "../src/webform";

test("analyzes compact single-file webforms without html/head/body tags", () => {
  const source = `<!doctype html>
<meta charset=utf-8>
<title>Client Intake</title>

<form>
<label>Client <input value="Acme Studio"></label>
<label>Scope <textarea>Small source</textarea></label>
<section contenteditable=true><p>Notes</p></section>
</form>`;

  const analysis = analyzeWebForm(source);

  expect(analysis.canSave).toBe(true);
  expect(analysis.forms).toHaveLength(1);
  expect(analysis.publicFields.map((field) => field.kind)).toEqual([
    "input-value",
    "textarea",
    "contenteditable",
  ]);
  expect(analysis.publicFields.every((field) => field.id.startsWith("__webformer_field_"))).toBe(true);
});

test("saves native controls and contenteditable with source-span patches", async () => {
  const source = `<!doctype html>
<meta charset=utf-8>
<title>Client Intake</title>

<form>
<label>Client
<input value="Acme Studio" autocomplete=organization>
</label>
<label>Scope
<textarea>Create a printable intake.</textarea>
</label>
<label>Ready <input type=checkbox checked></label>
<select>
<option>Low</option>
<option selected>High</option>
</select>
<section contenteditable=true><p>Old <strong>notes</strong></p></section>
</form>`;

  const result = await saveWebFormSource(source, {
    sourceHash: createSourceHash(source),
    formIndex: null,
    fields: [
      { key: "f0", value: "Beta & Co" },
      { key: "f1", value: "Thread <the> needle" },
      { key: "f2", value: false },
      { key: "f3", value: [0] },
      { key: "f4", value: "<p>New <strong>notes</strong></p>" },
    ],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected save to succeed");
  }

  expect(result.source).toContain('<input value="Beta &amp; Co" autocomplete=organization>');
  expect(result.source).toContain("<textarea>Thread &lt;the> needle</textarea>");
  expect(result.source).toContain("<label>Ready <input type=checkbox></label>");
  expect(result.source).toContain("<option selected>Low</option>");
  expect(result.source).toContain("<option>High</option>");
  expect(result.source).toContain('<section contenteditable=true><p>New <strong>notes</strong></p></section>');
  expect(result.source).not.toContain("<html");
  expect(result.source).not.toContain("<body");
});

test("rejects unknown submitted fields", async () => {
  const source = `<form><input value=ok></form>`;
  const result = await saveWebFormSource(source, {
    sourceHash: createSourceHash(source),
    fields: [
      { key: "f0", value: "still ok" },
      { key: "extra", value: "nope" },
    ],
  });

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected save to fail");
  }
  expect(result.status).toBe(400);
  expect(result.diagnostics[0]?.message).toContain("Unknown submitted field");
});

test("turns invisible persistent state into a hard diagnostic", () => {
  const analysis = analyzeWebForm(`<form><input type=hidden value=secret><input value=visible></form>`);

  expect(analysis.canSave).toBe(false);
  expect(analysis.diagnostics.some((diagnostic) => diagnostic.message.includes("Hidden inputs"))).toBe(true);
});

test("injects autosave runtime affordances without adding a web save button or viewport meta tag", async () => {
  const response = await renderWebForm(`<form><input value=ok></form>`, "sample.webform");
  const html = await response.text();

  expect(html).toContain("__webformer_status_panel");
  expect(html).toContain("<span id=__webformer_status></span>");
  expect(html).toContain("window.AppifyHost");
  expect(html).toContain("document.addEventListener(\"input\",markDirty,true)");
  expect(html).toContain("name=color-scheme");
  expect(html).toContain("__webformer_default_style");
  expect(html).toContain("ui-sans-serif");
  expect(html).toContain('id="__webformer_field_0"');
  expect(html).not.toContain("__webformer_save");
  expect(html).not.toContain(">Save</button>");
  expect(html).not.toContain("name=\"viewport\"");
});

test("injects default appearance after doctype without changing the source shape", () => {
  const source = `<!doctype html>
<meta charset=utf-8>
<title>Plain</title>
<form><input value=ok></form>`;

  const html = injectDocumentHeadHTML(source);

  expect(html.startsWith(`<!doctype html>
<meta name=color-scheme content="light dark">
<style id=__webformer_default_style>`)).toBe(true);
  expect(html).toContain("<meta charset=utf-8>");
  expect(html).not.toContain("name=\"viewport\"");
});
