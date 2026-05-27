export function defineWebControls() {
  if (!customElements.get("web-button")) customElements.define("web-button", WebButton)
  if (!customElements.get("web-switch")) customElements.define("web-switch", WebSwitch)
}

export class WebButton extends HTMLElement {
  static observedAttributes = ["disabled"]

  connectedCallback() {
    this.render()
    this.sync()
  }

  attributeChangedCallback() {
    this.sync()
  }

  get disabled() {
    return this.hasAttribute("disabled")
  }

  render() {
    if (this.shadowRoot) return
    const root = this.attachShadow({ mode: "open" })
    root.innerHTML = `
      <style>
        :host { display: inline-flex; }
        button {
          appearance: none;
          background: var(--web-control-accent, CanvasText);
          border: 1px solid var(--web-control-accent, CanvasText);
          border-radius: var(--web-control-radius, 0.45rem);
          box-shadow: 0 1px 2px color-mix(in oklch, CanvasText 16%, transparent);
          color: var(--web-control-accent-text, Canvas);
          cursor: pointer;
          font: inherit;
          font-weight: 650;
          min-block-size: 2.35rem;
          padding: 0.5rem 0.9rem;
        }
        button:hover:not(:disabled) { filter: brightness(0.96); }
        button:focus-visible { outline: 2px solid var(--web-focus, Highlight); outline-offset: 2px; }
        button:active { transform: translateY(1px); }
        button:disabled { cursor: not-allowed; opacity: 0.5; }
      </style>
      <button part="button" type="button"><slot></slot></button>
    `
    root.querySelector("button").addEventListener("click", (event) => {
      if (this.disabled) return
      const pressed = this.dispatchEvent(new CustomEvent("web:press", {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: { source: "web-button" },
      }))
      if (!pressed) event.preventDefault()
    })
  }

  sync() {
    const button = this.shadowRoot?.querySelector("button")
    if (button) button.disabled = this.disabled
  }
}

export class WebSwitch extends HTMLElement {
  static observedAttributes = ["checked", "disabled"]

  connectedCallback() {
    this.render()
    this.sync()
  }

  attributeChangedCallback() {
    this.sync()
  }

  get checked() {
    return this.hasAttribute("checked")
  }

  set checked(value) {
    this.toggleAttribute("checked", Boolean(value))
  }

  get disabled() {
    return this.hasAttribute("disabled")
  }

  render() {
    if (this.shadowRoot) return
    const root = this.attachShadow({ mode: "open" })
    root.innerHTML = `
      <style>
        :host { display: inline-flex; }
        button {
          align-items: center;
          appearance: none;
          background: var(--web-switch-track, color-mix(in oklch, CanvasText 16%, Canvas));
          border: 1px solid transparent;
          border-radius: 999px;
          cursor: pointer;
          display: inline-flex;
          inline-size: 2.75rem;
          min-block-size: 1.5rem;
          padding: 0.12rem;
          transition: background 140ms ease;
        }
        span {
          background: var(--web-switch-thumb, Canvas);
          border-radius: 999px;
          block-size: 1.14rem;
          box-shadow: 0 1px 3px color-mix(in oklch, CanvasText 22%, transparent);
          inline-size: 1.14rem;
          transition: transform 140ms ease;
        }
        button[aria-checked="true"] { background: var(--web-control-accent, CanvasText); }
        button[aria-checked="true"] span { transform: translateX(1.22rem); }
        button:focus-visible { outline: 2px solid var(--web-focus, Highlight); outline-offset: 2px; }
        button:disabled { cursor: not-allowed; opacity: 0.5; }
      </style>
      <button part="switch" type="button" role="switch" aria-checked="false"><span part="thumb"></span></button>
    `
    root.querySelector("button").addEventListener("click", () => {
      if (this.disabled) return
      const next = !this.checked
      const changed = this.dispatchEvent(new CustomEvent("web:checked-change", {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: { checked: next, source: "web-switch" },
      }))
      if (changed) this.checked = next
    })
  }

  sync() {
    const button = this.shadowRoot?.querySelector("button")
    if (!button) return
    button.disabled = this.disabled
    button.setAttribute("aria-checked", this.checked ? "true" : "false")
  }
}

