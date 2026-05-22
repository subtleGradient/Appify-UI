import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { rename } from "node:fs/promises";

export const SAVE_API_PATH = "/api/save";
export const DOCUMENT_ROUTE_PATH = "/document";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const UNSUPPORTED_INPUT_TYPES = new Set(["button", "file", "hidden", "image", "reset", "submit"]);
const FORM_CONTROL_TAGS = new Set(["button", "input", "option", "select", "textarea"]);
const ALLOWED_RICH_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const URI_ATTRS = new Set(["href", "src"]);
const SAFE_ATTRS = new Set(["alt", "aria-label", "colspan", "href", "rowspan", "src", "title"]);

export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  severity: DiagnosticSeverity;
  message: string;
};

type AttributeSpan = {
  name: string;
  lowerName: string;
  fullStart: number;
  fullEnd: number;
  nameStart: number;
  nameEnd: number;
  valueStart: number | null;
  valueEnd: number | null;
  quote: '"' | "'" | null;
  rawValue: string | null;
};

type ElementSpan = {
  tagName: string;
  tagOccurrence: number;
  startTagStart: number;
  startTagEnd: number;
  endTagStart: number | null;
  endTagEnd: number | null;
  attrs: AttributeSpan[];
  selfClosing: boolean;
};

export type WebFormFieldKind =
  | "input-value"
  | "checkbox"
  | "radio"
  | "textarea"
  | "select"
  | "contenteditable";

type FieldBase = {
  key: string;
  kind: WebFormFieldKind;
  tagName: string;
  tagOccurrence: number;
  contenteditableOccurrence: number | null;
  runtimeId: string;
  explicitId: string | null;
  explicitName: string | null;
  formIndex: number | null;
  sourceIndex: number;
  element: ElementSpan;
};

export type WebFormField = FieldBase & {
  inputType?: string;
  multiple?: boolean;
  options?: ElementSpan[];
};

export type PublicFieldDescriptor = {
  key: string;
  kind: WebFormFieldKind;
  id: string;
  formIndex: number | null;
  label: string;
  optionCount?: number;
};

export type PublicFormDescriptor = {
  index: number;
  id: string;
  label: string;
  tagOccurrence: number;
};

export type WebFormAnalysis = {
  sourceHash: string;
  fields: WebFormField[];
  publicFields: PublicFieldDescriptor[];
  forms: PublicFormDescriptor[];
  diagnostics: Diagnostic[];
  canSave: boolean;
};

export type SubmittedField = {
  key: string;
  value: unknown;
};

export type SaveRequestBody = {
  sourceHash?: unknown;
  formIndex?: unknown;
  fields?: unknown;
};

export type SaveResult = {
  ok: true;
  source: string;
  sourceHash: string;
  savedFieldCount: number;
} | {
  ok: false;
  status: number;
  diagnostics: Diagnostic[];
};

type Replacement = {
  start: number;
  end: number;
  text: string;
};

