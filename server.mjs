// カクヨムテキストリーダーを http://127.0.0.1:7878 で開くための最小サーバー。
// file:// のままだと File System Access API が使えず自動更新が効かないため。
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.PORT || 7878);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = resolve(join(ROOT, normalize(path === "/" ? "/index.html" : path)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }

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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`カクヨムテキストリーダー: http://127.0.0.1:${PORT}/`);
  console.log("終了するには Ctrl+C");
});
