import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

export const paths = {
  root: ROOT,
  data: DATA_DIR,
  db: path.join(DATA_DIR, 'app.sqlite'),
  secrets: path.join(DATA_DIR, 'secrets.json'),
  pid: path.join(DATA_DIR, 'app.pid'),
  profiles: path.join(DATA_DIR, 'edge-profiles'),
  media: path.join(DATA_DIR, 'media'),
  music: path.join(DATA_DIR, 'music'),
  renders: path.join(DATA_DIR, 'renders'),
  uploads: path.join(DATA_DIR, 'uploads'),
  logs: path.join(DATA_DIR, 'logs'),
  web: path.join(ROOT, 'web'),
  defaultPrompts: path.join(ROOT, 'src', 'prompts'),
};

export function ensureDirs() {
  for (const dir of [paths.data, paths.profiles, paths.media, paths.music, paths.renders, paths.uploads, paths.logs, `${paths.uploads}/logos`, `${paths.uploads}/fonts`]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
