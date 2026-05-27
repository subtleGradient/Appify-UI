(function () {
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
    if (!("serviceWorker" in navigator)) {
      return Promise.resolve(null);
    }

    const script = document.currentScript;
    const scriptURL = script && script.src
      ? new URL("service-worker.js", script.src)
      : new URL("./service-worker.js", location.href);
    const scopeURL = new URL("./", scriptURL);

    return navigator.serviceWorker.register(scriptURL, { scope: scopeURL.pathname })
      .then(() => navigator.serviceWorker.ready)
      .catch((error) => {
        console.warn("Rails weblog service worker registration failed; using query-string form fallback.", error);
        return null;
      });
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
    return pathname.endsWith("/posts/create.cgi")
      || pathname.endsWith("/posts/1/comments/create.cgi");
  }

  function redirectFormToShadow(form) {
    const target = shadowURLFor(new URL(form.getAttribute("action") || location.href, location.href), new FormData(form));
    location.assign(target.href);
  }

  function shadowURLFor(url, formData) {
    const target = new URL(url.href);
    target.pathname = target.pathname + ".html";
    target.search = new URLSearchParams(formData).toString();
    target.hash = "";
    return target;
  }

  function requestFromLocation() {
    const params = new URLSearchParams(location.search);
    const fields = Array.from(params.entries());
    return {
      method: fields.length > 0 ? "POST" : "GET",
      action: location.pathname.replace(/\.html$/, ""),
      path: location.pathname.replace(/\.html$/, ""),
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

    const summary = {
      kind,
      action: postedRequest.action || "",
      path: postedRequest.path || "",
      createdAt: new Date().toISOString(),
      fields,
    };
    saveSubmission(summary);

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

  function renderRecentSubmissions(list) {
    const submissions = readSubmissions().slice(-5).reverse();
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

  function saveSubmission(submission) {
    try {
      const submissions = readSubmissions();
      submissions.push(submission);
      localStorage.setItem("2005-rails-weblog.web:submissions", JSON.stringify(submissions.slice(-20)));
    } catch (error) {
      console.warn("Could not save local Rails weblog submission.", error);
    }
  }

  function readSubmissions() {
    try {
      const raw = localStorage.getItem("2005-rails-weblog.web:submissions");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
})();
