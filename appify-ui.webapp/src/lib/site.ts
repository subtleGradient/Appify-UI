export const site = {
  title: "Appify UI",
  description: "Small Mac-shaped hosts for local tools, static web packages, and document-shaped web projects.",
  githubURL: "https://github.com/subtleGradient/appify-ui",
  pagesURL: "https://subtlegradient.github.io/appify-ui/",
};

const baseURL = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export function href(path = ""): string {
  return `${baseURL}${path.replace(/^\/+/, "")}`;
}
