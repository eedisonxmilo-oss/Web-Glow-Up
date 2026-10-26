// Local project + image storage in the extension's own IndexedDB (SPEC.md section 4).
// Only extension pages (background, popup) open this; content scripts go through messages,
// because IndexedDB in a content script would belong to the website's origin.

import { countOps } from './model/project';
import type { Project } from './model/types';

const DB_NAME = 'glowup';
const DB_VERSION = 1;

export interface Asset {
  id: string;
  projectId: string;
  /** data: URL, so it can be passed through extension messaging unchanged. */
  dataUrl: string;
  name: string;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  url: string;
  title: string;
  updatedAt: number;
  opCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('url', 'url', { unique: true });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      dbPromise = null;
      reject(open.error);
    };
  });
  return dbPromise;
}

/** For tests. */
export function resetDbConnection(): void {
  dbPromise = null;
}

export async function getProjectByUrl(url: string): Promise<Project | null> {
  const db = await openDb();
  const r = await req(db.transaction('projects').objectStore('projects').index('url').get(url));
  return (r as Project | undefined) ?? null;
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await openDb();
  return ((await req(db.transaction('projects').objectStore('projects').get(id))) as Project | undefined) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put({ ...project, updatedAt: Date.now() });
  await done(tx);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb();
  const all = (await req(db.transaction('projects').objectStore('projects').getAll())) as Project[];
  return all
    .map((p) => ({ id: p.id, url: p.url, title: p.title, updatedAt: p.updatedAt, opCount: countOps(p) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameProject(id: string, title: string): Promise<void> {
  const p = await getProject(id);
  if (!p) return;
  p.title = title.trim() || p.title;
  await saveProject(p);
}

/** Deletes the project and every image stored for it. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'assets'], 'readwrite');
  tx.objectStore('projects').delete(id);
  const assets = tx.objectStore('assets');
  const keys = await req(assets.index('projectId').getAllKeys(id));
  for (const k of keys) assets.delete(k);
  await done(tx);
}

export async function putAsset(asset: Asset): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('assets', 'readwrite');
  tx.objectStore('assets').put(asset);
  await done(tx);
}

export async function getAssets(ids: string[]): Promise<Record<string, string>> {
  const db = await openDb();
  const store = db.transaction('assets').objectStore('assets');
  const out: Record<string, string> = {};
  for (const id of ids) {
    const a = (await req(store.get(id))) as Asset | undefined;
    if (a) out[id] = a.dataUrl;
  }
  return out;
}

/** Origins (scheme + host) that have at least one saved project. */
export async function projectOrigins(): Promise<string[]> {
  const list = await listProjects();
  return [...new Set(list.map((p) => new URL(p.url).origin))];
}
