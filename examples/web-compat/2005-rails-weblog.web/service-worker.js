self.oninstall = event => {
  event.waitUntil(self.skipWaiting());
};

self.onactivate = event => {
  event.waitUntil(self.clients.claim());
};

self.onfetch = event => {
  const route = routeForRequest(event.request);
  if (route === null) {
    return;
  }
  if (event.request.method === "GET" && !wantsJSON(event.request)) {
    return;
  }

  event.respondWith(handleRESTRequest(event.request, route));
};

const STORE_SCHEMA = "appify.rails-weblog.v1";
const STORE_FILE_NAME = "weblog-store.json";
const WEB_APP_STORAGE_ROUTE = "/_web/persistence/service-worker-local-storage";

function seedStore() {
  return {
    schema: STORE_SCHEMA,
    nextPostId: 3,
    nextCommentId: 3,
    posts: [
      {
        id: 1,
        title: "Hello from script/server",
        author: "david",
        category: "dispatches",
        body: "A tiny original weblog post wearing the clothes of a 2005 scaffold demo.",
        published: true,
        createdAt: "2005-07-24T12:00:00.000Z",
        updatedAt: "2005-07-24T12:00:00.000Z",
      },
      {
        id: 2,
        title: "Prototype made me do it",
        author: "sam",
        category: "ajax",
        body: "A second static seed post for collection views and REST fetch probes.",
        published: true,
        createdAt: "2005-09-08T12:00:00.000Z",
        updatedAt: "2005-09-08T12:00:00.000Z",
      },
    ],
    comments: [
      {
        id: 1,
        postId: 1,
        author: "matz-ish",
        body: "Convention is a kindness.",
        notify: false,
        createdAt: "2005-07-24T13:00:00.000Z",
        updatedAt: "2005-07-24T13:00:00.000Z",
      },
      {
        id: 2,
        postId: 1,
        author: "prototype fan",
        body: "The yellow fade is implied.",
        notify: false,
        createdAt: "2005-07-24T13:05:00.000Z",
        updatedAt: "2005-07-24T13:05:00.000Z",
      },
    ],
  };
}

