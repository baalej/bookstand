import { describe, expect, it } from 'vitest';
import { TextureStore, defaultTextureLimit } from '../src/render/textures.js';
import type { Face, FaceSlot } from '../src/types.js';

/**
 * A GL stub that records what was created and deleted.
 *
 * Only the four calls `createTexture` in `gl.ts` makes, plus `deleteTexture`.
 * The store is being tested for *bookkeeping* — which textures it holds and
 * which it releases — and that needs no GPU.
 */
function stubGL(): { gl: never; created: number; deleted: object[] } {
  const record = { created: 0, deleted: [] as object[] };
  const gl = {
    TEXTURE_2D: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    TEXTURE_WRAP_S: 4,
    TEXTURE_WRAP_T: 5,
    TEXTURE_MIN_FILTER: 6,
    TEXTURE_MAG_FILTER: 7,
    CLAMP_TO_EDGE: 8,
    LINEAR: 9,
    UNPACK_FLIP_Y_WEBGL: 10,
    createTexture: () => ({ id: ++record.created }),
    deleteTexture: (t: object) => record.deleted.push(t),
    bindTexture: () => {},
    texImage2D: () => {},
    texParameteri: () => {},
    pixelStorei: () => {},
    isContextLost: () => false,
  };
  return { gl: gl as never, ...record, deleted: record.deleted, created: record.created };
}

function face(n: number): Face {
  return {
    index: n,
    image: { src: `/page-${n}.jpg`, alt: `page ${n}` },
    role: 'interior',
    pageNumber: n,
    paper: 'uncoated',
  };
}

/**
 * Put textures in directly. `request` only starts an async image decode, which
 * never resolves without a DOM, so these tests drive the map the way a
 * completed load would and then exercise the bookkeeping around it.
 */
function seed(store: TextureStore, faces: readonly FaceSlot[]): void {
  const inner = store as unknown as {
    textures: Map<string, object>;
    live: Set<string>;
    evict: () => void;
  };
  for (const f of faces) {
    if (f) inner.textures.set(f.image.src, { id: f.image.src });
  }
}

function held(store: TextureStore): string[] {
  return [...(store as unknown as { textures: Map<string, object> }).textures.keys()];
}

describe('texture memory is bounded', () => {
  // Left unbounded this map only grew. Measured on a 120-spread book: 63
  // textures and 136 MB after skimming 30 spreads, projecting to 522 MB for a
  // full read of a 300-page one — past where mobile Safari discards the
  // context and the book dies in the reader's hands.

  it('holds a book to its limit however long the book is', () => {
    const { gl } = stubGL();
    const store = new TextureStore(gl, () => {}, 4);
    // Walk far more pages than the limit, two at a time, as reading does.
    for (let i = 0; i < 40; i += 2) {
      seed(store, [face(i), face(i + 1)]);
      store.request([face(i), face(i + 1)]);
      expect(store.size).toBeLessThanOrEqual(4);
    }
    expect(store.size).toBeLessThanOrEqual(4);
  });

  it('releases the GPU texture, not just the reference', () => {
    // Dropping the map entry alone leaks the allocation for the life of the
    // context, which is the whole thing this exists to prevent.
    const record = { deleted: [] as object[] };
    const gl = {
      createTexture: () => ({}),
      deleteTexture: (t: object) => record.deleted.push(t),
      bindTexture: () => {},
      texImage2D: () => {},
      texParameteri: () => {},
      pixelStorei: () => {},
    } as unknown as never;
    const store = new TextureStore(gl, () => {}, 2);
    seed(store, [face(1), face(2), face(3), face(4)]);
    store.request([face(3), face(4)]);
    expect(record.deleted.length).toBe(2);
  });

  it('never evicts a page the next frame can draw', () => {
    // The failure mode of a cache is showing nothing. The live set is the
    // preload window, and the turning sheet's faces come from inside it.
    const { gl } = stubGL();
    const store = new TextureStore(gl, () => {}, 3);
    const window = [face(10), face(11), face(12), face(13), face(14), face(15)];
    seed(store, [face(1), face(2), ...window]);
    store.request(window);

    for (const f of window) {
      expect(held(store), `${f.image.src} is in the window and must survive`).toContain(
        f.image.src,
      );
    }
    // The stale pages went instead, even though that leaves it over a limit
    // smaller than the window — better over budget than blank.
    expect(held(store)).not.toContain('/page-1.jpg');
    expect(held(store)).not.toContain('/page-2.jpg');
  });

  it('evicts the least recently used, not the least recently loaded', () => {
    const { gl } = stubGL();
    const store = new TextureStore(gl, () => {}, 3);
    seed(store, [face(1), face(2), face(3)]);
    // Revisit page 1, so page 2 becomes the oldest.
    store.request([face(1)]);
    seed(store, [face(4)]);
    store.request([face(4), face(1)]);

    expect(held(store), 'page 1 was used recently').toContain('/page-1.jpg');
    expect(held(store), 'page 2 was the oldest').not.toContain('/page-2.jpg');
  });

  it('keeps a default wide enough for the preload window', () => {
    // The window is the current spread plus one either side: six faces. A
    // limit below that would evict a page on the way to needing it again.
    expect(defaultTextureLimit).toBeGreaterThanOrEqual(6);
  });

  it('ignores reserved halves', () => {
    const { gl } = stubGL();
    const store = new TextureStore(gl, () => {}, 4);
    expect(() => store.request([null, face(1), null])).not.toThrow();
    expect(store.get(null)).toBeNull();
  });
});

describe('a lost context', () => {
  // Every texture belongs to the context that made it. After a loss the map
  // still held all of them, so the restored book drew with dead handles and
  // stayed blank — 0 pixels, INVALID_OPERATION on every draw.

  it('forgets every texture, and the next request loads them again', () => {
    const { gl } = stubGL();
    const store = new TextureStore(gl, () => {}, 8);
    seed(store, [face(1), face(2)]);
    store.reset();
    expect(store.size).toBe(0);
    expect(held(store)).toEqual([]);
  });

  it('does not upload a load that began before the loss', async () => {
    // The decode outlives the context. Uploaded into the new one behind the
    // store's back, its slot already forgotten, it would never be freed.
    let finish: () => void = () => {};
    const decoded = new Promise<void>((resolve) => (finish = resolve));
    const original = globalThis.Image;
    globalThis.Image = class {
      crossOrigin = '';
      src = '';
      decode(): Promise<void> {
        return decoded;
      }
    } as unknown as typeof Image;
    try {
      const stub = stubGL();
      let ready = 0;
      const store = new TextureStore(stub.gl, () => ready++, 8);
      store.request([face(1)]);
      store.reset();
      finish();
      await decoded;
      await new Promise((r) => setTimeout(r, 0));
      expect(store.size).toBe(0);
      expect(ready).toBe(0);

      store.request([face(1)]);
      await new Promise((r) => setTimeout(r, 0));
      expect(store.size, 'reloads after the reset').toBe(1);
    } finally {
      globalThis.Image = original;
    }
  });
});
