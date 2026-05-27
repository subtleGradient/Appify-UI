import "@web/ui-controls/define.js"

const provider = document.documentElement.dataset.provider || "unknown-provider"
const activity = document.querySelector("#activity")
const requirement = document.querySelector("#requirement")
let pressCount = 0

try {
  const response = await fetch("./web-requires.json")
  const requires = await response.json()
  const logicalImports = Object.keys(requires.imports ?? {}).join(", ")
  requirement.textContent = `Requires ${logicalImports}; resolved here by ${provider}.`
} catch (error) {
  requirement.textContent = "Could not load web-requires.json."
  console.error("Web composition fixture could not load requirements.", error)
}

document.addEventListener("web:press", (event) => {
  if (event.target?.id !== "primary-action") return
  pressCount += 1
  activity.textContent = `${provider}: button press ${pressCount}`
})

document.addEventListener("web:checked-change", (event) => {
  if (event.target?.id !== "density-switch") return
  const checked = Boolean(event.detail?.checked)
  document.documentElement.dataset.compact = checked ? "true" : "false"
  activity.textContent = `${provider}: compact density ${checked ? "on" : "off"}`
})

globalThis.__webCompositionFixtureReady = true