export function createSourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function analyzeWebForm(source: string): WebFormAnalysis {
  const elements = scanElements(source);
  const diagnostics: Diagnostic[] = [];
  const explicitIds = new Map<string, ElementSpan[]>();

  for (const element of elements) {
    const id = getAttrValue(element, "id");
    if (id !== null) {
      explicitIds.set(id, [...(explicitIds.get(id) ?? []), element]);
    }
  }

  for (const [id, owners] of explicitIds) {
    if (owners.length > 1) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate id "${id}" appears ${owners.length} times. WebFormer needs ids to resolve to one element.`,
      });
    }
  }

  const usedRuntimeIds = new Set(explicitIds.keys());
  const forms = elements
    .filter((element) => element.tagName === "form")
    .map((element, index): PublicFormDescriptor => {
      const explicitId = getAttrValue(element, "id");
      const id = explicitId ?? allocateRuntimeId(`__webformer_form_${index}`, usedRuntimeIds);
      return {
        index,
        id,
        label: explicitId !== null ? `form#${explicitId}` : `form ${index + 1}`,
        tagOccurrence: element.tagOccurrence,
      };
    });

  const fields: WebFormField[] = [];
  let contenteditableOccurrence = 0;

  const selectableOptionsBySelect = new Map<ElementSpan, ElementSpan[]>();
  for (const select of elements.filter((element) => element.tagName === "select")) {
    selectableOptionsBySelect.set(
      select,
      elements.filter((element) => element.tagName === "option" && isInsideElement(element, select)),
    );
  }

  for (const element of elements) {
    const explicitId = getAttrValue(element, "id");
    const explicitName = getAttrValue(element, "name");
    const formIndex = resolveFormIndex(element, forms, elements, diagnostics);

    if (element.tagName === "input") {
      const inputType = (getAttrValue(element, "type") ?? "text").trim().toLowerCase() || "text";
      if (UNSUPPORTED_INPUT_TYPES.has(inputType)) {
        if (inputType === "hidden") {
          diagnostics.push({
            severity: "error",
            message: "Hidden inputs are invisible persistent state. Remove them or make the state visible before saving with WebFormer.",
          });
        } else if (inputType === "file") {
          diagnostics.push({
            severity: "error",
            message: "File inputs cannot round-trip into a single visible .webform file yet.",
          });
        }
        continue;
      }

      fields.push({
        key: `f${fields.length}`,
        kind: inputType === "checkbox" ? "checkbox" : inputType === "radio" ? "radio" : "input-value",
        tagName: element.tagName,
        tagOccurrence: element.tagOccurrence,
        contenteditableOccurrence: null,
        runtimeId: explicitId ?? allocateRuntimeId(`__webformer_field_${fields.length}`, usedRuntimeIds),
        explicitId,
        explicitName,
        formIndex,
        sourceIndex: element.startTagStart,
        element,
        inputType,
      });
      continue;
    }

    if (element.tagName === "textarea") {
      if (element.endTagStart === null) {
        diagnostics.push({
          severity: "error",
          message: "A textarea is missing its closing </textarea> tag, so WebFormer cannot patch it safely.",
        });
        continue;
      }

      fields.push({
        key: `f${fields.length}`,
        kind: "textarea",
        tagName: element.tagName,
        tagOccurrence: element.tagOccurrence,
        contenteditableOccurrence: null,
        runtimeId: explicitId ?? allocateRuntimeId(`__webformer_field_${fields.length}`, usedRuntimeIds),
        explicitId,
        explicitName,
        formIndex,
        sourceIndex: element.startTagStart,
        element,
      });
      continue;
    }

    if (element.tagName === "select") {
      if (element.endTagStart === null) {
        diagnostics.push({
          severity: "error",
          message: "A select is missing its closing </select> tag, so WebFormer cannot patch it safely.",
        });
        continue;
      }

      fields.push({
        key: `f${fields.length}`,
        kind: "select",
        tagName: element.tagName,
        tagOccurrence: element.tagOccurrence,
        contenteditableOccurrence: null,
        runtimeId: explicitId ?? allocateRuntimeId(`__webformer_field_${fields.length}`, usedRuntimeIds),
        explicitId,
        explicitName,
        formIndex,
        sourceIndex: element.startTagStart,
        element,
        multiple: hasAttr(element, "multiple"),
        options: selectableOptionsBySelect.get(element) ?? [],
      });
      continue;
    }

    if (isEditableElement(element)) {
      const currentContenteditableOccurrence = contenteditableOccurrence;
      contenteditableOccurrence += 1;

      if (FORM_CONTROL_TAGS.has(element.tagName)) {
        continue;
      }

      if (element.endTagStart === null) {
        diagnostics.push({
          severity: "error",
          message: `A contenteditable <${element.tagName}> is missing its closing tag, so WebFormer cannot patch it safely.`,
        });
        continue;
      }

      fields.push({
        key: `f${fields.length}`,
        kind: "contenteditable",
        tagName: element.tagName,
        tagOccurrence: element.tagOccurrence,
        contenteditableOccurrence: currentContenteditableOccurrence,
        runtimeId: explicitId ?? allocateRuntimeId(`__webformer_field_${fields.length}`, usedRuntimeIds),
        explicitId,
        explicitName,
        formIndex,
        sourceIndex: element.startTagStart,
        element,
      });
    }
  }

  const publicFields = fields.map((field): PublicFieldDescriptor => ({
    key: field.key,
    kind: field.kind,
    id: field.runtimeId,
    formIndex: field.formIndex,
    label: createFieldLabel(field),
    optionCount: field.kind === "select" ? field.options?.length ?? 0 : undefined,
  }));

  return {
    sourceHash: createSourceHash(source),
    fields,
    publicFields,
    forms,
    diagnostics,
    canSave: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
  };
}

