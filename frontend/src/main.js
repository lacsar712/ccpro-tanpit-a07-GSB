import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "管理员", worker: "操作工" };
const REQUIRED_SIGNERS = 2;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || "请求失败");
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    me: { type: Object },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    username: { type: String },
    password: { type: String },
    view: { type: String },
    books: { type: Array },
    bookPitId: { type: Number },
    showWithdrawn: { type: Boolean },
    slotA: { type: String },
    slotB: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .topbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 2px solid #8a5a2b; }
    .topbar .brand { font-weight: bold; font-size: 1.15em; }
    .topbar nav { display: flex; gap: 6px; flex: 1; }
    .topbar nav button.on { background: #8a5a2b; color: #fff; }
    .who { color: #6b5a48; font-size: 0.92em; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .sig { font-size: 0.85em; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button, select { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    .bar { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
    .bar label { display: flex; align-items: center; gap: 6px; margin: 0; }
    .bookcard { border: 1px solid #cbb89f; border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
    .slots { display: flex; gap: 10px; margin: 8px 0; }
    .slot { flex: 1; border: 1px dashed #8a5a2b; border-radius: 8px; padding: 10px; min-height: 60px; }
    .slot.empty { color: #9a8a76; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #cbb89f; padding: 6px 8px; text-align: left; vertical-align: top; }
    tr.off { color: #9a8a76; }
    td button { padding: 2px 8px; margin: 2px 4px 2px 0; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.me = null;
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.username = "admin";
    this.password = "123456";
    this.view = "map";
    this.books = [];
    this.bookPitId = 0;
    this.showWithdrawn = true;
    this.slotA = "";
    this.slotB = "";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.boot();
  }

  async boot() {
    try {
      this.me = await api("/api/auth/me");
      await this.refresh();
    } catch (e) {
      this.handleErr(e);
    }
  }

  handleErr(e) {
    if (e.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      this.ready = false;
      this.me = null;
      this.board = null;
    }
    this.err = e.message;
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
      if (this.view === "book") await this.loadBooks();
    } catch (e) {
      this.handleErr(e);
    }
  }

  async loadBooks() {
    const q = this.bookPitId ? `?pit_id=${this.bookPitId}` : "";
    try {
      this.books = (await api(`/api/books${q}`)).books;
    } catch (e) {
      this.handleErr(e);
    }
  }

  async switchView(view, pitId) {
    this.err = "";
    this.view = view;
    if (typeof pitId === "number") this.bookPitId = pitId;
    await this.refresh();
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.me = data.user;
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.me = null;
    this.board = null;
    this.picked = null;
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async signPit(pitId) {
    this.err = "";
    try {
      await api(`/api/pits/${pitId}/sign`, { method: "POST" });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async submitBook() {
    this.err = "";
    try {
      await api(`/api/pits/${this.bookPitId}/books`, {
        method: "POST",
        body: JSON.stringify({ signers: [this.slotA, this.slotB] }),
      });
      this.slotA = "";
      this.slotB = "";
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async withdrawSignature(id) {
    this.err = "";
    try {
      await api(`/api/signatures/${id}/withdraw`, { method: "POST" });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async withdrawBook(id) {
    this.err = "";
    try {
      await api(`/api/books/${id}/withdraw`, { method: "POST" });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  renderLogin() {
    return html`<div class="wrap">
      <h1>南冈鞣场</h1>
      <form @submit=${this.login} autocomplete="off">
        <label>用户名
          <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
        </label>
        <label>密码
          <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button>登录</button>
      </form>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderMap() {
    return html`
      <p class="hint">${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0，且现行联签簿有两名不同人签字</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}<br />
            <span class="sig">联签 ${p.signerCount}/${REQUIRED_SIGNERS}</span>
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <p>
              联签：${this.picked.signerCount}/${REQUIRED_SIGNERS}
              ${this.picked.signers.length ? html`（${this.picked.signers.join("、")}）` : ""}
              <button @click=${() => this.switchView("book", this.picked.id)}>打开联签簿</button>
            </p>
            ${this.picked.signerCount < REQUIRED_SIGNERS
              ? html`<p class="hint">联签不足两名不同人，放液将被挡下。</p>`
              : ""}
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}`;
  }

  renderActiveBook() {
    const pit = this.board.pits.find((p) => p.id === this.bookPitId);
    const book = this.books.find((b) => b.pitId === this.bookPitId && !b.withdrawnAt) || null;
    const sigs = book ? book.signatures.filter((s) => !s.withdrawnAt) : [];
    const mine = sigs.some((s) => s.signer === this.me?.username);
    const full = sigs.length >= REQUIRED_SIGNERS;
    const isAdmin = this.me?.role === "admin";
    return html`<div class="bookcard">
      <h3>${pit ? pit.code : ""} · ${book ? `现行簿 #${book.id}` : "尚无现行联签簿"}</h3>
      <div class="slots">
        ${[0, 1].map(
          (i) => html`<div class="slot ${sigs[i] ? "" : "empty"}">
            ${sigs[i]
              ? html`<strong>${sigs[i].signer}</strong> · ${fmt(sigs[i].signedAt)}
                  ${isAdmin ? html`<br /><button @click=${() => this.withdrawSignature(sigs[i].id)}>撤回</button>` : ""}`
              : html`空格`}
          </div>`
        )}
      </div>
      ${!full && !mine
        ? html`<button @click=${() => this.signPit(this.bookPitId)}>签一格（${this.me?.username}）</button>`
        : ""}
      ${mine && !full ? html`<p class="hint">您已签过，同一坑未撤回签字按人去重。</p>` : ""}
      ${full ? html`<p class="hint">双格已签满。</p>` : ""}
      ${!book && isAdmin
        ? html`<div>
            <p class="hint">主管交整簿（两格须为不同人）：</p>
            <input placeholder="签字人一" .value=${this.slotA} @input=${(e) => (this.slotA = e.target.value)} />
            <input placeholder="签字人二" .value=${this.slotB} @input=${(e) => (this.slotB = e.target.value)} />
            <button @click=${this.submitBook}>提交联签簿</button>
          </div>`
        : ""}
    </div>`;
  }

  renderBook() {
    const books = this.showWithdrawn ? this.books : this.books.filter((b) => !b.withdrawnAt);
    const isAdmin = this.me?.role === "admin";
    return html`<section>
      <h2>联签簿</h2>
      <div class="bar">
        <label>按坑筛
          <select @change=${(e) => { this.bookPitId = Number(e.target.value); this.loadBooks(); }}>
            <option value="0" ?selected=${!this.bookPitId}>全部坑</option>
            ${this.board.pits.map(
              (p) => html`<option value=${p.id} ?selected=${p.id === this.bookPitId}>${p.code}</option>`
            )}
          </select>
        </label>
        <label><input type="checkbox" ?checked=${this.showWithdrawn} @change=${(e) => (this.showWithdrawn = e.target.checked)} /> 含已撤回</label>
      </div>
      ${this.bookPitId ? this.renderActiveBook() : html`<p class="hint">选一口坑可签字、交簿；下表为各坑联签簿列表。</p>`}
      <table>
        <thead>
          <tr><th>坑</th><th>簿</th><th>开簿</th><th>状态</th><th>签字（人 · 时刻 · 撤回）</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${books.map(
            (b) => html`<tr class=${b.withdrawnAt ? "off" : ""}>
              <td>${b.pitCode}</td>
              <td>#${b.id}</td>
              <td>${b.createdBy}<br />${fmt(b.createdAt)}</td>
              <td>${b.withdrawnAt ? html`已撤回<br />${fmt(b.withdrawnAt)}<br />${b.withdrawnBy ?? ""}` : "现行"}</td>
              <td>
                ${b.signatures.map(
                  (s) => html`<div>
                    ${s.signer} · ${fmt(s.signedAt)}
                    ${s.withdrawnAt
                      ? html`<span class="hint">（${fmt(s.withdrawnAt)} 由 ${s.withdrawnBy ?? "?"} 撤回）</span>`
                      : isAdmin
                        ? html`<button @click=${() => this.withdrawSignature(s.id)}>撤回</button>`
                        : ""}
                  </div>`
                )}
              </td>
              <td>${!b.withdrawnAt && isAdmin ? html`<button @click=${() => this.withdrawBook(b.id)}>撤回簿</button>` : ""}</td>
            </tr>`
          )}
        </tbody>
      </table>
      ${!books.length ? html`<p class="hint">暂无联签簿。</p>` : ""}
    </section>`;
  }

  render() {
    if (!this.ready) return this.renderLogin();
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`
      <header class="topbar">
        <span class="brand">${this.board.yard}</span>
        <nav>
          <button class=${this.view === "map" ? "on" : ""} @click=${() => this.switchView("map")}>场地图</button>
          <button class=${this.view === "book" ? "on" : ""} @click=${() => this.switchView("book")}>联签簿</button>
        </nav>
        <span class="who">${this.me?.username} · ${ROLE_LABELS[this.me?.role] ?? this.me?.role}</span>
        <button @click=${this.logout}>退出</button>
      </header>
      <div class="wrap">
        ${this.view === "map" ? this.renderMap() : this.renderBook()}
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
  }
}

customElements.define("tan-yard", TanYard);
