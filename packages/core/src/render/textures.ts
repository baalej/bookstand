import type { FaceSlot } from '../types.js';
import { createTexture, type GL } from './gl.js';

/**
 * Image loading and texture upload.
 *
 * Phase 2 scope: decode before upload, never block a flip, tell the caller
 * when something new is ready so it can schedule a frame. The preload window,
 * LRU eviction and responsive sources land in Phase 5 — the `get`/`request`
 * seam here is where they plug in.
 */
export class TextureStore {
  private textures = new Map<string, WebGLTexture>();
  private pending = new Set<string>();

  constructor(
    private readonly gl: GL,
    /** Called when a texture becomes available, so the host can redraw. */
    private readonly onReady: () => void,
  ) {}

  /** Null while still loading — the renderer substitutes a blank. */
  get(face: FaceSlot): WebGLTexture | null {
    if (!face) return null;
    return this.textures.get(face.image.src) ?? null;
  }

  request(faces: readonly FaceSlot[]): void {
    for (const face of faces) {
      if (!face) continue;
      const { src } = face.image;
      if (this.textures.has(src) || this.pending.has(src)) continue;
      this.pending.add(src);
      void this.load(face.image.src, face.image.srcset, face.image.sizes);
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

      this.textures.set(src, createTexture(this.gl, image));
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
  }
}
