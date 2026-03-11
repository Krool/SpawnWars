import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { type MapDef } from '../simulation/types';
import { ALL_MAPS } from '../simulation/maps';

interface DifficultyOption {
  level: BotDifficultyLevel;
  label: string;
  color: string;
  desc: string;       // one-line summary
  details: string[];  // bullet points explaining what changes
}

const DIFFICULTIES: DifficultyOption[] = [
  {
    level: BotDifficultyLevel.Easy,
    label: 'EASY',
    color: '#4caf50',
    desc: 'Learn the ropes',
    details: [
      'Bots build slowly and skip upgrades',
      'Nukes come late and lanes are random',
      'Great for your first few games',
    ],
  },
  {
    level: BotDifficultyLevel.Medium,
    label: 'MEDIUM',
    color: '#ffd740',
    desc: 'A fair fight',
    details: [
      'Bots build and upgrade at a steady pace',
      'They react to threats and use nukes wisely',
      'The standard experience',
    ],
  },
  {
    level: BotDifficultyLevel.Hard,
    label: 'HARD',
    color: '#ff9100',
    desc: 'They mean business',
    details: [
      'Bots build fast and upgrade aggressively',
      'They counter your strategy and push hard',
      'You will need a plan to win',
    ],
  },
  {
    level: BotDifficultyLevel.Nightmare,
    label: 'NIGHTMARE',
    color: '#ff1744',
    desc: 'No mercy',
    details: [
      'Bots use optimized race-specific builds',
      'Lightning-fast reactions, early nukes',
      'Only the best players survive',
    ],
  },
];

