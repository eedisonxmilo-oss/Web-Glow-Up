import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../lib/db';
import { activeVersion, createProject, describeOp, urlKey } from '../lib/model/project';
import { createHideOp } from '../lib/model/ops';

describe('urlKey', () => {
  it('is origin + path, ignoring query, hash and trailing slash', () => {
    expect(urlKey('https://Example.com/shop/?utm=1#top')).toBe('https://example.com/shop');
    expect(urlKey('https://example.com/')).toBe('https://example.com/');
    expect(urlKey('http://localhost:3000/a/b/')).toBe('http://localhost:3000/a/b');
  });
});

describe('createProject', () => {
  it('starts with one empty version A', () => {
    const p = createProject('https://example.com/x?y=1', 'Example');
    expect(p.url).toBe('https://example.com/x');
    expect(p.versions).toHaveLength(1);
    expect(activeVersion(p).label).toBe('A');
    expect(p.notes).toEqual([]);
  });
});

describe('describeOp', () => {
  it('describes what changed, not what is wrong', () => {
    document.body.innerHTML = '<div>Spring sale</div>';
    expect(describeOp(createHideOp(document.querySelector('div')!))).toBe('Hid <div> “Spring sale”');
  });
});

describe('db', () => {
  beforeEach(async () => {
    for (const p of await db.listProjects()) await db.deleteProject(p.id);
  });

  it('saves, finds by url, lists, renames and deletes projects with their images', async () => {
    const p = createProject('https://example.com/', 'Example');
    document.body.innerHTML = '<div>x</div>';
    activeVersion(p).ops.push(createHideOp(document.querySelector('div')!));
    await db.saveProject(p);
    await db.putAsset({ id: 'a1', projectId: p.id, dataUrl: 'data:image/png;base64,AA', name: 'a.png', createdAt: 1 });

    expect((await db.getProjectByUrl('https://example.com/'))?.id).toBe(p.id);
    const list = await db.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].opCount).toBe(1);
    expect(await db.getAssets(['a1', 'nope'])).toEqual({ a1: 'data:image/png;base64,AA' });
    expect(await db.projectOrigins()).toEqual(['https://example.com']);

    await db.renameProject(p.id, 'Acme pitch');
    expect((await db.getProject(p.id))?.title).toBe('Acme pitch');

    await db.deleteProject(p.id);
    expect(await db.getProject(p.id)).toBeNull();
    expect(await db.getAssets(['a1'])).toEqual({});
  });
});