export function createInjectedRuntimeHTML(analysis: WebFormAnalysis, documentName: string): string {
  const model = JSON.stringify({
    sourceHash: analysis.sourceHash,
    fields: analysis.publicFields,
    forms: analysis.forms,
    diagnostics: analysis.diagnostics,
    canSave: analysis.canSave,
    savePath: SAVE_API_PATH,
    documentName,
  }).replaceAll("</script", "<\\/script");

  return `<style id=__webformer_style>
#__webformer_bar{position:fixed;inset:auto 16px 16px 16px;z-index:2147483647;display:flex;align-items:center;gap:10px;box-sizing:border-box;padding:10px 12px;border:1px solid color-mix(in oklch,CanvasText 18%,transparent);border-radius:8px;background:color-mix(in oklch,Canvas 94%,CanvasText 6%);color:CanvasText;font:13px ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 30px color-mix(in oklch,CanvasText 18%,transparent)}
#__webformer_bar button{appearance:none;border:1px solid color-mix(in oklch,CanvasText 22%,transparent);border-radius:6px;background:Canvas;color:CanvasText;font:inherit;padding:6px 10px}
#__webformer_bar button:disabled{opacity:.55}
#__webformer_status{min-inline-size:10rem}
#__webformer_errors{margin:0;padding-inline-start:18px;color:MarkText}
#__webformer_errors:empty{display:none}
</style>
<aside id=__webformer_bar aria-label=WebFormer>
  <button id=__webformer_save type=button>Save</button>
  <span id=__webformer_status>WebFormer</span>
  <ol id=__webformer_errors></ol>
</aside>
<script type=module id=__webformer_script>
const WebFormer=${model};
let sourceHash=WebFormer.sourceHash;
const statusEl=document.getElementById("__webformer_status");
const saveButton=document.getElementById("__webformer_save");
const errorList=document.getElementById("__webformer_errors");
const setStatus=(text)=>{ statusEl.textContent=text; };
const setErrors=(items=[])=>{
  errorList.replaceChildren(...items.map((item)=>{
    const li=document.createElement("li");
    li.textContent=item.message||String(item);
    return li;
  }));
};
const elementFor=(field)=>document.getElementById(field.id)||window[field.id];
const valueFor=(field)=>{
  const element=elementFor(field);
  if(!element) throw new Error("Missing visible field: "+field.label);
  if(field.kind==="checkbox"||field.kind==="radio") return Boolean(element.checked);
  if(field.kind==="select") return Array.from(element.options).flatMap((option,index)=>option.selected?[index]:[]);
  if(field.kind==="contenteditable") return element.innerHTML;
  return element.value;
};
async function save(formIndex=null){
  if(!WebFormer.canSave) return;
  const selected=WebFormer.fields.filter((field)=>formIndex===null||field.formIndex===formIndex);
  setStatus("Saving...");
  setErrors([]);
  try{
    const response=await fetch(WebFormer.savePath,{
      method:"POST",
      headers:{"content-type":"application/json","if-match":sourceHash},
      body:JSON.stringify({sourceHash,formIndex,fields:selected.map((field)=>({key:field.key,value:valueFor(field)}))})
    });
    const body=await response.json().catch(()=>({diagnostics:[{message:"WebFormer returned a non-JSON response."}]}));
    if(!response.ok){
      setErrors(body.diagnostics||[{message:body.error||"Save failed."}]);
      setStatus("Not saved");
      return;
    }
    sourceHash=body.sourceHash;
    setStatus("Saved");
  }catch(error){
    setErrors([{message:error instanceof Error?error.message:String(error)}]);
    setStatus("Not saved");
  }
}
saveButton.disabled=!WebFormer.canSave;
saveButton.addEventListener("click",()=>save(null));
for(const form of document.forms){
  const index=Array.prototype.indexOf.call(document.forms,form);
  form.addEventListener("submit",(event)=>{
    event.preventDefault();
    save(index);
  });
}
setErrors(WebFormer.diagnostics);
if(!WebFormer.canSave) setStatus("Fix diagnostics before saving");
window.WebFormer={save};
</script>`;
}

