import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../simulation/types';

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private maxZoom = 3;

  private get minZoom(): number {
    const worldW = MAP_WIDTH * TILE_SIZE;
    const worldH = MAP_HEIGHT * TILE_SIZE;
    return Math.min(this.canvas.width / worldW, this.canvas.height / worldH);
  }

  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupInputs();
    // Start centered on the map, zoom clamped so full board is always reachable
    this.zoom = Math.max(this.minZoom, this.zoom);
    const worldW = MAP_WIDTH * TILE_SIZE;
    const worldH = MAP_HEIGHT * TILE_SIZE;
    this.x = (worldW - canvas.width / this.zoom) / 2;
    this.y = (worldH - canvas.height / this.zoom) / 2;
  }

  private setupInputs(): void {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.x -= dx / this.zoom;
      this.y -= dy / this.zoom;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.clamp();
    });

    c.addEventListener('pointerup', () => { this.isDragging = false; });
    c.addEventListener('pointerleave', () => { this.isDragging = false; });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = c.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = this.x + cursorX / this.zoom;
      const worldY = this.y + cursorY / this.zoom;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
      this.x = worldX - cursorX / this.zoom;
      this.y = worldY - cursorY / this.zoom;
      this.clamp();
    }, { passive: false });

    const keys = new Set<string>();
    window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

    const panSpeed = 8;
    const tick = () => {
      if (keys.has('w') || keys.has('arrowup')) this.y -= panSpeed / this.zoom;
      if (keys.has('s') || keys.has('arrowdown')) this.y += panSpeed / this.zoom;
      if (keys.has('a') || keys.has('arrowleft')) this.x -= panSpeed / this.zoom;
      if (keys.has('d') || keys.has('arrowright')) this.x += panSpeed / this.zoom;
      this.clamp();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private clamp(): void {
    const worldW = MAP_WIDTH * TILE_SIZE;
    const worldH = MAP_HEIGHT * TILE_SIZE;
    const viewW = this.canvas.width / this.zoom;
    const viewH = this.canvas.height / this.zoom;
    const margin = 100;
    this.x = Math.max(-margin, Math.min(worldW - viewW + margin, this.x));
    this.y = Math.max(-margin, Math.min(worldH - viewH + margin, this.y));
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom,
    };
  }

  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
  }
}
