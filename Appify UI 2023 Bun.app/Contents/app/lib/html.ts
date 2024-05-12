export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings
    .map((string, index) => {
      let value = values[index]
      if (value === undefined) return string
      if (typeof value === "function") value = value()
      return string + htmlEscape(value)
    })
    .join("")
}

function htmlEscape(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/[&<>"']/g, char => {
      switch (char) {
        case "&":
          return "&amp;"
        case "<":
          return "&lt;"
        case ">":
          return "&gt;"
        case '"':
          return "&quot;"
        case "'":
          return "&#039;"
        default:
          return char
      }
    })
  }
  return String(value)
}

function raw(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings
    .map((string, index) => {
      let value = values[index]
      if (value === undefined) return string
      if (typeof value === "function") value = value()
      return string + value
    })
    .join("")
}

export const css = raw

export function js(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings
    .map((string, index) => {
      let value = values[index]
      if (value === undefined) return string
      if (typeof value === "function") value = value()
      if (typeof value !== "string") value = JSON.stringify(value)
      return string + value
    })
    .join("")
}
