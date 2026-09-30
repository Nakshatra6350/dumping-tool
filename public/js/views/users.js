import { api } from "../api.js";
import { html, icon, toast, openModal, confirmDialog, initials, timeAgo, skeleton } from "../ui.js";

const userForm = () => html`
  <div class="stack">
    <div class="field"><label for="u-name">Full name</label><input class="input" id="u-name" required /></div>
    <div class="field"><label for="u-email">Email</label><input class="input" id="u-email" type="email" required /></div>
    <div class="field">
      <label for="u-pass">Temporary password</label>
      <input class="input mono" id="u-pass" minlength="8" required />
      <span class="hint">Share it with the user; they can change it under Settings.</span>
    </div>
    <div class="field">
      <label for="u-role">Role</label>
      <select class="input" id="u-role">
        <option value="user">User — manages their own jobs and dumps</option>
        <option value="admin">Admin — sees everything, manages users</option>
      </select>
    </div>
    <div class="modal-error"></div>
  </div>`;

const randomPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 14);
};

const modalError = (el, msg) => {
  el.querySelector(".modal-error").innerHTML = html`<div class="form-error">${icon("alert")} ${msg}</div>`.s;
};

export const renderUsers = async ({ root, user: me }) => {
  root.innerHTML = html`
    <div class="page-head"><div><h1>Users</h1></div></div>${skeleton(260)}`.s;

  const load = async () => {
    const { users } = await api.get("/users");
    root.innerHTML = html`
      <div class="page-head">
        <div><h1>Users</h1><p>Who can sign in. Users only see their own jobs and dumps; admins see everything.</p></div>
        <button class="btn primary" id="add-user">${icon("userPlus")} Add user</button>
      </div>
      <div class="card">
        <table class="table">
          <thead><tr><th>User</th><th>Role</th><th class="num">Jobs</th><th>Last sign-in</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${users.map(
              (u, i) => html`<tr style="--i:${i}" data-id="${u.id}" data-name="${u.name}">
                <td class="primary-cell">
                  <div class="row" style="flex-wrap:nowrap">
                    <span class="avatar">${initials(u.name)}</span>
                    <div style="min-width:0"><div class="cell-main">${u.name} ${u.id === me.id ? html`<span class="tag">you</span>` : ""}</div><div class="cell-sub">${u.email}</div></div>
                  </div>
                </td>
                <td data-label="Role"><span class="pill ${u.role === "admin" ? "running" : ""}">${icon(u.role === "admin" ? "shield" : "users")} ${u.role === "admin" ? "Admin" : "User"}</span></td>
                <td class="num" data-label="Jobs">${u.jobs}</td>
                <td data-label="Last sign-in">${timeAgo(u.lastLoginAt)}</td>
                <td class="actions">
                  <button class="btn sm ghost" data-reset="${u.id}">${icon("key")} Reset password</button>
                  ${u.id !== me.id ? html`<button class="btn sm ghost icon-only danger" data-remove="${u.id}" aria-label="Delete user" title="Delete user">${icon("trash")}</button>` : ""}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`.s;
  };

  root.addEventListener("click", async (e) => {
    if (e.target.closest("#add-user")) {
      await openModal({
        title: "Add user",
        description: "Create an account that can sign in to the dashboard.",
        iconName: "userPlus",
        body: userForm(),
        onMount: (el) => (el.querySelector("#u-pass").value = randomPassword()),
        actions: [
          { label: "Cancel", value: false },
          {
            label: "Create user",
            kind: "primary",
            onClick: async (el) => {
              try {
                await api.post("/users", {
                  name: el.querySelector("#u-name").value,
                  email: el.querySelector("#u-email").value,
                  password: el.querySelector("#u-pass").value,
                  role: el.querySelector("#u-role").value,
                });
                toast({ type: "success", title: "User created" });
                await load();
              } catch (err) {
                modalError(el, err.message);
                return false;
              }
            },
          },
        ],
      });
    }

    const reset = e.target.closest("[data-reset]");
    if (reset) {
      const name = reset.closest("tr").dataset.name;
      await openModal({
        title: `Reset password for ${name}`,
        description: "Their existing sessions will be signed out.",
        iconName: "key",
        body: html`<div class="stack"><div class="field"><label for="r-pass">New password</label><input class="input mono" id="r-pass" minlength="8" /></div><div class="modal-error"></div></div>`,
        onMount: (el) => (el.querySelector("#r-pass").value = randomPassword()),
        actions: [
          { label: "Cancel", value: false },
          {
            label: "Set password",
            kind: "primary",
            onClick: async (el) => {
              try {
                await api.post(`/users/${reset.dataset.reset}/password`, { password: el.querySelector("#r-pass").value });
                toast({ type: "success", title: "Password updated", message: `Share the new password with ${name}.` });
              } catch (err) {
                modalError(el, err.message);
                return false;
              }
            },
          },
        ],
      });
    }

    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const name = remove.closest("tr").dataset.name;
      const ok = await confirmDialog({
        title: `Delete ${name}?`,
        description: "They will no longer be able to sign in.",
        confirmLabel: "Delete user",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/users/${remove.dataset.remove}`);
        toast({ type: "success", title: "User deleted" });
        await load();
      } catch (err) {
        toast({ type: "error", title: "Cannot delete user", message: err.message });
      }
    }
  });

  await load();
};

