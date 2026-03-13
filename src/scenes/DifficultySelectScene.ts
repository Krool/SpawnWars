import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { type MapDef } from '../simulation/types';
import { ALL_MAPS } from '../simulation/maps';

interface DifficultyOption {
  level: BotDifficultyLevel;
  label: string;
  color: string;
  desc: string;
  details: string[];
}

interface MapOption {
  map: MapDef;
  label: string;
  color: string;
  desc: string;
  details: string[];
}

const DIFFICULTIES: DifficultyOption[] = [
  {
    level: BotDifficultyLevel.Easy,
    label: 'EASY',
    color: '#4caf50',
    desc: 'Low-pressure practice',
    details: [
      'Bots expand slowly and rarely tech early',
      'Nukes come late and lane choices are less focused',
      'Best for learning races, builds, and controls',
    ],
  },
  {
    level: BotDifficultyLevel.Medium,
    label: 'MEDIUM',
    color: '#ffd740',
    desc: 'Default challenge',
    details: [
      'Bots build, tech, and contest the map on time',
      'They punish obvious greed but leave room to recover',
      'The best baseline for normal matches',
    ],
  },
  {
    level: BotDifficultyLevel.Hard,
    label: 'HARD',
    color: '#ff9100',
    desc: 'Punishes sloppy play',
    details: [
      'Bots push fast, tech early, and spend efficiently',
      'They react to your lane plan and punish weak defenses',
      'Bring a real opener and a backup plan',
    ],
  },
  {
    level: BotDifficultyLevel.Nightmare,
    label: 'NIGHTMARE',
    color: '#ff1744',
    desc: 'Tournament pace',
    details: [
      'Bots use optimized race-specific builds and timings',
      'Fast reactions, early nukes, and ruthless pressure',
      'Built for players who already beat Hard consistently',
    ],
  },
];

const MAP_OPTIONS: MapOption[] = ALL_MAPS.map((map) => {
  if (map.id === 'skirmish') {
    return {
      map,
      label: 'SKIRMISH',
      color: '#66d9ef',
      desc: 'Wide 3v3 battlefield',
      details: [
        'More room to eco, rotate, and recover',
        'Best for bigger team fights and longer matches',
      ],
    };
  }

  return {
    map,
    label: 'DUEL',
    color: '#ffd740',
    desc: 'Compact 2v2 showdown',
    details: [
      'Short travel times and quick pressure windows',
      'Best for fast matches and direct lane battles',
    ],
  };
});

const LAST_DIFFICULTY_KEY = 'spawnwars.lastDifficulty';
const LAST_MAP_KEY = 'spawnwars.lastMapId';

