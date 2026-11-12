// Vite plugin that gives each app a small local file API (projects, autosave, assets, exchange folder).
// Runs only on the developer's machine. All paths are sanitized and confined to configured roots;
// no shell commands except the optional, fixed Blender CLI conversion (execFile, no shell).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiOptions {
  app: 'gamecraft' | 'logiccraft' | 'particlecraft' | 'worldcraft';
  projectsDir: string;
  exchangeDir: string;
  /** Read-only library folders exposed under /api/library (e.g. GameCraft/Assets, GameCraft/asset-library). */
  libraryDirs?: { id: string; dir: string; label: string }[];
  extensionsDir?: string;
}

const SAFE = /^[A-Za-z0-9_\-. ]{1,120}$/;
function safeName(n: string) {
  if (!SAFE.test(n) || n.includes('..')) throw new Error('Invalid name');
  return n;
}
function within(root: string, p: string) {
  const r = path.resolve(root), q = path.resolve(p);
  if (q !== r && !q.startsWith(r + path.sep)) throw new Error('Path escapes its root');
  return q;
}
function readBody(req: IncomingMessage, limit = 200 * 1024 * 1024): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { rej(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
function send(res: ServerResponse, code: number, body: any, type = 'application/json') {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  // Strings and buffers are sent verbatim (files on disk are already JSON); objects are serialized.
  res.end(type === 'application/json' && typeof body !== 'string' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
}
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.obj': 'text/plain', '.mtl': 'text/plain', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream', '.blend': 'application/octet-stream', '.json': 'application/json', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime' };

function listFiles(dir: string, base = dir): { path: string; size: number; modified: number }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { path: string; size: number; modified: number }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else { const st = fs.statSync(full); out.push({ path: path.relative(base, full).replace(/\\/g, '/'), size: st.size, modified: st.mtimeMs }); }
  }
  return out;
}

export function findBlender(): string | null {
  const env = process.env.BLENDER_PATH;
  if (env && fs.existsSync(env)) return env;
  const roots = ['C:\\Program Files\\Blender Foundation', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender', '/Applications/Blender.app/Contents/MacOS', '/usr/bin', '/usr/local/bin', '/snap/bin'];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const direct = path.join(r, process.platform === 'win32' ? 'blender.exe' : process.platform === 'darwin' ? 'Blender' : 'blender');
    if (fs.existsSync(direct)) return direct;
    try {
      for (const d of fs.readdirSync(r)) { const p = path.join(r, d, 'blender.exe'); if (fs.existsSync(p)) return p; }
    } catch { /* ignore */ }
  }
  return null;
}

export function craftApi(opts: ApiOptions) {
  for (const d of [opts.projectsDir, opts.exchangeDir]) fs.mkdirSync(d, { recursive: true });
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return next();
    const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
    try {
      // ---- projects
      if (parts[0] === 'projects') {
        if (req.method === 'GET' && parts.length === 1) {
          const list = fs.readdirSync(opts.projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
            const f = path.join(opts.projectsDir, d.name, 'project.json');
            if (!fs.existsSync(f)) return null;
            try {
              const j = JSON.parse(fs.readFileSync(f, 'utf8'));
              const auto = path.join(opts.projectsDir, d.name, 'autosave.json');
              return { id: d.name, name: j.name, template: j.template ?? null, modified: fs.statSync(f).mtimeMs, hasNewerAutosave: fs.existsSync(auto) && fs.statSync(auto).mtimeMs > fs.statSync(f).mtimeMs };
            } catch { return { id: d.name, name: d.name + ' (unreadable)', error: true, modified: 0 }; }
          }).filter(Boolean).sort((a: any, b: any) => b.modified - a.modified);
          return send(res, 200, list);
        }
        const id = safeName(parts[1]);
        const dir = within(opts.projectsDir, path.join(opts.projectsDir, id));
        const file = parts[2] === 'autosave' ? 'autosave.json' : 'project.json';
        if (parts[2] === 'files') {
          // Project-local asset files (imported models, textures).
          const rel = parts.slice(3).join('/');
          const p = within(dir, path.join(dir, 'assets', rel));
          if (req.method === 'GET') { if (!fs.existsSync(p)) return send(res, 404, { error: 'Not found' }); res.setHeader('Cache-Control', 'no-cache'); return send(res, 200, fs.readFileSync(p), MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'); }
          if (req.method === 'PUT') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, await readBody(req)); return send(res, 200, { ok: true }); }
          if (req.method === 'DELETE') { if (fs.existsSync(p)) fs.rmSync(p); return send(res, 200, { ok: true }); }
        }
        if (req.method === 'GET') {
          const f = path.join(dir, file);
          if (!fs.existsSync(f)) return send(res, 404, { error: 'Project not found' });
          return send(res, 200, fs.readFileSync(f, 'utf8'), 'application/json');
        }
        if (req.method === 'PUT') {
          const body = (await readBody(req)).toString('utf8');
          JSON.parse(body); // validate JSON before writing
          fs.mkdirSync(dir, { recursive: true });
          const target = path.join(dir, file);
          // Write atomically and keep one backup of the previous save.
          if (file === 'project.json' && fs.existsSync(target)) fs.copyFileSync(target, path.join(dir, 'project.backup.json'));
          fs.writeFileSync(target + '.tmp', body);
          fs.renameSync(target + '.tmp', target);
          if (file === 'project.json') { const a = path.join(dir, 'autosave.json'); if (fs.existsSync(a)) fs.rmSync(a); }
          return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          if (parts[2] === 'autosave') { const a = path.join(dir, 'autosave.json'); if (fs.existsSync(a)) fs.rmSync(a); return send(res, 200, { ok: true }); }
          // Projects are moved to a recoverable trash folder, never hard-deleted.
          const trash = path.join(opts.projectsDir, '.trash');
          fs.mkdirSync(trash, { recursive: true });
          fs.renameSync(dir, path.join(trash, `${id}-${Date.now()}`));
          return send(res, 200, { ok: true });
        }
      }
      // ---- exchange folder shared between GameCraft and LogicCraft
      if (parts[0] === 'exchange') {
        if (req.method === 'GET' && parts.length === 1) return send(res, 200, listFiles(opts.exchangeDir).filter((f) => f.path.endsWith('.json')));
        const name = safeName(parts[1]);
        const p = within(opts.exchangeDir, path.join(opts.exchangeDir, name));
        // Raw bytes (JSON effects, and the .glb models the Blender add-on writes next to them).
        if (req.method === 'GET') { if (!fs.existsSync(p)) return send(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); return res.end(fs.readFileSync(p)); }
        if (req.method === 'PUT') { const body = (await readBody(req)).toString('utf8'); JSON.parse(body); fs.writeFileSync(p, body); return send(res, 200, { ok: true, path: p }); }
      }
      // ---- read-only libraries
      if (parts[0] === 'library') {
        const libs = opts.libraryDirs ?? [];
        if (parts.length === 1) return send(res, 200, libs.map((l) => ({ id: l.id, label: l.label, files: listFiles(l.dir) })));
        const lib = libs.find((l) => l.id === parts[1]);
        if (!lib) return send(res, 404, { error: 'Unknown library' });
        const p = within(lib.dir, path.join(lib.dir, parts.slice(2).join('/')));
        if (!fs.existsSync(p)) return send(res, 404, { error: 'Not found' });
        res.setHeader('Cache-Control', 'max-age=60');
        return send(res, 200, fs.readFileSync(p), MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream');
      }
      // ---- extensions (declarative JSON only; never executed as code)
      if (parts[0] === 'extensions' && opts.extensionsDir) {
        if (!fs.existsSync(opts.extensionsDir)) return send(res, 200, []);
        const out = fs.readdirSync(opts.extensionsDir).filter((f) => f.endsWith('.json')).map((f) => {
          try { return { file: f, manifest: JSON.parse(fs.readFileSync(path.join(opts.extensionsDir!, f), 'utf8')) }; } catch (e: any) { return { file: f, error: e.message }; }
        });
        return send(res, 200, out);
      }
      // ---- Blender conversion (.blend -> .glb) when Blender is installed
      if (parts[0] === 'blender') {
        const exe = findBlender();
        if (parts[1] === 'status') return send(res, 200, { available: !!exe, path: exe });
        if (parts[1] === 'convert' && req.method === 'POST') {
          if (!exe) return send(res, 400, { error: 'Blender was not found. Install Blender (blender.org) or set BLENDER_PATH, or export from Blender with File > Export > glTF 2.0 (.glb).' });
          const pid = safeName(String(url.searchParams.get('project')));
          const rel = String(url.searchParams.get('file'));
          const dir = within(opts.projectsDir, path.join(opts.projectsDir, pid, 'assets'));
          const src = within(dir, path.join(dir, rel));
          if (!src.toLowerCase().endsWith('.blend')) return send(res, 400, { error: 'Only .blend files can be converted' });
          const out = src.replace(/\.blend$/i, '.glb');
          const script = 'import bpy,sys; bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format="GLB", export_apply=True, export_animations=True)';
          await new Promise<void>((resolve, reject) => execFile(exe, ['-b', src, '--python-expr', script, '--', out], { timeout: 180000 }, (err) => (err ? reject(err) : resolve())));
          return send(res, 200, { ok: true, output: path.relative(dir, out).replace(/\\/g, '/') });
        }
      }
      return send(res, 404, { error: 'Unknown API route' });
    } catch (e: any) {
      return send(res, 400, { error: e?.message ?? String(e) });
    }
  };
  return {
    name: 'craft-api',
    configureServer(server: any) { server.middlewares.use(handler); },
    configurePreviewServer(server: any) { server.middlewares.use(handler); },
  };
}