export async function renderWebForm(source: string, documentName: string): Promise<Response> {
  const analysis = analyzeWebForm(source);
  const runtimeHTML = createInjectedRuntimeHTML(analysis, documentName);
  const fieldByTagOccurrence = createFieldTagLookup(analysis.fields);
  const formByTagOccurrence = new Map(analysis.forms.map((form) => [form.tagOccurrence, form]));
  const contenteditableByOccurrence = new Map(
    analysis.fields
      .filter((field) => field.kind === "contenteditable" && field.contenteditableOccurrence !== null)
      .map((field) => [field.contenteditableOccurrence, field]),
  );
  const tagCounters = new Map<string, number>();
  let contenteditableCounter = 0;

  const rewriter = new HTMLRewriter()
    .on("form", {
      element(element) {
        const occurrence = nextOccurrence(tagCounters, "form");
        const form = formByTagOccurrence.get(occurrence);
        if (form) {
          element.setAttribute("id", form.id);
        }
      },
    })
    .on("input", {
      element(element) {
        const occurrence = nextOccurrence(tagCounters, "input");
        const field = fieldByTagOccurrence.get(`input:${occurrence}`);
        if (field) {
          element.setAttribute("id", field.runtimeId);
        }
      },
    })
    .on("select", {
      element(element) {
        const occurrence = nextOccurrence(tagCounters, "select");
        const field = fieldByTagOccurrence.get(`select:${occurrence}`);
        if (field) {
          element.setAttribute("id", field.runtimeId);
        }
      },
    })
    .on("textarea", {
      element(element) {
        const occurrence = nextOccurrence(tagCounters, "textarea");
        const field = fieldByTagOccurrence.get(`textarea:${occurrence}`);
        if (field) {
          element.setAttribute("id", field.runtimeId);
        }
      },
    })
    .on("[contenteditable]", {
      element(element) {
        const field = contenteditableByOccurrence.get(contenteditableCounter);
        contenteditableCounter += 1;
        if (field) {
          element.setAttribute("id", field.runtimeId);
        }
      },
    })
    .onDocument({
      end(end) {
        end.append(runtimeHTML, { html: true });
      },
    });

  return rewriter.transform(new Response(source, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  }));
}

export async function saveWebFormSource(currentSource: string, body: SaveRequestBody): Promise<SaveResult> {
  const analysis = analyzeWebForm(currentSource);
  if (!analysis.canSave) {
    return {
      ok: false,
      status: 422,
      diagnostics: analysis.diagnostics,
    };
  }

  const requestedHash = typeof body.sourceHash === "string" ? body.sourceHash : null;
  if (requestedHash !== analysis.sourceHash) {
    return {
      ok: false,
      status: 409,
      diagnostics: [{
        severity: "error",
        message: "The .webform changed on disk. Reload before saving.",
      }],
    };
  }

  const formIndex = body.formIndex === null || body.formIndex === undefined
    ? null
    : typeof body.formIndex === "number" && Number.isInteger(body.formIndex)
      ? body.formIndex
      : NaN;

  if (Number.isNaN(formIndex)) {
    return {
      ok: false,
      status: 400,
      diagnostics: [{
        severity: "error",
        message: "formIndex must be null or an integer.",
      }],
    };
  }

  const expectedFields = analysis.fields.filter((field) => formIndex === null || field.formIndex === formIndex);
  if (!Array.isArray(body.fields)) {
    return {
      ok: false,
      status: 400,
      diagnostics: [{
        severity: "error",
        message: "Save payload must include a fields array.",
      }],
    };
  }

  const submitted = new Map<string, unknown>();
  const diagnostics: Diagnostic[] = [];

  for (const item of body.fields) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      diagnostics.push({ severity: "error", message: "Submitted field entries must be objects." });
      continue;
    }

    const key = (item as SubmittedField).key;
    if (typeof key !== "string") {
      diagnostics.push({ severity: "error", message: "Submitted field entry is missing a string key." });
      continue;
    }

    if (submitted.has(key)) {
      diagnostics.push({ severity: "error", message: `Field ${key} was submitted more than once.` });
      continue;
    }

    submitted.set(key, (item as SubmittedField).value);
  }

  const expectedKeys = new Set(expectedFields.map((field) => field.key));
  for (const key of submitted.keys()) {
    if (!expectedKeys.has(key)) {
      diagnostics.push({ severity: "error", message: `Unknown submitted field: ${key}.` });
    }
  }
  for (const field of expectedFields) {
    if (!submitted.has(field.key)) {
      diagnostics.push({ severity: "error", message: `Missing submitted field: ${createFieldLabel(field)}.` });
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, status: 400, diagnostics };
  }

  const replacements: Replacement[] = [];

  for (const field of expectedFields) {
    const value = submitted.get(field.key);
    const fieldReplacements = createFieldReplacements(currentSource, field, value);
    if ("diagnostics" in fieldReplacements) {
      diagnostics.push(...fieldReplacements.diagnostics);
    } else {
      replacements.push(...fieldReplacements.replacements);
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, status: 422, diagnostics };
  }

  const nextSource = applyReplacements(currentSource, replacements);
  const nextAnalysis = analyzeWebForm(nextSource);
  const verifyDiagnostics = verifySavedValues(nextSource, expectedFields, submitted);

  if (!nextAnalysis.canSave || verifyDiagnostics.length > 0) {
    return {
      ok: false,
      status: 500,
      diagnostics: [
        ...nextAnalysis.diagnostics,
        ...verifyDiagnostics,
        {
          severity: "error",
          message: "Round-trip verification failed. WebFormer refused to write a possibly corrupt save.",
        },
      ],
    };
  }

  return {
    ok: true,
    source: nextSource,
    sourceHash: createSourceHash(nextSource),
    savedFieldCount: expectedFields.length,
  };
}

