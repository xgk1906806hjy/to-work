const TOKEN_KEY = "to-work-admin-token";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginStatus = document.getElementById("login-status");
const adminEmailEl = document.getElementById("admin-email");

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

function showLogin(msg = "") {
  token = "";
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  loginStatus.textContent = msg;
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  adminEmailEl.textContent = currentUser?.email || "";
}

function switchView(name) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTable(container, columns, rows, rowHtml) {
  if (!rows.length) {
    container.innerHTML = `<div style="padding:16px" class="muted">暂无数据</div>`;
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody>
    </table>
  `;
}

async function loadDashboard() {
  const { stats } = await api("/api/admin/stats");
  const items = [
    ["用户", stats.users],
    ["有简历用户", stats.resumes],
    ["已配置 LLM Key", stats.withLlmKey],
    ["投递记录", stats.applications]
  ];
  document.getElementById("stat-grid").innerHTML = items
    .map(
      ([label, num]) => `
      <div class="stat-card">
        <div class="muted">${escapeHtml(label)}</div>
        <div class="num">${escapeHtml(num)}</div>
      </div>`
    )
    .join("");
}

async function loadUsers() {
  const { items } = await api("/api/admin/users");
  renderTable(
    document.getElementById("users-table"),
    ["ID", "邮箱", "角色", "投递数", "简历更新", "操作"],
    items,
    (u) => `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select data-role-user="${u.id}">
            <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </td>
        <td>${u.applicationCount}</td>
        <td>${escapeHtml(u.resumeUpdatedAt || "-")}</td>
        <td>
          <button type="button" class="btn tiny danger" data-del-user="${u.id}">删除</button>
        </td>
      </tr>`
  );

  document.querySelectorAll("[data-role-user]").forEach((el) => {
    el.addEventListener("change", async () => {
      try {
        await api(`/api/admin/users/${el.dataset.roleUser}`, {
          method: "PATCH",
          body: JSON.stringify({ role: el.value })
        });
        await loadUsers();
      } catch (err) {
        alert(err.message);
        await loadUsers();
      }
    });
  });

  document.querySelectorAll("[data-del-user]").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!confirm("确认删除该用户及其简历/LLM/投递数据？")) return;
      try {
        await api(`/api/admin/users/${el.dataset.delUser}`, { method: "DELETE" });
        await Promise.all([loadUsers(), loadDashboard()]);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function loadResumes() {
  const { items } = await api("/api/admin/resumes");
  const detail = document.getElementById("resume-detail");
  detail.classList.add("hidden");
  renderTable(
    document.getElementById("resumes-table"),
    ["用户", "姓名", "来源", "更新时间", "操作"],
    items,
    (r) => `
      <tr>
        <td>${escapeHtml(r.email)} (#${r.userId})</td>
        <td>${escapeHtml(r.name || "-")}</td>
        <td>${escapeHtml(r.meta?.sourceFile || "-")}</td>
        <td>${escapeHtml(r.updatedAt || "-")}</td>
        <td><button type="button" class="btn tiny" data-view-resume="${r.userId}">查看 JSON</button></td>
      </tr>`
  );

  document.querySelectorAll("[data-view-resume]").forEach((el) => {
    el.addEventListener("click", async () => {
      const data = await api(`/api/admin/resumes/${el.dataset.viewResume}`);
      detail.textContent = JSON.stringify(data.item, null, 2);
      detail.classList.remove("hidden");
    });
  });
}

async function loadLlm() {
  const { items } = await api("/api/admin/llm");
  const byId = Object.fromEntries(items.map((row) => [String(row.userId), row]));
  renderTable(
    document.getElementById("llm-table"),
    ["用户", "Base URL", "Model", "Key", "LLM映射", "更新", "操作"],
    items,
    (row) => `
      <tr>
        <td>${escapeHtml(row.email)} (#${row.userId})</td>
        <td>${escapeHtml(row.baseUrl)}</td>
        <td>${escapeHtml(row.model)}</td>
        <td>${row.apiKey ? "已配置" : "未配置"}</td>
        <td>${row.useLLM ? "开" : "关"}</td>
        <td>${escapeHtml(row.updatedAt || "-")}</td>
        <td><button type="button" class="btn tiny" data-edit-llm="${row.userId}">编辑</button></td>
      </tr>`
  );

  document.querySelectorAll("[data-edit-llm]").forEach((el) => {
    el.addEventListener("click", () => {
      const row = byId[el.dataset.editLlm];
      if (!row) return;
      const form = document.getElementById("llm-form");
      form.userId.value = row.userId;
      form.baseUrl.value = row.baseUrl || "";
      form.model.value = row.model || "";
      form.apiKey.value = row.apiKey || "";
      form.useLLM.checked = !!row.useLLM;
      form.clickFillEnabled.checked = row.clickFillEnabled !== false;
      document.getElementById("llm-dialog-status").textContent = "";
      document.getElementById("llm-dialog").showModal();
    });
  });
}

async function loadApplications() {
  const { items } = await api("/api/admin/applications");
  renderTable(
    document.getElementById("applications-table"),
    ["用户", "公司", "职位", "状态", "网址", "投递时间", "操作"],
    items,
    (a) => `
      <tr>
        <td>${escapeHtml(a.userEmail)} (#${a.userId})</td>
        <td>${escapeHtml(a.company || "-")}</td>
        <td>${escapeHtml(a.title || "-")}</td>
        <td>${escapeHtml(a.status)}</td>
        <td><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(
          a.url || "-"
        )}</a></td>
        <td>${escapeHtml(a.appliedAt || "-")}</td>
        <td><button type="button" class="btn tiny danger" data-del-app="${a.id}">删除</button></td>
      </tr>`
  );

  document.querySelectorAll("[data-del-app]").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!confirm("确认删除该投递记录？")) return;
      try {
        await api(`/api/admin/applications/${el.dataset.delApp}`, { method: "DELETE" });
        await Promise.all([loadApplications(), loadDashboard()]);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function refreshAll() {
  await Promise.all([loadDashboard(), loadUsers(), loadResumes(), loadLlm(), loadApplications()]);
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginStatus.textContent = "登录中...";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("login-email").value.trim(),
        password: document.getElementById("login-password").value
      })
    });
    if (data.user.role !== "admin") {
      throw new Error("需要管理员账号");
    }
    token = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    showApp();
    await refreshAll();
  } catch (err) {
    showLogin(err.message);
  }
});

document.getElementById("btn-logout").addEventListener("click", () => showLogin("已退出"));

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("btn-create-user").addEventListener("click", () => {
  document.getElementById("user-form").reset();
  document.getElementById("user-dialog-status").textContent = "";
  document.getElementById("user-dialog").showModal();
});

document.getElementById("user-dialog-cancel").addEventListener("click", () => {
  document.getElementById("user-dialog").close();
});

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = document.getElementById("user-dialog-status");
  status.textContent = "创建中...";
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value,
        role: form.role.value
      })
    });
    document.getElementById("user-dialog").close();
    await Promise.all([loadUsers(), loadDashboard()]);
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("llm-dialog-cancel").addEventListener("click", () => {
  document.getElementById("llm-dialog").close();
});

document.getElementById("llm-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = document.getElementById("llm-dialog-status");
  status.textContent = "保存中...";
  try {
    await api(`/api/admin/llm/${form.userId.value}`, {
      method: "PUT",
      body: JSON.stringify({
        baseUrl: form.baseUrl.value.trim(),
        model: form.model.value.trim(),
        apiKey: form.apiKey.value,
        useLLM: form.useLLM.checked,
        clickFillEnabled: form.clickFillEnabled.checked
      })
    });
    document.getElementById("llm-dialog").close();
    await loadLlm();
  } catch (err) {
    status.textContent = err.message;
  }
});

async function boot() {
  if (!token) {
    showLogin();
    return;
  }
  try {
    const data = await api("/api/auth/me");
    if (data.user.role !== "admin") throw new Error("需要管理员账号");
    currentUser = data.user;
    showApp();
    await refreshAll();
  } catch (err) {
    showLogin(err.message);
  }
}

boot();