function shadowText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#fff', shadowColor = 'rgba(0,0,0,0.6)',
) {
  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export class DifficultySelectScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private onConfirm: (level: BotDifficultyLevel, mapDef: MapDef) => void;
  private selectedIndex = 1;
  private hoverIndex = -1;
  private mapHoverIndex = -1;
  private tick = 0;
  private sceneAge = 0;
  private mapIndex = 0;

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
    this.mapHoverIndex = -1;
    this.loadSelections();

    this.keyHandler = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.saveSelections();
      }
      if (e.key === 'ArrowDown' || e.key === 's') {
        this.selectedIndex = Math.min(DIFFICULTIES.length - 1, this.selectedIndex + 1);
        this.saveSelections();
      }
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        this.mapIndex = (this.mapIndex + delta + MAP_OPTIONS.length) % MAP_OPTIONS.length;
        this.saveSelections();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        this.confirmSelection();
      }
      if (e.key === 'Escape') this.manager.switchTo('raceSelect');
    };

    this.clickHandler = (e) => {
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      if (this.isBackButtonAt(cx, cy)) { this.manager.switchTo('raceSelect'); return; }
      const mapIdx = this.getMapCardIndexAt(cx, cy);
      if (mapIdx >= 0) {
        this.mapIndex = mapIdx;
        this.saveSelections();
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.saveSelections();
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.confirmSelection();
      }
    };

    this.moveHandler = (e) => {
      const [cx, cy] = this.toCanvas(e.clientX, e.clientY);
      this.hoverIndex = this.getCardIndexAt(cx, cy);
      this.mapHoverIndex = this.getMapCardIndexAt(cx, cy);
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const [cx, cy] = this.toCanvas(touch.clientX, touch.clientY);
      if (this.isBackButtonAt(cx, cy)) { this.manager.switchTo('raceSelect'); return; }
      const mapIdx = this.getMapCardIndexAt(cx, cy);
      if (mapIdx >= 0) {
        this.mapIndex = mapIdx;
        this.saveSelections();
        return;
      }
      const idx = this.getCardIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.saveSelections();
        return;
      }
      if (this.isStartButtonAt(cx, cy)) {
        this.confirmSelection();
      }
    };

    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('mousemove', this.moveHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
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

  update(_dt: number): void { this.tick++; this.sceneAge += _dt; }

  private toCanvas(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private loadSelections(): void {
    try {
      const savedDifficulty = localStorage.getItem(LAST_DIFFICULTY_KEY) as BotDifficultyLevel | null;
      const diffIndex = DIFFICULTIES.findIndex((diff) => diff.level === savedDifficulty);
      if (diffIndex >= 0) this.selectedIndex = diffIndex;

      const savedMapId = localStorage.getItem(LAST_MAP_KEY);
      const savedMapIndex = MAP_OPTIONS.findIndex((option) => option.map.id === savedMapId);
      if (savedMapIndex >= 0) this.mapIndex = savedMapIndex;
    } catch {}
  }

  private saveSelections(): void {
    try {
      localStorage.setItem(LAST_DIFFICULTY_KEY, DIFFICULTIES[this.selectedIndex].level);
      localStorage.setItem(LAST_MAP_KEY, MAP_OPTIONS[this.mapIndex].map.id);
    } catch {}
  }

  private confirmSelection(): void {
    this.saveSelections();
    this.onConfirm(DIFFICULTIES[this.selectedIndex].level, MAP_OPTIONS[this.mapIndex].map);
  }

  private getMapCardLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const compact = this.compact;
    const gap = compact ? 4 : 10;
    const cardW = Math.min(w * 0.9, 420);
    const cardH = compact ? 42 : 72;
    const startX = (w - cardW) / 2;
    const startY = compact ? 48 : 58;

    return MAP_OPTIONS.map((_, i) => ({
      x: startX,
      y: startY + i * (cardH + gap),
      w: cardW,
      h: cardH,
    }));
  }

  private getCardLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const compact = this.compact;
    const cardW = Math.min(w * 0.9, 420);
    const gap = compact ? 4 : 10;
    const mapCards = this.getMapCardLayout();
    const mapBottom = Math.max(...mapCards.map((card) => card.y + card.h));
    const topMargin = mapBottom + (compact ? 6 : 14);
    const heights = this.getDifficultyCardHeights(cardW);
    const totalH = heights.reduce((sum, cardH) => sum + cardH, 0) + (DIFFICULTIES.length - 1) * gap;
    const btnSpace = compact ? 56 : 80;
    const startY = topMargin + Math.max(0, (h - topMargin - btnSpace - totalH) / 2);
    const startX = (w - cardW) / 2;
    let nextY = startY;

    return DIFFICULTIES.map((_, i) => {
      const card = {
        x: startX,
        y: nextY,
        w: cardW,
        h: heights[i],
      };
      nextY += heights[i] + gap;
      return card;
    });
  }

  private getDifficultyCardHeights(cardW: number): number[] {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return DIFFICULTIES.map(() => 104);
    return DIFFICULTIES.map((diff, i) => this.measureDifficultyCardHeight(ctx, cardW, diff, i));
  }

  private get compact(): boolean { return this.canvas.clientHeight < 700; }

  private measureDifficultyCardHeight(ctx: CanvasRenderingContext2D, cardW: number, diff: DifficultyOption, index: number): number {
    const compact = this.compact;
    const padX = compact ? 10 : 14;
    const textWidth = cardW - padX * 2;
    const labelSize = compact ? 14 : 18;
    const descSize = Math.max(9, labelSize * 0.65);
    const bulletSize = compact ? 10 : 11;
    const showDetails = !compact || index === this.selectedIndex;

    ctx.font = `${descSize}px monospace`;
    const descLines = wrapLines(ctx, diff.desc, textWidth);

    let height = (compact ? 8 : 14) + labelSize + 6 + descLines.length * (descSize + 3);

    if (showDetails) {
      ctx.font = `${bulletSize}px monospace`;
      const bulletLineCount = diff.details.reduce((sum, detail) => sum + wrapLines(ctx, detail, textWidth - 8).length, 0);
      height += 6 + bulletLineCount * (bulletSize + 3);
    }

    height += compact ? 6 : 12;
    return Math.max(compact ? 44 : 96, Math.ceil(height));
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

  private getMapCardIndexAt(cx: number, cy: number): number {
    const cards = this.getMapCardLayout();
    const pad = 4;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (cx >= c.x - pad && cx <= c.x + c.w + pad && cy >= c.y - pad && cy <= c.y + c.h + pad) return i;
    }
    return -1;
  }

  private getButtonRow(): { backX: number; startX: number; btnW: number; btnH: number; btnY: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const compact = this.compact;
    const btnGap = 10;
    const totalBtnW = Math.min(w * 0.9, 440);
    const btnW = (totalBtnW - btnGap) / 2;
    const rowX = (w - totalBtnW) / 2;
    const btnH = compact ? 42 : 56;
    const btnY = h - (compact ? 52 : 72);
    return { backX: rowX, startX: rowX + btnW + btnGap, btnW, btnH, btnY };
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const { startX, btnW, btnH, btnY } = this.getButtonRow();
    const pad = 8;
    return cx >= startX - pad && cx <= startX + btnW + pad && cy >= btnY - pad && cy <= btnY + btnH + pad;
  }

  private isBackButtonAt(cx: number, cy: number): boolean {
    const { backX, btnW, btnH, btnY } = this.getButtonRow();
    const pad = 8;
    return cx >= backX - pad && cx <= backX + btnW + pad && cy >= btnY - pad && cy <= btnY + btnH + pad;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    if (!this.ui.drawWaterBg(ctx, w, h, this.tick * 50)) {
      ctx.fillStyle = '#2a5a6a';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, w, h);

    const ribbonW = Math.min(w * 0.7, 500);
    const ribbonH = Math.min(52, h * 0.07);
    const ribbonX = (w - ribbonW) / 2;
    const ribbonY = 8;
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 0);

    const titleSize = Math.max(13, Math.min(ribbonH * 0.4, 20));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('GAME SETTINGS', w / 2, ribbonY + ribbonH * 0.58);

    const hintSize = Math.max(9, Math.min(w / 55, 12));
    const mapCards = this.getMapCardLayout();

    for (let i = 0; i < MAP_OPTIONS.length; i++) {
      const option = MAP_OPTIONS[i];
      const card = mapCards[i];
      const isSelected = i === this.mapIndex;
      const isHover = i === this.mapHoverIndex;

      const bgPadX = Math.round(card.w * 0.075);
      const bgPadY = Math.round(card.h * 0.075);
      this.ui.drawWoodTable(ctx, card.x - bgPadX, card.y - bgPadY, card.w + bgPadX * 2, card.h + bgPadY * 2);

      if (isSelected) {
        ctx.strokeStyle = option.color;
        ctx.shadowColor = option.color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
        ctx.shadowBlur = 0;
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      }

      const compact = this.compact;
      const padX = compact ? 8 : 12;
      const leftX = card.x + padX;
      const topY = card.y + (compact ? 4 : 8);
      const labelSize = compact ? Math.max(10, Math.min(card.h * 0.3, 13)) : Math.max(11, Math.min(card.h * 0.22, 16));
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.textAlign = 'left';
      shadowText(ctx, `${option.label} (${option.map.playersPerTeam}v${option.map.playersPerTeam})`, leftX, topY + labelSize, option.color, 'rgba(0,0,0,0.7)');

      const descSize = Math.max(8, labelSize * 0.7);
      ctx.font = `${descSize}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(option.desc, leftX, topY + labelSize + descSize + (compact ? 2 : 4));

      if (!compact) {
        const detailSize = Math.max(8, Math.min(card.h * 0.14, 10));
        ctx.font = `${detailSize}px monospace`;
        for (let di = 0; di < option.details.length; di++) {
          const y = topY + labelSize + descSize + 10 + (di + 1) * (detailSize + 2);
          shadowText(ctx, `  ${option.details[di]}`, leftX, y, isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.58)', 'rgba(0,0,0,0.4)');
        }
      }
    }

    const cards = this.getCardLayout();

    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const diff = DIFFICULTIES[i];
      const card = cards[i];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      const bgPadX = Math.round(card.w * 0.075);
      const bgPadY = Math.round(card.h * 0.075);
      this.ui.drawWoodTable(ctx, card.x - bgPadX, card.y - bgPadY, card.w + bgPadX * 2, card.h + bgPadY * 2);

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

      const compact = this.compact;
      const padX = compact ? 10 : 14;
      const leftX = card.x + padX;
      const contentTop = card.y + (compact ? 4 : 10);
      const labelSize = compact ? 14 : 18;
      const textWidth = card.w - padX * 2;
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.textAlign = 'left';
      shadowText(ctx, diff.label, leftX, contentTop + labelSize, diff.color, 'rgba(0,0,0,0.7)');

      const descSize = Math.max(9, labelSize * 0.65);
      ctx.font = `${descSize}px monospace`;
      const descLines = wrapLines(ctx, diff.desc, textWidth);
      let lineY = contentTop + labelSize + 6;
      for (const line of descLines) {
        shadowText(ctx, line, leftX, lineY + descSize, 'rgba(255,255,255,0.78)', 'rgba(0,0,0,0.5)');
        lineY += descSize + 3;
      }

      const showDetails = !compact || isSelected;
      if (showDetails) {
        const bulletSize = compact ? 10 : 11;
        ctx.font = `${bulletSize}px monospace`;
        lineY += 3;
        for (const detail of diff.details) {
          const wrapped = wrapLines(ctx, detail, textWidth - 8);
          for (let li = 0; li < wrapped.length; li++) {
            const prefix = li === 0 ? '• ' : '  ';
            shadowText(ctx, `${prefix}${wrapped[li]}`, leftX, lineY + bulletSize, isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.58)', 'rgba(0,0,0,0.4)');
            lineY += bulletSize + 3;
          }
        }
      }

      if (isSelected) {
        const indW = 6;
        const indH = card.h * 0.5;
        const indY = card.y + (card.h - indH) / 2;
        ctx.fillStyle = diff.color;
        ctx.fillRect(card.x + 2, indY, indW, indH);
      }
    }

    // Bottom button row: BACK (left) + START (right) — matches race select sizing
    const { backX, startX, btnW, btnH, btnY } = this.getButtonRow();
    const selColor = DIFFICULTIES[this.selectedIndex].color;
    const btnFontSize = this.compact ? 13 : 16;
    const rb = UIAssets.swordReveal(this.sceneAge, 0);
    const obx = this.ui.drawSword(ctx, backX, btnY, btnW, btnH, 4, rb);
    if (rb > 0) {
      ctx.font = `bold ${btnFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = rb;
      const backTextX = backX + btnW * 0.52 + obx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('BACK', backTextX + 1, btnY + btnH * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('BACK', backTextX, btnY + btnH * 0.58);
      ctx.globalAlpha = 1;
    }

    // START sword (blue variant 0)
    const rs = UIAssets.swordReveal(this.sceneAge, 1);
    const osx = this.ui.drawSword(ctx, startX, btnY, btnW, btnH, 0, rs);
    if (rs > 0) {
      ctx.font = `bold ${btnFontSize}px monospace`;
      ctx.globalAlpha = rs;
      const startTextX = startX + btnW * 0.52 + osx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('START', startTextX + 1, btnY + btnH * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('START', startTextX, btnY + btnH * 0.58);
      ctx.globalAlpha = 1;
    }

    const hintY = this.compact ? btnY + btnH + 8 : btnY + btnH + 14;
    ctx.font = `bold ${Math.max(9, hintSize)}px monospace`;
    ctx.fillStyle = selColor;
    ctx.fillText(`${DIFFICULTIES[this.selectedIndex].label}  •  ${MAP_OPTIONS[this.mapIndex].label}`, w / 2, hintY);
  }
}