async function handleRESTRequest(request, route) {
  try {
    const method = await effectiveMethod(request);
    const store = normalizeStore(await readStore());

    if (route.kind === "posts") {
      if (method === "GET") {
        return jsonResponse({ posts: postsWithCommentCounts(store), comments: store.comments });
      }
      if (method === "POST") {
        const payload = await requestPayload(request);
        const post = createPost(store, payload);
        await writeStore(store);
        return wantsHTML(request)
          ? redirectToShadow(request, "/posts", "posts/create.cgi.html", payload, { persisted: true })
          : jsonResponse({ post }, 201);
      }
    }

    if (route.kind === "post") {
      const post = store.posts.find(candidate => candidate.id === route.postId);
      if (!post) return jsonResponse({ error: "Post not found" }, 404);
      if (method === "GET") {
        return jsonResponse({ post, comments: commentsForPost(store, route.postId) });
      }
      if (method === "PUT" || method === "PATCH") {
        Object.assign(post, postAttributes(await requestPayload(request)), { updatedAt: new Date().toISOString() });
        await writeStore(store);
        return jsonResponse({ post });
      }
      if (method === "DELETE") {
        store.posts = store.posts.filter(candidate => candidate.id !== route.postId);
        store.comments = store.comments.filter(comment => comment.postId !== route.postId);
        await writeStore(store);
        return jsonResponse({ ok: true });
      }
    }

    if (route.kind === "comments") {
      const post = store.posts.find(candidate => candidate.id === route.postId);
      if (!post) return jsonResponse({ error: "Post not found" }, 404);
      if (method === "GET") {
        return jsonResponse({ comments: commentsForPost(store, route.postId) });
      }
      if (method === "POST") {
        const payload = await requestPayload(request);
        const comment = createComment(store, route.postId, payload);
        await writeStore(store);
        return wantsHTML(request)
          ? redirectToShadow(request, `/posts/${route.postId}/comments`, `posts/${route.postId}/comments/create.cgi.html`, payload, { persisted: true })
          : jsonResponse({ comment }, 201);
      }
    }

    if (route.kind === "comment") {
      const comment = store.comments.find(candidate => candidate.id === route.commentId && candidate.postId === route.postId);
      if (!comment) return jsonResponse({ error: "Comment not found" }, 404);
      if (method === "GET") {
        return jsonResponse({ comment });
      }
      if (method === "PUT" || method === "PATCH") {
        Object.assign(comment, commentAttributes(await requestPayload(request), route.postId), { updatedAt: new Date().toISOString() });
        await writeStore(store);
        return jsonResponse({ comment });
      }
      if (method === "DELETE") {
        store.comments = store.comments.filter(candidate => candidate.id !== route.commentId);
        await writeStore(store);
        return jsonResponse({ ok: true });
      }
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

function routeForRequest(request) {
  const url = new URL(request.url);
  const resourcePath = resourcePathFor(url.pathname);
  if (resourcePath === null) {
    return null;
  }

  if (resourcePath === "/posts" || resourcePath === "/posts/create.cgi") {
    return { kind: "posts" };
  }

  const postMatch = /^\/posts\/([0-9]+)$/.exec(resourcePath);
  if (postMatch) {
    return { kind: "post", postId: Number(postMatch[1]) };
  }

  const commentsMatch = /^\/posts\/([0-9]+)\/comments(?:\/create\.cgi)?$/.exec(resourcePath);
  if (commentsMatch) {
    return { kind: "comments", postId: Number(commentsMatch[1]) };
  }

  const commentMatch = /^\/posts\/([0-9]+)\/comments\/([0-9]+)$/.exec(resourcePath);
  if (commentMatch) {
    return { kind: "comment", postId: Number(commentMatch[1]), commentId: Number(commentMatch[2]) };
  }

  return null;
}

function resourcePathFor(pathname) {
  const scopePath = normalizedResourcePath(new URL(self.registration.scope).pathname);
  const path = normalizedResourcePath(pathname);
  if (scopePath === "/") {
    return path;
  }
  if (path === scopePath) {
    return "/";
  }
  if (!path.startsWith(`${scopePath}/`)) {
    return null;
  }
  return normalizedResourcePath(path.slice(scopePath.length));
}

function normalizedResourcePath(pathname) {
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

async function effectiveMethod(request) {
  const method = request.method.toUpperCase();
  if (method !== "POST") {
    return method;
  }
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return method;
  }
  const form = await request.clone().formData();
  return String(form.get("_method") || method).toUpperCase();
}

async function requestPayload(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return await request.clone().json();
  }
  const form = await request.clone().formData();
  const payload = {};
  for (const [key, value] of form) {
    if (typeof value === "string") {
      payload[key] = value;
    }
  }
  return payload;
}

function createPost(store, payload) {
  const post = {
    id: store.nextPostId++,
    ...postAttributes(payload),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.posts.push(post);
  return post;
}

function postAttributes(payload) {
  return {
    title: textField(payload, "post[title]", "Untitled post"),
    author: textField(payload, "post[author]", "anonymous"),
    category: textField(payload, "post[category]", "uncategorized"),
    body: textField(payload, "post[body]", ""),
    published: booleanField(payload, "post[published]"),
  };
}

function createComment(store, postId, payload) {
  const comment = {
    id: store.nextCommentId++,
    ...commentAttributes(payload, postId),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.comments.push(comment);
  return comment;
}

function commentAttributes(payload, postId) {
  return {
    postId: Number(payload["comment[post_id]"] || postId),
    author: textField(payload, "comment[author]", "anonymous"),
    body: textField(payload, "comment[body]", ""),
    notify: booleanField(payload, "comment[notify]"),
  };
}

function textField(payload, name, fallback) {
  const value = payload[name];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function booleanField(payload, name) {
  return payload[name] === "1" || payload[name] === "true" || payload[name] === true;
}

function postsWithCommentCounts(store) {
  return store.posts.map(post => ({
    ...post,
    commentCount: commentsForPost(store, post.id).length,
  }));
}

function commentsForPost(store, postId) {
  return store.comments.filter(comment => comment.postId === postId);
}

function wantsJSON(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json");
}

function wantsHTML(request) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("text/html") || request.mode === "navigate";
}

function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function redirectToShadow(request, resourcePath, shadowPath, payload, options = {}) {
  const url = new URL(shadowPath, self.registration.scope);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    params.set(key, String(value));
  }
  params.set("_web_app_action", resourcePath);
  if (options.persisted) {
    params.set("_web_app_persisted", "1");
  }
  url.search = params.toString();
  url.hash = "";
  return Response.redirect(url, 303);
}

async function readStore() {
  return await readWebAppStore()
    || await readIDBStore()
    || await readSeedStore()
    || seedStore();
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (await writeWebAppStore(normalized)) {
    return;
  }
  await writeIDBStore(normalized);
}

async function readWebAppStore() {
  try {
    const endpoint = storageEndpoint();
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const snapshot = await response.json();
    const entry = Array.isArray(snapshot.entries)
      ? snapshot.entries.find(candidate => Array.isArray(candidate) && candidate[0] === storeFileKey())
      : null;
    return entry ? JSON.parse(entry[1]) : null;
  } catch {
    return null;
  }
}

async function writeWebAppStore(store) {
  try {
    const response = await fetch(storageEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: 1,
        entries: [[storeFileKey(), JSON.stringify(store, null, 2) + "\n"]],
        touchedKeys: [storeFileKey()],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function storageEndpoint() {
  const endpoint = new URL(WEB_APP_STORAGE_ROUTE, self.location.origin);
  endpoint.searchParams.set("page", new URL("service-worker.js", self.registration.scope).pathname);
  return endpoint;
}

function storeFileKey() {
  return new URL(STORE_FILE_NAME, self.registration.scope).pathname;
}

async function readSeedStore() {
  try {
    const response = await fetch(new URL(STORE_FILE_NAME, self.registration.scope), {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function readIDBStore() {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction("documents").objectStore("documents").get(STORE_FILE_NAME);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeIDBStore(store) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite");
    transaction.objectStore("documents").put(store, STORE_FILE_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      reject(new Error("IndexedDB is not available in this service worker."));
      return;
    }
    const request = indexedDB.open("rails-weblog", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("documents");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeStore(value) {
  const store = value && typeof value === "object" ? value : seedStore();
  const posts = Array.isArray(store.posts) ? store.posts.map(normalizePost) : seedStore().posts;
  const comments = Array.isArray(store.comments) ? store.comments.map(normalizeComment).filter(comment => posts.some(post => post.id === comment.postId)) : seedStore().comments;
  return {
    schema: STORE_SCHEMA,
    nextPostId: Math.max(Number(store.nextPostId) || 1, ...posts.map(post => post.id + 1), 1),
    nextCommentId: Math.max(Number(store.nextCommentId) || 1, ...comments.map(comment => comment.id + 1), 1),
    posts,
    comments,
  };
}

function normalizePost(value) {
  return {
    id: Number(value.id) || 0,
    title: String(value.title || "Untitled post"),
    author: String(value.author || "anonymous"),
    category: String(value.category || "uncategorized"),
    body: String(value.body || ""),
    published: Boolean(value.published),
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString()),
  };
}

function normalizeComment(value) {
  return {
    id: Number(value.id) || 0,
    postId: Number(value.postId) || 0,
    author: String(value.author || "anonymous"),
    body: String(value.body || ""),
    notify: Boolean(value.notify),
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString()),
  };
}
