self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !isCompatPostPath(url.pathname)) {
    return;
  }

  event.respondWith(redirectPostToShadowPage(event.request));
});

function isCompatPostPath(pathname) {
  return pathname.endsWith("/posts/create.cgi")
    || pathname.endsWith("/posts/1/comments/create.cgi");
}

async function redirectPostToShadowPage(request) {
  const url = new URL(request.url);
  const form = await request.clone().formData();
  url.pathname = url.pathname + ".html";
  url.search = new URLSearchParams(form).toString();
  url.hash = "";
  return Response.redirect(url, 303);
}
