self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/cgi-bin/sign.cgi")) {
    return;
  }

  event.respondWith(redirectPostToShadowPage(event.request));
});

async function redirectPostToShadowPage(request) {
  const url = new URL(request.url);
  const form = await request.clone().formData();
  url.pathname = url.pathname + ".html";
  url.search = new URLSearchParams(form).toString();
  url.hash = "";
  return Response.redirect(url, 303);
}