export async function writeWebFormAtomically(documentPath: string, source: string): Promise<void> {
  const tempPath = resolve(dirname(documentPath), `.${randomUUID()}.${documentPath.split(sep).at(-1) ?? "webform"}.tmp`);
  await Bun.write(tempPath, source);
  await rename(tempPath, documentPath);
}

function scanElements(source: string): ElementSpan[] {
  const elements: ElementSpan[] = [];
  const stack: ElementSpan[] = [];
  const tagOccurrences = new Map<string, number>();
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open === -1) {
      break;
    }

    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      cursor = close === -1 ? source.length : close + 3;
      continue;
    }

    const end = findTagEnd(source, open + 1);
    if (end === -1) {
      break;
    }

    const parsed = parseTag(source, open, end);
    if (parsed === null) {
      cursor = end;
      continue;
    }

    if (parsed.closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]?.tagName === parsed.tagName) {
          const [matched] = stack.splice(index, 1);
          matched.endTagStart = open;
          matched.endTagEnd = end;
          break;
        }
      }
      cursor = end;
      continue;
    }

    const occurrence = tagOccurrences.get(parsed.tagName) ?? 0;
    tagOccurrences.set(parsed.tagName, occurrence + 1);

    const element: ElementSpan = {
      tagName: parsed.tagName,
      tagOccurrence: occurrence,
      startTagStart: open,
      startTagEnd: end,
      endTagStart: null,
      endTagEnd: null,
      attrs: parsed.attrs,
      selfClosing: parsed.selfClosing,
    };
    elements.push(element);

    if (!parsed.selfClosing && !VOID_ELEMENTS.has(parsed.tagName)) {
      stack.push(element);
    }

    cursor = end;
  }

  return elements;
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return cursor + 1;
    }
  }
  return -1;
}

