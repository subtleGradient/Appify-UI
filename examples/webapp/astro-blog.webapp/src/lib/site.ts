export const site = {
  title: "Astro Blog Webapp",
  description: "A static Astro blog packaged as a .webapp source folder and exported as a .web artifact.",
};

const baseURL = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export function href(path = ""): string {
  return `${baseURL}${path.replace(/^\/+/, "")}`;
}
