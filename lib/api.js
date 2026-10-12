const DEFAULT_SERVER = "http://127.0.0.1:3789";

export async function getAuthState() {
  const { auth } = await chrome.storage.local.get(["auth"]);
  return {
    serverUrl: (auth?.serverUrl || DEFAULT_SERVER).replace(/\/+$/, ""),
    token: auth?.token || "",
    user: auth?.user || null
  };
}

export async function setAuthState(patch) {
  const current = await getAuthState();
  const next = {
    serverUrl: (patch.serverUrl ?? current.serverUrl ?? DEFAULT_SERVER).replace(/\/+$/, ""),
    token: patch.token !== undefined ? patch.token : current.token,
    user: patch.user !== undefined ? patch.user : current.user
  };
  await chrome.storage.local.set({ auth: next });
  return next;
}

export async function clearAuth() {
  const { serverUrl } = await getAuthState();
  await chrome.storage.local.set({
    auth: { serverUrl, token: "", user: null }
  });
}

export function isLoggedIn(auth) {
  return !!(auth?.token && auth?.user);
}

export async function apiRequest(path, options = {}) {
  const auth = await getAuthState();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  let res;
  try {
    res = await fetch(`${auth.serverUrl}${path}`, {
      ...options,
      headers
    });
  } catch (err) {
    throw new Error(`无法连接服务器 ${auth.serverUrl}：${err.message || err}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export async function register(email, password) {
  const data = await apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  await setAuthState({ token: data.token, user: data.user });
  return data;
}

export async function login(email, password) {
  const data = await apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  await setAuthState({ token: data.token, user: data.user });
  return data;
}

export async function fetchMe() {
  return apiRequest("/api/auth/me");
}

export async function syncResumeUp(resume, meta) {
  return apiRequest("/api/resume", {
    method: "PUT",
    body: JSON.stringify({ resume, meta: meta || {} })
  });
}

export async function syncResumeDown() {
  return apiRequest("/api/resume");
}

export async function syncLlmUp(settings) {
  return apiRequest("/api/llm", {
    method: "PUT",
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      useLLM: !!settings.useLLM,
      clickFillEnabled: settings.clickFillEnabled !== false
    })
  });
}

export async function syncLlmDown() {
  return apiRequest("/api/llm");
}

export async function listApplications() {
  return apiRequest("/api/applications");
}

export async function createApplication(payload) {
  return apiRequest("/api/applications", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateApplication(id, payload) {
  return apiRequest(`/api/applications/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteApplication(id) {
  return apiRequest(`/api/applications/${id}`, { method: "DELETE" });
}