function parseTag(source: string, start: number, end: number): {
  tagName: string;
  attrs: AttributeSpan[];
  closing: boolean;
  selfClosing: boolean;
} | null {
  let cursor = start + 1;
  if (source[cursor] === "!" || source[cursor] === "?") {
    return null;
  }

  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }

  while (cursor < end && /\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  const tagNameStart = cursor;
  while (cursor < end && /[^\s/>]/.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  const tagName = source.slice(tagNameStart, cursor).toLowerCase();
  if (tagName === "") {
    return null;
  }

  if (closing) {
    return { tagName, attrs: [], closing: true, selfClosing: false };
  }

  return {
    tagName,
    attrs: parseAttributes(source, cursor, end - 1),
    closing: false,
    selfClosing: /\/\s*>$/.test(source.slice(start, end)),
  };
}

function parseAttributes(source: string, start: number, endBeforeGt: number): AttributeSpan[] {
  const attrs: AttributeSpan[] = [];
  let cursor = start;

  while (cursor < endBeforeGt) {
    const leadingStart = cursor;
    while (cursor < endBeforeGt && /\s/.test(source[cursor] ?? "")) {
      cursor += 1;
    }

    if (cursor >= endBeforeGt || source[cursor] === "/") {
      break;
    }

    const nameStart = cursor;
    while (cursor < endBeforeGt && /[^\s=/>]/.test(source[cursor] ?? "")) {
      cursor += 1;
    }

    const nameEnd = cursor;
    const name = source.slice(nameStart, nameEnd);
    while (cursor < endBeforeGt && /\s/.test(source[cursor] ?? "")) {
      cursor += 1;
    }

    let valueStart: number | null = null;
    let valueEnd: number | null = null;
    let quote: '"' | "'" | null = null;
    let rawValue: string | null = null;

    if (source[cursor] === "=") {
      cursor += 1;
      while (cursor < endBeforeGt && /\s/.test(source[cursor] ?? "")) {
        cursor += 1;
      }

      if (source[cursor] === '"' || source[cursor] === "'") {
        quote = source[cursor] as '"' | "'";
        cursor += 1;
        valueStart = cursor;
        while (cursor < endBeforeGt && source[cursor] !== quote) {
          cursor += 1;
        }
        valueEnd = cursor;
        rawValue = source.slice(valueStart, valueEnd);
        if (source[cursor] === quote) {
          cursor += 1;
        }
      } else {
        valueStart = cursor;
        while (cursor < endBeforeGt && /[^\s>]/.test(source[cursor] ?? "")) {
          cursor += 1;
        }
        valueEnd = cursor;
        rawValue = source.slice(valueStart, valueEnd);
      }
    }

    if (name !== "") {
      attrs.push({
        name,
        lowerName: name.toLowerCase(),
        fullStart: leadingStart,
        fullEnd: cursor,
        nameStart,
        nameEnd,
        valueStart,
        valueEnd,
        quote,
        rawValue,
      });
    }
  }

  return attrs;
}

function createFieldTagLookup(fields: WebFormField[]): Map<string, WebFormField> {
  const lookup = new Map<string, WebFormField>();
  for (const field of fields) {
    if (field.kind !== "contenteditable") {
      lookup.set(`${field.tagName}:${field.tagOccurrence}`, field);
    }
  }
  return lookup;
}

function nextOccurrence(counters: Map<string, number>, tagName: string): number {
  const current = counters.get(tagName) ?? 0;
  counters.set(tagName, current + 1);
  return current;
}

function getAttr(element: ElementSpan, name: string): AttributeSpan | null {
  const lowerName = name.toLowerCase();
  return element.attrs.find((attr) => attr.lowerName === lowerName) ?? null;
}

function getAttrValue(element: ElementSpan, name: string): string | null {
  const attr = getAttr(element, name);
  if (!attr) {
    return null;
  }
  if (attr.rawValue === null) {
    return "";
  }
  return decodeEntities(attr.rawValue);
}

function hasAttr(element: ElementSpan, name: string): boolean {
  return getAttr(element, name) !== null;
}

function isEditableElement(element: ElementSpan): boolean {
  const value = getAttrValue(element, "contenteditable");
  return value !== null && value.toLowerCase() !== "false";
}

function isInsideElement(candidate: ElementSpan, container: ElementSpan): boolean {
  return candidate.startTagStart > container.startTagEnd
    && (container.endTagStart === null || candidate.startTagStart < container.endTagStart);
}

function resolveFormIndex(
  element: ElementSpan,
  forms: PublicFormDescriptor[],
  allElements: ElementSpan[],
  diagnostics: Diagnostic[],
): number | null {
  const formAttr = getAttrValue(element, "form");
  if (formAttr !== null && formAttr !== "") {
    const matches = forms.filter((form) => form.id === formAttr);
    if (matches.length === 1) {
      return matches[0]!.index;
    }
    diagnostics.push({
      severity: "error",
      message: `Field references form="${formAttr}", but that form id is not unique and visible.`,
    });
    return null;
  }

  let owner: ElementSpan | null = null;
  for (const formElement of allElements.filter((candidate) => candidate.tagName === "form")) {
    if (isInsideElement(element, formElement)) {
      if (owner === null || formElement.startTagStart > owner.startTagStart) {
        owner = formElement;
      }
    }
  }

  if (owner === null) {
    return null;
  }

  const ownerIndex = allElements
    .filter((candidate) => candidate.tagName === "form")
    .findIndex((candidate) => candidate === owner);
  return ownerIndex === -1 ? null : ownerIndex;
}

function allocateRuntimeId(preferred: string, used: Set<string>): string {
  let candidate = preferred;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function createFieldLabel(field: WebFormField): string {
  if (field.explicitId) {
    return `${field.tagName}#${field.explicitId}`;
  }
  if (field.explicitName) {
    return `${field.tagName}[name="${field.explicitName}"]`;
  }
  return `${field.tagName} ${field.key}`;
}

function createFieldReplacements(source: string, field: WebFormField, value: unknown): { replacements: Replacement[] } | { diagnostics: Diagnostic[] } {
  switch (field.kind) {
    case "input-value":
      if (typeof value !== "string") {
        return invalidValue(field, "a string");
      }
      return { replacements: [setAttributeReplacement(source, field.element, "value", value)] };

    case "checkbox":
    case "radio":
      if (typeof value !== "boolean") {
        return invalidValue(field, "a boolean");
      }
      return { replacements: [setBooleanAttributeReplacement(source, field.element, "checked", value)] };

    case "textarea":
      if (typeof value !== "string") {
        return invalidValue(field, "a string");
      }
      if (field.element.endTagStart === null) {
        return invalidStructure(field);
      }
      return {
        replacements: [{
          start: field.element.startTagEnd,
          end: field.element.endTagStart,
          text: escapeText(value),
        }],
      };

    case "contenteditable": {
      if (typeof value !== "string") {
        return invalidValue(field, "an HTML string");
      }
      if (field.element.endTagStart === null) {
        return invalidStructure(field);
      }
      const sanitized = sanitizeRichHTML(value);
      if (!sanitized.ok) {
        return { diagnostics: sanitized.diagnostics };
      }
      return {
        replacements: [{
          start: field.element.startTagEnd,
          end: field.element.endTagStart,
          text: sanitized.html,
        }],
      };
    }

    case "select": {
      if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item) && item >= 0)) {
        return invalidValue(field, "an array of selected option indexes");
      }
      const selected = new Set(value as number[]);
      const options = field.options ?? [];
      for (const index of selected) {
        if (index >= options.length) {
          return {
            diagnostics: [{
              severity: "error",
              message: `${createFieldLabel(field)} submitted option ${index}, but it only has ${options.length} options.`,
            }],
          };
        }
      }
      if (!field.multiple && selected.size > 1) {
        return {
          diagnostics: [{
            severity: "error",
            message: `${createFieldLabel(field)} is not multiple, but several options were submitted.`,
          }],
        };
      }
      return {
        replacements: options.map((option, index) => setBooleanAttributeReplacement(source, option, "selected", selected.has(index))),
      };
    }
  }
}

