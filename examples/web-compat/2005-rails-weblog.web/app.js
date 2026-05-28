(function () {
  const scriptURL = document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src)
    : new URL("./app.js", location.href);
  const bundleRootURL = new URL("./", scriptURL);

  const serviceWorkerReady = registerServiceWorker();
  installPostFormCompatibility(serviceWorkerReady);

  const requestPanel = document.querySelector("[data-request-panel]");
  if (requestPanel) {
    renderPostedRequest(requestPanel, requestFromLocation());
  }

  const recentList = document.querySelector("[data-recent-submissions]");
  if (recentList) {
    renderRecentSubmissions(recentList);
  }

  function registerServiceWorker() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return Promise.resolve(null);
    }

    const script = document.currentScript;
    const scriptURL = script && script.src
      ? new URL("service-worker.js", script.src)
      : new URL("./service-worker.js", location.href);
    const scopeURL = new URL("./", scriptURL);

    return navigator.serviceWorker.register(scriptURL, { scope: scopeURL.pathname })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        ensureServiceWorkerControl(registration);
        return registration;
      })
      .catch((error) => {
        console.warn("Rails weblog service worker registration failed; using query-string form fallback.", error);
        return null;
      });
  }

  function ensureServiceWorkerControl(registration) {
    if (navigator.serviceWorker.controller || !registration || !registration.active) {
      return;
    }
    try {
      const reloadKey = "2005-rails-weblog.web:service-worker-reloaded";
      if (sessionStorage.getItem(reloadKey) === "1") {
        return;
      }
      sessionStorage.setItem(reloadKey, "1");
      location.reload();
    } catch {
      // The submit handler still waits for controllerchange before falling back.
    }
  }

  function installPostFormCompatibility(serviceWorkerReady) {
    installNavigationFormDataEnhancement();

    const forms = Array.from(document.querySelectorAll("form"));
    forms.forEach((form) => {
      if (!isCompatPostForm(form)) return;
      form.addEventListener("submit", (event) => {
        if (!("serviceWorker" in navigator)) {
          event.preventDefault();
          redirectFormToShadow(form);
          return;
        }
        if (navigator.serviceWorker.controller) {
          return;
        }

        event.preventDefault();
        waitForServiceWorkerController(serviceWorkerReady).then((controlled) => {
          if (controlled) {
            HTMLFormElement.prototype.submit.call(form);
            return;
          }
          redirectFormToShadow(form);
        });
      });
    });
  }

  function installNavigationFormDataEnhancement() {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) return;
    const appNavigation = window.navigation;
    if (!appNavigation || typeof appNavigation.addEventListener !== "function") return;

    appNavigation.addEventListener("navigate", (event) => {
      if (!event || !event.formData || !event.destination || !event.destination.url) return;
      const destination = new URL(event.destination.url);
      if (!isCompatPostPath(destination.pathname) || typeof event.intercept !== "function") return;

      event.intercept({
        handler() {
          const target = shadowURLFor(destination, event.formData);
          location.assign(target.href);
        },
      });
    });
  }

  function waitForServiceWorkerController(serviceWorkerReady) {
    if (navigator.serviceWorker.controller) {
      return Promise.resolve(true);
    }

    const controllerChanged = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
    });
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 800);
    });

    return Promise.race([
      Promise.resolve(serviceWorkerReady).then(() => (
        navigator.serviceWorker.controller ? true : controllerChanged
      )),
      timeout,
    ]).then(Boolean, () => false);
  }

  function isCompatPostForm(form) {
    const method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "post") return false;
    return isCompatPostPath(new URL(form.getAttribute("action") || location.href, location.href).pathname);
  }

  function isCompatPostPath(pathname) {
    return shadowPathForCompatPost(pathname) !== null;
  }

  function redirectFormToShadow(form) {
    const target = shadowURLFor(new URL(form.getAttribute("action") || location.href, location.href), new FormData(form));
    location.assign(target.href);
  }

  function shadowURLFor(url, formData) {
    const target = new URL(url.href);
    const shadowPath = shadowPathForCompatPost(target.pathname);
    const params = new URLSearchParams(formData);
    params.set("_web_app_action", normalizedResourcePath(target.pathname));
    target.pathname = shadowPath || target.pathname + ".html";
    target.search = params.toString();
    target.hash = "";
    return target;
  }

  function requestFromLocation() {
    const params = new URLSearchParams(location.search);
    const postedAction = params.get("_web_app_action") || location.pathname.replace(/\.html$/, "");
    params.delete("_web_app_action");
    params.delete("_web_app_persisted");
    const fields = Array.from(params.entries());
    return {
      method: fields.length > 0 ? "POST" : "GET",
      action: postedAction,
      path: postedAction,
      fields,
    };
  }

  function renderPostedRequest(panel, postedRequest) {
    const kind = panel.getAttribute("data-request-panel") || "submission";
    const title = document.querySelector("[data-submission-title]");
    const flash = document.querySelector("[data-flash]");

    const fields = postedRequest.fields || [];
    if (fields.length === 0) {
      setFlash(flash, "error", "No posted form data was found.");
      panel.replaceChildren(textBlock("This is a static shadow page. Submit the matching form so the service worker can redirect here with URLSearchParams."));
      return;
    }

    if (kind === "post") {
      const postTitle = fieldValue(fields, "post[title]") || "Untitled post";
      const author = fieldValue(fields, "post[author]") || "anonymous";
      if (title) title.textContent = postTitle;
      setFlash(flash, "notice", "Post was successfully created.");
      panel.replaceChildren(
        detailRow("Title", postTitle),
        detailRow("Author", author),
        detailRow("Category", fieldValue(fields, "post[category]") || "uncategorized"),
        detailRow("Body", fieldValue(fields, "post[body]") || ""),
        detailRow("Action", postedRequest.action || ""),
      );
      return;
    }

    if (kind === "comment") {
      const author = fieldValue(fields, "comment[author]") || "anonymous";
      if (title) title.textContent = "Comment by " + author;
      setFlash(flash, "notice", "Comment was successfully created.");
      panel.replaceChildren(
        detailRow("Author", author),
        detailRow("Body", fieldValue(fields, "comment[body]") || ""),
        detailRow("Notify", fieldValue(fields, "comment[notify]") || "0"),
        detailRow("Action", postedRequest.action || ""),
      );
      return;
    }

    setFlash(flash, "notice", "Submission was received.");
    panel.replaceChildren(...fields.map(([name, value]) => detailRow(name, value)));
  }

  async function renderRecentSubmissions(list) {
    const submissions = (await readSubmissions()).slice(-5).reverse();
    if (submissions.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No local submissions yet.";
      list.replaceChildren(item);
      return;
    }

    list.replaceChildren(...submissions.map((submission) => {
      const item = document.createElement("li");
      const label = submission.kind === "comment"
        ? fieldValue(submission.fields, "comment[author]") || "anonymous comment"
        : fieldValue(submission.fields, "post[title]") || "untitled post";
      item.append(label + " ");
      const small = document.createElement("small");
      small.textContent = submission.path;
      item.append(small);
      return item;
    }));
  }

  function fieldValue(fields, name) {
    for (const entry of fields) {
      if (Array.isArray(entry) && entry[0] === name) {
        return entry[1];
      }
    }
    return "";
  }

  function setFlash(element, kind, message) {
    if (!element) return;
    element.className = "flash " + kind;
    element.textContent = message;
  }

  function textBlock(message) {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    return paragraph;
  }

  function detailRow(label, value) {
    const row = document.createElement("div");
    row.className = "detail-row";

    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;

    row.append(term, definition);
    return row;
  }

  async function readSubmissions() {
    try {
      const store = await readStore();
      const postSubmissions = Array.isArray(store.posts) ? store.posts.map((post) => ({
        kind: "post",
        path: "/posts/" + post.id,
        createdAt: post.createdAt || "",
        fields: [
          ["post[title]", post.title || "untitled post"],
          ["post[author]", post.author || "anonymous"],
        ],
      })) : [];
      const commentSubmissions = Array.isArray(store.comments) ? store.comments.map((comment) => ({
        kind: "comment",
        path: "/posts/" + comment.postId + "/comments/" + comment.id,
        createdAt: comment.createdAt || "",
        fields: [
          ["comment[author]", comment.author || "anonymous"],
          ["comment[body]", comment.body || ""],
        ],
      })) : [];
      return [...postSubmissions, ...commentSubmissions].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    } catch {
      return [];
    }
  }

  async function readStore() {
    const restResponse = await fetch(new URL("posts", bundleRootURL), {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (restResponse.ok && (restResponse.headers.get("Content-Type") || "").includes("application/json")) {
      const payload = await restResponse.json();
      if (Array.isArray(payload.posts)) {
        return { posts: payload.posts, comments: Array.isArray(payload.comments) ? payload.comments : [] };
      }
    }

    const fileResponse = await fetch(new URL("weblog-store.json", bundleRootURL), {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    return fileResponse.ok ? await fileResponse.json() : { posts: [], comments: [] };
  }

  function shadowPathForCompatPost(pathname) {
    const path = normalizedResourcePath(pathname);
    if (path.endsWith("/posts/create.cgi")) {
      return path + ".html";
    }
    const legacyComment = path.match(/^(.*\/posts\/[^/]+\/comments)\/create\.cgi$/);
    if (legacyComment) {
      return legacyComment[1] + "/create.cgi.html";
    }
    if (path.endsWith("/posts")) {
      return path + "/create.cgi.html";
    }
    const comments = path.match(/^(.*\/posts\/[^/]+\/comments)$/);
    if (comments) {
      return comments[1] + "/create.cgi.html";
    }
    return null;
  }

  function normalizedResourcePath(pathname) {
    const path = pathname.replace(/\/+$/, "");
    return path || "/";
  }
})();
