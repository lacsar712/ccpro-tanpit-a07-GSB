import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const USER_KEY = "tanpit_user";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

const fmt = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleString("zh-CN", { hour12: false });

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    view: { type: String },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    books: { type: Array },
    bookPitFilter: { type: String },
    err: { type: String },
    note: { type: String },
    user: { type: Object },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 20px 16px 50px; }
    .topbar { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #8a5a2b; padding-bottom: 10px; margin-bottom: 16px; }
    .topbar h1 { font-size: 1.35em; margin: 0; }
    .tabs { margin-left: auto; display: flex; gap: 8px; }
    .tab { padding: 6px 16px; border: 1px solid #8a5a2b; background: #f5ede2; border-radius: 6px; cursor: pointer; }
    .tab.on { background: #8a5a2b; color: #fff; }
    .who { font-size: 0.85em; color: #6b5a48; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; position: relative; }
    .pit .seal { position: absolute; right: 8px; bottom: 6px; font-size: 0.78em; opacity: 0.92; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .note { color: #2f5d3a; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, select, button { font: inherit; padding: 7px 10px; margin: 4px 6px 4px 0; }
    button.act { background: #8a5a2b; color: #fff; border: 0; border-radius: 5px; cursor: pointer; }
    button.ghost { background: #f5ede2; border: 1px solid #b49b82; border-radius: 5px; cursor: pointer; }
    button.danger { background: #9b1c1c; color: #fff; border: 0; border-radius: 5px; cursor: pointer; }
    .book { border: 1px solid #cbb79e; border-radius: 8px; padding: 12px 14px; margin: 12px 0; background: #fbf7f0; }
    .book.dead { opacity: 0.62; background: #f0ece6; }
    .slots { display: flex; gap: 10px; margin: 10px 0; }
    .slot { flex: 1; border: 1px dashed #b49b82; border-radius: 6px; padding: 8px 10px; min-height: 56px; }
    .slot.full { border-style: solid; background: #f3e7d6; }
    .tag { display: inline-block; font-size: 0.78em; padding: 1px 8px; border-radius: 10px; margin-left: 6px; }
    .tag.live { background: #2f5d3a; color: #fff; }
    .tag.dead { background: #777; color: #fff; }
    .revoked { text-decoration: line-through; color: #8a5a5a; }
    .rowline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.view = "board";
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.books = [];
    this.bookPitFilter = "";
    this.err = "";
    this.note = "";
    this.user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    this.username = "admin";
    this.password = "123456";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.refresh();
  }

  get isAdmin() {
    return this.user?.role === "admin";
  }

  async refresh() {
    this.err = "";
    try {
      this.board = await api("/api/board");
      if (!this.user) {
        this.user = await api("/api/auth/me");
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      }
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
      if (this.view === "books") await this.loadBooks();
    } catch (e) {
      this.err = e.message;
    }
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
      this.user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.ready = false;
    this.user = null;
    this.board = null;
  }

  async writePh() {
    this.err = "";
    this.note = "";
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
    this.note = "";
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

  async loadBooks() {
    const q = this.bookPitFilter ? `?pit_id=${this.bookPitFilter}` : "";
    const data = await api(`/api/books${q}`);
    this.books = data.books;
  }

  async switchView(view) {
    this.view = view;
    this.err = "";
    this.note = "";
    if (view === "books") await this.loadBooks().catch((e) => (this.err = e.message));
  }

  async onFilterChange(e) {
    this.bookPitFilter = e.target.value;
    await this.loadBooks().catch((err) => (this.err = err.message));
  }

  async openBook() {
    this.err = "";
    this.note = "";
    try {
      const pitId = this.bookPitFilter || this.picked?.id;
      if (!pitId) throw new Error("请先按坑筛选，再开立联签簿");
      await api(`/api/pits/${pitId}/books`, { method: "POST" });
      this.note = "联签簿已开立，待两名不同人签字";
      await this.loadBooks();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async sign(bookId) {
    this.err = "";
    this.note = "";
    try {
      await api(`/api/books/${bookId}/signatures`, { method: "POST" });
      await this.loadBooks();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async revokeSignature(sigId) {
    this.err = "";
    this.note = "";
    try {
      await api(`/api/signatures/${sigId}/revoke`, { method: "POST" });
      this.note = "签字已撤回";
      await this.loadBooks();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async withdrawBook(bookId) {
    this.err = "";
    this.note = "";
    try {
      await api(`/api/books/${bookId}/withdraw`, { method: "POST" });
      this.note = "整本联签簿已撤回";
      await this.loadBooks();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  pitCode(id) {
    return this.board?.pits.find((p) => p.id === id)?.code || `坑#${id}`;
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
        <p class="hint">已预填 admin / 123456，另有 worker / 123456（两名不同签字人）</p>
        <button class="act">登录</button>
      </form>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderTopbar() {
    return html`<div class="topbar">
      <h1>南冈鞣场</h1>
      <span class="who">${this.user?.username}（${this.isAdmin ? "管理员" : "操作工"}）</span>
      <div class="tabs">
        <button class="tab ${this.view === "board" ? "on" : ""}" @click=${() => this.switchView("board")}>坑位场地图</button>
        <button class="tab ${this.view === "books" ? "on" : ""}" @click=${() => this.switchView("books")}>联签簿</button>
        <button class="ghost" @click=${this.logout}>退出</button>
      </div>
    </div>`;
  }

  renderBoard() {
    return html`
      <p class="hint">青皮村 · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0 且联签簿有两名不同人的未撤回签字。</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
            <span class="seal">联签 ${p.activeSigners}/2</span>
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次 · 现行未撤回签字 ${this.picked.activeSigners}/2 人</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button class="act" @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button class="ghost" @click=${() => this.setStatus("fill")}>注液</button>
              <button class="ghost" @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button class="act" @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
            <p class="hint">登记酸碱度、改成鞣制中均不看联签；「已放液」须 pH 在带内且两名不同人已签字。</p>
          </section>`
        : ""}
    `;
  }

  renderSlots(book) {
    const active = book.signatures.filter((s) => !s.revokedAt);
    const slots = [];
    for (let i = 0; i < book.slots; i++) slots.push(active[i] || null);
    return html`<div class="slots">
      ${slots.map(
        (s) => html`<div class="slot ${s ? "full" : ""}">
          ${s
            ? html`<strong>${s.signer}</strong><br />
              <span class="hint">签于 ${fmt(s.signedAt)}</span><br />
              ${this.isAdmin && book.active
                ? html`<button class="danger" @click=${() => this.revokeSignature(s.id)}>撤回此签</button>`
                : ""}`
            : html`<span class="hint">空签格</span>`}
        </div>`
      )}
    </div>`;
  }

  renderBook(book) {
    const revoked = book.signatures.filter((s) => s.revokedAt);
    return html`<div class="book ${book.active ? "" : "dead"}">
      <div class="rowline">
        <strong>${this.pitCode(book.pitId)}</strong>
        <span class="tag ${book.active ? "live" : "dead"}">${book.active ? "现行" : "已撤回"}</span>
        <span class="hint">开立：${book.openedBy} · ${fmt(book.openedAt)}</span>
        <span style="margin-left:auto" class="hint">未撤回 ${book.activeSignerCount}/2 人</span>
      </div>
      ${this.renderSlots(book)}
      ${book.active
        ? html`<div class="rowline">
            <button class="act" @click=${() => this.sign(book.id)}>我（${this.user?.username}）签字</button>
            ${this.isAdmin ? html`<button class="danger" @click=${() => this.withdrawBook(book.id)}>撤回整簿</button>` : ""}
            ${!this.isAdmin ? html`<span class="hint">签字可由本人添加；撤回须管理员</span>` : ""}
          </div>`
        : html`<p class="hint">整簿由 ${book.withdrawnBy} 于 ${fmt(book.withdrawnAt)} 撤回</p>`}
      ${revoked.length
        ? html`<div class="hint">
            撤回痕迹：
            ${revoked.map(
              (s) => html`<div class="revoked">${s.signer} 签于 ${fmt(s.signedAt)}，由 ${s.revokedBy} 于 ${fmt(s.revokedAt)} 撤回</div>`
            )}
          </div>`
        : ""}
    </div>`;
  }

  renderBooks() {
    const pits = this.board?.pits || [];
    const canOpen = Boolean(this.bookPitFilter);
    return html`
      <div class="rowline">
        <label style="margin:0">按坑筛选
          <select .value=${this.bookPitFilter} @change=${this.onFilterChange}>
            <option value="">全部坑</option>
            ${pits.map((p) => html`<option value=${p.id}>${p.code}（${LABELS[p.status]}）</option>`)}
          </select>
        </label>
        <button class="act" ?disabled=${!canOpen} @click=${this.openBook}>开立联签簿</button>
        <span class="hint">每坑只许一本现行簿；满两名不同人即可放液</span>
      </div>
      ${this.books.length === 0
        ? html`<p class="hint">${this.bookPitFilter ? "该坑尚无联签簿" : "尚无任何联签簿"}</p>`
        : this.books.map((b) => this.renderBook(b))}
    `;
  }

  render() {
    if (!this.ready) return this.renderLogin();
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      ${this.renderTopbar()}
      ${this.view === "board" ? this.renderBoard() : this.renderBooks()}
      ${this.note ? html`<p class="note">${this.note}</p>` : ""}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