function invalidValue(field: WebFormField, expected: string): { diagnostics: Diagnostic[] } {
  return {
    diagnostics: [{
      severity: "error",
      message: `${createFieldLabel(field)} expected ${expected}.`,
    }],
  };
}

function invalidStructure(field: WebFormField): { diagnostics: Diagnostic[] } {
  return {
    diagnostics: [{
      severity: "error",
      message: `${createFieldLabel(field)} cannot be patched because its source structure is incomplete.`,
    }],
  };
}

function setAttributeReplacement(source: string, element: ElementSpan, name: string, value: string): Replacement {
  const attr = getAttr(element, name);
  const serializedValue = serializeAttributeValue(value, attr?.quote ?? null);

  if (attr !== null && attr.valueStart !== null && attr.valueEnd !== null) {
    if (attr.quote === null && !isSafeUnquotedAttributeValue(serializedValue)) {
      return {
        start: attr.fullStart,
        end: attr.fullEnd,
        text: ` ${attr.name}="${escapeAttribute(value, '"')}"`,
      };
    }
    return {
      start: attr.valueStart,
      end: attr.valueEnd,
      text: serializedValue,
    };
  }

  if (attr !== null) {
    return {
      start: attr.fullStart,
      end: attr.fullEnd,
      text: ` ${attr.name}=${serializedValue}`,
    };
  }

  return {
    start: insertionPointForAttribute(source, element),
    end: insertionPointForAttribute(source, element),
    text: ` ${name}=${serializedValue}`,
  };
}

function setBooleanAttributeReplacement(source: string, element: ElementSpan, name: string, enabled: boolean): Replacement {
  const attr = getAttr(element, name);
  if (enabled) {
    if (attr !== null) {
      return { start: attr.fullStart, end: attr.fullStart, text: "" };
    }
    const insertionPoint = insertionPointForAttribute(source, element);
    return { start: insertionPoint, end: insertionPoint, text: ` ${name}` };
  }

  if (attr === null) {
    return { start: element.startTagEnd - 1, end: element.startTagEnd - 1, text: "" };
  }

  return {
    start: attr.fullStart,
    end: attr.fullEnd,
    text: "",
  };
}