// Helper: draw text with dark drop-shadow
function shadowText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#fff', shadowColor = 'rgba(0,0,0,0.6)',
) {
  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export class DifficultySelectScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private onConfirm: (level: BotDifficultyLevel, mapDef: MapDef) => void;
  private selectedIndex = 1; // default Medium
  private hoverIndex = -1;
  private tick = 0;
  private mapIndex = 0; // index into ALL_MAPS

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private moveHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, onConfirm: (level: BotDifficultyLevel, mapDef: MapDef) => void) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.onConfirm = onConfirm;
  }

  enter(): void {
    this.hoverIndex = -1;

    this.keyHandler = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      }
      if (e.key === 'ArrowDown' || e.key === 's') {
        this.selectedIndex = Math.min(DIFFICULTIES.length - 1, this.selectedIndex + 1);
      }
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.mapIndex = (this.mapIndex + 1) % ALL_MAPS.length;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        this.onConfirm(DIFFICULTIES[this.selectedIndex].level, ALL_MAPS[this.mapIndex]);
      }
      if (e.key === 'Escape') this.manager.switchTo('raceSelect');
    };

    this.clickHandler = (e) => {
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      // Map toggle click
      if (this.isMapToggleAt(cx, cy)) {
        this.mapIndex = (this.mapIndex + 1) % ALL_MAPS.length;
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.onConfirm(DIFFICULTIES[this.selectedIndex].level, ALL_MAPS[this.mapIndex]);
      }
    };

    this.moveHandler = (e) => {
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      this.hoverIndex = this.getCardIndexAt(cx, cy);
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const [cx, cy] = this.toCanvas(touch.clientX, touch.clientY);
      if (this.isMapToggleAt(cx, cy)) {
        this.mapIndex = (this.mapIndex + 1) % ALL_MAPS.length;
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.onConfirm(DIFFICULTIES[this.selectedIndex].level, ALL_MAPS[this.mapIndex]);
      }
    };

    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('mousemove', this.moveHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler);
  }

  exit(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.moveHandler) this.canvas.removeEventListener('mousemove', this.moveHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.keyHandler = null;
    this.clickHandler = null;
    this.moveHandler = null;
    this.touchHandler = null;
  }

  update(_dt: number): void { this.tick++; }

  // ─── Layout ───

  private toCanvas(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private getCardLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const cardW = Math.min(w * 0.8, 420);
    const gap = 10;
    const topMargin = 110; // extra room for map toggle
    const cardH = Math.min((h - topMargin - 80 - gap * 3) / 4, 90);
    const totalH = DIFFICULTIES.length * cardH + (DIFFICULTIES.length - 1) * gap;
    const startY = topMargin + (h - topMargin - 80 - totalH) / 2;
    const startX = (w - cardW) / 2;

    return DIFFICULTIES.map((_, i) => ({
      x: startX,
      y: startY + i * (cardH + gap),
      w: cardW,
      h: cardH,
    }));
  }

  private getCardIndexAt(cx: number, cy: number): number {
    const cards = this.getCardLayout();
    const pad = 4;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (cx >= c.x - pad && cx <= c.x + c.w + pad && cy >= c.y - pad && cy <= c.y + c.h + pad) return i;
    }
    return -1;
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = 260;
    const btnH = 50;
    const pad = 8;
    return cx >= (w - btnW) / 2 - pad && cx <= (w + btnW) / 2 + pad && cy >= h - 66 - pad && cy <= h - 66 + btnH + pad;
  }

  private getMapToggleLayout(): { x: number; y: number; w: number; h: number } {
    const w = this.canvas.clientWidth;
    const toggleW = Math.min(w * 0.5, 220);
    const toggleH = 36;
    return { x: (w - toggleW) / 2, y: 56, w: toggleW, h: toggleH };
  }

  private isMapToggleAt(cx: number, cy: number): boolean {
    const t = this.getMapToggleLayout();
    return cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h;
  }

  // ─── Render ───

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    // Water background
    if (!this.ui.drawWaterBg(ctx, w, h, this.tick * 50)) {
      ctx.fillStyle = '#2a5a6a';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, w, h);

    // Header ribbon
    const ribbonW = Math.min(w * 0.7, 500);
    const ribbonH = Math.min(52, h * 0.07);
    const ribbonX = (w - ribbonW) / 2;
    const ribbonY = 8;
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 0);

    const titleSize = Math.max(13, Math.min(ribbonH * 0.4, 20));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('CHOOSE DIFFICULTY', w / 2, ribbonY + ribbonH * 0.58);

    // Map toggle
    const hintSize = Math.max(9, Math.min(w / 55, 12));
    const mt = this.getMapToggleLayout();
    const mapDef = ALL_MAPS[this.mapIndex];
    const mapLabel = `MAP: ${mapDef.name.toUpperCase()} (${mapDef.playersPerTeam}v${mapDef.playersPerTeam})`;
    const mtBgPadX = Math.round(mt.w * 0.05);
    const mtBgPadY = Math.round(mt.h * 0.05);
    this.ui.drawWoodTable(ctx, mt.x - mtBgPadX, mt.y - mtBgPadY, mt.w + mtBgPadX * 2, mt.h + mtBgPadY * 2);
    ctx.font = `bold ${Math.max(11, Math.min(mt.h * 0.35, 14))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd740';
    ctx.fillText(mapLabel, mt.x + mt.w / 2, mt.y + mt.h * 0.55);
    // Arrow indicators
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `bold ${Math.max(12, mt.h * 0.4)}px monospace`;
    ctx.fillText('<', mt.x + 10, mt.y + mt.h * 0.58);
    ctx.fillText('>', mt.x + mt.w - 10, mt.y + mt.h * 0.58);
    // Sub-hint
    ctx.font = `${Math.max(8, hintSize - 1)}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Tab/Arrows to change map', w / 2, mt.y + mt.h + 10);

    // Hint
    ctx.font = `${hintSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Up/Down to select  |  Enter or START to play', w / 2, mt.y + mt.h + 22);

    // Difficulty cards
    const cards = this.getCardLayout();

    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const diff = DIFFICULTIES[i];
      const card = cards[i];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      // Card background — oversized to account for 9-slice dead space around edges
      const bgPadX = Math.round(card.w * 0.075);
      const bgPadY = Math.round(card.h * 0.075);
      this.ui.drawWoodTable(ctx, card.x - bgPadX, card.y - bgPadY, card.w + bgPadX * 2, card.h + bgPadY * 2);

      // Selection glow
      if (isSelected) {
        ctx.strokeStyle = diff.color;
        ctx.shadowColor = diff.color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
        ctx.shadowBlur = 0;
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      }

      const padX = 14;
      const leftX = card.x + padX;
      const contentTop = card.y + 8;

      // Difficulty label (colored)
      const labelSize = Math.max(12, Math.min(card.h * 0.22, 18));
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.textAlign = 'left';
      shadowText(ctx, diff.label, leftX, contentTop + labelSize, diff.color, 'rgba(0,0,0,0.7)');

      // One-line summary next to label
      const descSize = Math.max(9, labelSize * 0.65);
      const labelWidth = ctx.measureText(diff.label).width;
      ctx.font = `${descSize}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`- ${diff.desc}`, leftX + labelWidth + 10, contentTop + labelSize);

      // Bullet points
      const bulletSize = Math.max(8, Math.min(card.h * 0.14, 11));
      ctx.font = `${bulletSize}px monospace`;
      const bulletStartY = contentTop + labelSize + bulletSize + 4;

      for (let bi = 0; bi < diff.details.length; bi++) {
        const by = bulletStartY + bi * (bulletSize + 3);
        if (by + bulletSize > card.y + card.h - 4) break; // clip if card too small
        const bulletColor = isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
        shadowText(ctx, `  ${diff.details[bi]}`, leftX, by, bulletColor, 'rgba(0,0,0,0.4)');
      }

      // Selected indicator
      if (isSelected) {
        const indW = 6;
        const indH = card.h * 0.5;
        const indY = card.y + (card.h - indH) / 2;
        ctx.fillStyle = diff.color;
        ctx.fillRect(card.x + 2, indY, indW, indH);
      }
    }

    // START button
    const btnW = 260;
    const btnH = 50;
    const btnX = (w - btnW) / 2;
    const btnY = h - 66;
    const selColor = DIFFICULTIES[this.selectedIndex].color;

    // Use sword variant matching difficulty color (0=blue, 2=yellow, 3=purple, 1=red)
    const swordVariant = this.selectedIndex === 0 ? 0 : this.selectedIndex === 1 ? 2 : this.selectedIndex === 2 ? 3 : 1;
    this.ui.drawSword(ctx, btnX, btnY, btnW, btnH, swordVariant);

    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    const textX = btnX + btnW * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('START', textX + 1, btnY + btnH * 0.56 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText('START', textX, btnY + btnH * 0.56);

    // Selected difficulty label under button
    ctx.font = `bold ${Math.max(9, hintSize)}px monospace`;
    ctx.fillStyle = selColor;
    ctx.fillText(DIFFICULTIES[this.selectedIndex].label, w / 2, btnY + btnH + 14);

    // Back hint
    ctx.font = `${hintSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('ESC to go back', w / 2, h - 6);
  }
}
