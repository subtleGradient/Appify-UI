(function () {
  const request = window.AppifyHost && window.AppifyHost.request
    ? window.AppifyHost.request
    : window.__WEB_APP_REQUEST__;

  const requestPanel = document.querySelector("[data-request-panel]");
  if (requestPanel) {
    renderPostedRequest(requestPanel, request);
  }

  const recentList = document.querySelector("[data-recent-submissions]");
  if (recentList) {
    renderRecentSubmissions(recentList);
  }

  function renderPostedRequest(panel, postedRequest) {
    const kind = panel.getAttribute("data-request-panel") || "submission";
    const title = document.querySelector("[data-submission-title]");
    const flash = document.querySelector("[data-flash]");

    if (!postedRequest) {
      setFlash(flash, "error", "No posted request data was found.");
      panel.replaceChildren(textBlock("This page is a safe POST shadow file. Open it by submitting the matching form."));
      return;
    }

    const fields = postedRequest.fields || [];
    if (fields.length === 0 && !postedRequest.text) {
      setFlash(flash, "error", "The POST request arrived, but it did not include form fields.");
      panel.replaceChildren(textBlock("No fields were submitted."));
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