function insertionPointForAttribute(source: string, element: ElementSpan): number {
  const tagText = source.slice(element.startTagStart, element.startTagEnd);
  const selfCloseMatch = tagText.match(/\/\s*>$/);
  if (selfCloseMatch?.index !== undefined) {
    return element.startTagStart + selfCloseMatch.index;
  }
  return element.startTagEnd - 1;
}

function serializeAttributeValue(value: string, existingQuote: '"' | "'" | null): string {
  if (existingQuote !== null) {
    return escapeAttribute(value, existingQuote);
  }
  if (isSafeUnquotedAttributeValue(value)) {
    return escapeAttribute(value, null);
  }
  return `"${escapeAttribute(value, '"')}"`;
}

function isSafeUnquotedAttributeValue(value: string): boolean {
  return value !== "" && /^[^\s"'=<>`]+$/.test(value);
}

function escapeAttribute(value: string, quote: '"' | "'" | null): string {
  let escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote === '"') {
    escaped = escaped.replaceAll('"', "&quot;");
  } else if (quote === "'") {
    escaped = escaped.replaceAll("'", "&#39;");
  }
  return escaped;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function sanitizeRichHTML(html: string): { ok: true; html: string } | { ok: false; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const elements = scanElements(html);

  for (const element of elements) {
    if (!ALLOWED_RICH_TAGS.has(element.tagName)) {
      diagnostics.push({
        severity: "error",
        message: `contenteditable save contains unsupported <${element.tagName}> markup.`,
      });
    }

    for (const attr of element.attrs) {
      if (attr.lowerName.startsWith("on") || attr.lowerName === "style" || !SAFE_ATTRS.has(attr.lowerName)) {
        diagnostics.push({
          severity: "error",
          message: `contenteditable <${element.tagName}> contains unsupported ${attr.name} attribute.`,
        });
        continue;
      }

      if (URI_ATTRS.has(attr.lowerName)) {
        const value = attr.rawValue === null ? "" : decodeEntities(attr.rawValue).trim();
        if (/^\s*javascript:/i.test(value)) {
          diagnostics.push({
            severity: "error",
            message: `contenteditable <${element.tagName}> contains an unsafe ${attr.name} URL.`,
          });
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, html };
}

function applyReplacements(source: string, replacements: Replacement[]): string {
  const meaningful = replacements.filter((replacement) => replacement.start !== replacement.end || replacement.text !== "");
  meaningful.sort((a, b) => b.start - a.start);

  let next = source;
  let previousStart = source.length + 1;
  for (const replacement of meaningful) {
    if (replacement.end > previousStart) {
      throw new Error("Overlapping WebFormer source replacements.");
    }
    next = next.slice(0, replacement.start) + replacement.text + next.slice(replacement.end);
    previousStart = replacement.start;
  }
  return next;
}

function verifySavedValues(source: string, originalFields: WebFormField[], submitted: Map<string, unknown>): Diagnostic[] {
  const nextAnalysis = analyzeWebForm(source);
  const diagnostics: Diagnostic[] = [];

  for (const originalField of originalFields) {
    const nextField = nextAnalysis.fields.find((field) => field.key === originalField.key);
    if (!nextField) {
      diagnostics.push({ severity: "error", message: `${createFieldLabel(originalField)} disappeared after save.` });
      continue;
    }

    const expected = submitted.get(originalField.key);
    const actual = readFieldValue(source, nextField);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      diagnostics.push({
        severity: "error",
        message: `${createFieldLabel(originalField)} did not round-trip after save.`,
      });
    }
  }

  return diagnostics;
}

function readFieldValue(source: string, field: WebFormField): unknown {
  switch (field.kind) {
    case "input-value":
      return getAttrValue(field.element, "value") ?? "";
    case "checkbox":
    case "radio":
      return hasAttr(field.element, "checked");
    case "textarea":
      return field.element.endTagStart === null ? "" : decodeEntities(source.slice(field.element.startTagEnd, field.element.endTagStart));
    case "contenteditable":
      return field.element.endTagStart === null ? "" : source.slice(field.element.startTagEnd, field.element.endTagStart);
    case "select":
      return (field.options ?? []).flatMap((option, index) => hasAttr(option, "selected") ? [index] : []);
  }
}
