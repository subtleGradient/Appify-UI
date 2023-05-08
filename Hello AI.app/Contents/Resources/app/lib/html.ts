// const WebviewServer = await import("./lib/http-webview");
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
    return strings
        .map((string, index) => {
            let value = values[index];
            if (value === undefined)
                return string;
            if (typeof value === "function")
                value = value();
            return string + value;
        })
        .join("");
}

export const css = html
