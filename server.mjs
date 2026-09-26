// カクヨムテキストリーダーのローカルサーバー。
//
//   node server.mjs
//
// 既定では http://127.0.0.1:7878 に、このPCからだけ見える形で開く。
// 環境変数で振る舞いを変える。
//
//   PORT       待ち受けポート        既定 7878
//   HOST       待ち受けアドレス      既定 127.0.0.1
//                                    LAN へ出すときだけ 0.0.0.0 にする
//   TEXT_ROOT  本文フォルダのルート  既定は下の DEFAULT_TEXT_ROOT
//
// TEXT_ROOT 配下のテキストは、次の2つで読める。
//
//   GET /api/index          エピソードと版の一覧（JSON）
//   GET /api/file?path=...  本文を1件返す
//
// これがあると、スマホなど別の端末のブラウザからも同じ本文が読める。
// file:// や webkitdirectory と違い、閲覧する端末に本文が無くてよい。
import { createServer } from "node:http";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.PORT || 7878);
const HOST = process.env.HOST || "127.0.0.1";

const DEFAULT_TEXT_ROOT =
  "C:/Users/pachi/Documents/ChatGPT/kakuyomu market researth/kyuketsu-mahou-syojo04/episodes";
const TEXT_ROOT = resolve(process.env.TEXT_ROOT || DEFAULT_TEXT_ROOT);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const isTextFile = (name) => /\.(md|markdown|txt|text)$/i.test(name);
// index.html 側の isEpDir と同じ規則。EP05/notes/ を別エピソードとして拾わないため。
const isEpDir = (name) => /^ep[\s_\-]*0*\d+$/i.test(name);

// target が base の内側に収まっているかを確かめる。
// .. や絶対パスで外へ出ようとする要求を弾く。
const insideBase = (base, target) => target === base || target.startsWith(base + sep);

// /api/file が配ってよい相対パスか。/api/index の走査規則と一致させる。
// これを掛けないと、一覧に出ない EP05/notes/ を直接URLで読めてしまう。
function servablePath(rel) {
  const seg = rel.split("/").filter(Boolean);
  if (!seg.length) return false;
  if (seg.some((s) => s.startsWith(".") || s === ".." )) return false;
  if (seg.length > 4) return false;                                  // walk の depth 上限に対応
  const name = seg[seg.length - 1];
  if (!isTextFile(name)) return false;
  const dirs = seg.slice(0, -1);
  return !dirs.some((s, i) => i < dirs.length - 1 && isEpDir(s));    // EP フォルダ配下は配らない
}

/* ============================================================
   本文フォルダの走査
   ============================================================ */
async function buildIndex() {
  const files = [];
  async function walk(dir, rel, depth, insideEp) {
    if (depth > 3) return;
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;                                    // 読めないフォルダは飛ばす
    }
    for (const item of items) {
      if (item.name.startsWith(".")) continue;    // .git など
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (insideEp) continue;                   // EP フォルダの中は掘らない
        await walk(full, rel ? rel + "/" + item.name : item.name, depth + 1, isEpDir(item.name));
      } else if (item.isFile() && isTextFile(item.name)) {
        try {
          const st = await stat(full);
          files.push({ dir: rel, name: item.name, size: st.size, mtime: Math.floor(st.mtimeMs) });
        } catch { /* 消えた直後などは飛ばす */ }
      }
    }
  }
  await walk(TEXT_ROOT, "", 0, false);
  return { root: TEXT_ROOT.split(/[\\/]/).filter(Boolean).pop() || "本文", files };
}

/* ============================================================
   リクエスト処理
   ============================================================ */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = decodeURIComponent(url.pathname);

  // ---- 本文の一覧 ----
  if (path === "/api/index") {
    try {
      const body = JSON.stringify(await buildIndex());
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }).end(body);
    } catch (err) {
      res.writeHead(500).end(err.message);
    }
    return;
  }

  // ---- 本文を1件 ----
  if (path === "/api/file") {
    const rel = url.searchParams.get("path") || "";
    const target = resolve(join(TEXT_ROOT, normalize(rel.split("/").join(sep))));
    // 正規化した結果に対して判定する。EP005/../EP006/V1.md のような形も正しく扱える。
    const relNorm = relative(TEXT_ROOT, target).split(sep).join("/");
    if (!insideBase(TEXT_ROOT, target) || !servablePath(relNorm)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      const st = await stat(target);
      res.writeHead(200, {
        "content-type": TYPES[extname(target).toLowerCase()] || "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-mtime": String(Math.floor(st.mtimeMs)),
      }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
    return;
  }

  // ---- リーダー本体（このフォルダの中だけ） ----
  const file = resolve(join(ROOT, normalize(path === "/" ? "/index.html" : path)));
  if (!insideBase(ROOT, file)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  // 読み上げ辞書だけは書き込みを許す
  if (req.method === "PUT" && path === "/dictionary.json") {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString("utf8");
      JSON.parse(text);                       // 壊れた JSON は書き込まない
      await writeFile(file, text, "utf8");
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    } catch (err) {
      res.writeHead(400).end(err.message);
    }
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`ポート ${PORT} は既に使われています。`);
    console.error("リーダーを起動した別の窓が残っていないか確認してください。");
    console.error(`別のポートで起動するには:  set PORT=7879 && node server.mjs`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  console.log(`カクヨムテキストリーダー: http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/`);
  console.log(`本文フォルダ: ${TEXT_ROOT}`);
  try {
    const idx = await buildIndex();
    const eps = new Set(idx.files.map((f) => f.dir));
    console.log(`  ${eps.size} フォルダ / ${idx.files.length} ファイルを配信します`);
  } catch {
    console.log("  ※ 本文フォルダを読めませんでした。TEXT_ROOT を確認してください。");
  }
  if (HOST === "0.0.0.0") {
    console.log("※ LAN へ公開中です。同じネットワークの端末から見えます。");
  }
  console.log("終了するには Ctrl+C");
});
