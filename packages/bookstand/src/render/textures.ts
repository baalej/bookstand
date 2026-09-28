import type { FaceSlot } from '../types.js';
import { createTexture, type GL } from './gl.js';

/**
 * Default number of page textures held on the GPU.
 *
 * Sized against what a frame can actually draw, not picked round. The preload
 * window spans three states — the current spread plus one either side — which
 * is six faces, and a flip draws the turning sheet's two faces from among
 * them. Eight leaves headroom above that so reversing direction finds the page
 * it just left still resident, and stops well short of the point where holding
 * more costs more than re-uploading.
 *
 * At 624x907 RGBA8 — a typical scan, no mipmaps — one texture is 2.26 MB, so
 * this caps a book at roughly 18 MB of GPU memory however long it is.
 */
export const defaultTextureLimit = 8;

/**
 * Image loading and texture upload, bounded.
 *
 * Decode happens off the critical path, a flip never blocks on a load, and the
 * caller is told when something new is ready so it can schedule a frame.
 *
 * **Textures are evicted.** Without that this map only grew: measured at 63
 * textures and 136 MB after skimming 30 spreads of a 120-spread book, and
 * projecting to 522 MB for a full read of a 300-page one — comfortably past
 * the point where mobile Safari discards the WebGL context and the book dies
 * in the reader's hands. The cost of eviction is a re-upload on the way back,
 * from an image the HTTP cache almost certainly still holds.
 */
export class TextureStore {
  /**
   * Insertion order is the recency order. A `Map` iterates oldest-first, so
   * re-inserting on use moves an entry to the young end and eviction can just
   * walk from the front.
   */
  private textures = new Map<string, WebGLTexture>();
  private pending = new Set<string>();
  /**
   * What the next frame may draw. Nothing in here is ever evicted, whatever
   * the limit says — a cache that can blank a visible page has failed at the
   * one thing it must not do.
   */
  private live = new Set<string>();

  constructor(
    private readonly gl: GL,
    /** Called when a texture becomes available, so the host can redraw. */
    private readonly onReady: () => void,
    private readonly limit: number = defaultTextureLimit,
  ) {}

  /** Null while still loading — the renderer substitutes a blank. */
  get(face: FaceSlot): WebGLTexture | null {
    if (!face) return null;
    return this.textures.get(face.image.src) ?? null;
  }

  /**
   * Declare the working set: load what is missing, keep what is present, and
   * release what has fallen outside it once the budget is exceeded.
   *
   * The caller passes the whole preload window, so this doubles as the
   * retention set — the pages the reader can reach next frame are exactly the
   * pages worth holding.
   */
  request(faces: readonly FaceSlot[]): void {
    this.live = new Set<string>();
    for (const face of faces) {
      if (!face) continue;
      const { src } = face.image;
      this.live.add(src);

      const existing = this.textures.get(src);
      if (existing) {
        // Re-insert to mark it as the most recently used.
        this.textures.delete(src);
        this.textures.set(src, existing);
        continue;
      }
      if (this.pending.has(src)) continue;
      this.pending.add(src);
      void this.load(face.image.src, face.image.srcset, face.image.sizes);
    }
    this.evict();
  }

  /**
   * Drop the oldest textures until the budget is met.
   *
   * Skips anything in the live set rather than stopping at it: the live
   * entries were just moved to the young end, so the only way one appears
   * early is a limit smaller than the window, and refusing to look past it
   * would leave the store permanently over budget.
   */
  private evict(): void {
    if (this.textures.size <= this.limit) return;
    for (const [src, texture] of this.textures) {
      if (this.textures.size <= this.limit) break;
      if (this.live.has(src)) continue;
      this.gl.deleteTexture(texture);
      this.textures.delete(src);
    }
  }

  private async load(src: string, srcset?: string, sizes?: string): Promise<void> {
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      if (srcset) image.srcset = srcset;
      if (sizes) image.sizes = sizes;
      image.src = src;

      // Decode off the critical path. Uploading a mid-decode image, or
      // decoding a large JPEG at the moment of a flip, drops frames.
      // `decode` is in the DOM typings unconditionally, so this has to be a
      // runtime check rather than an `in` test, which narrows the else to never.
      if (typeof image.decode === 'function') {
        await image.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Bookstand: failed to load ${src}`));
        });
      }

      // The reader may have moved on during the decode. Upload anyway — the
      // work is already done and the next `request` will evict it if it is no
      // longer wanted — but do not let a stale arrival push out a live page.
      this.textures.set(src, createTexture(this.gl, image));
      this.evict();
      this.onReady();
    } catch {
      // A missing page must not take the book down; it renders blank.
    } finally {
      this.pending.delete(src);
    }
  }

  get size(): number {
    return this.textures.size;
  }

  destroy(): void {
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.pending.clear();
    this.live.clear();
  }
}
