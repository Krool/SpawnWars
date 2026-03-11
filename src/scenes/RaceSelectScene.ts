import { Scene, SceneManager } from './Scene';
import { Race } from '../simulation/types';
import { RACE_COLORS } from '../simulation/data';
import { SpriteLoader, drawSpriteFrame } from '../rendering/SpriteLoader';
import { UIAssets } from '../rendering/UIAssets';
import { SoundManager } from '../audio/SoundManager';
import { getAudioSettings, subscribeToAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { drawSettingsButton, drawSettingsOverlay, getSettingsOverlayLayout, hitRect, sliderValueFromPoint } from '../ui/SettingsOverlay';

type ResIcon = 'uiGold' | 'uiWood' | 'uiMeat';

interface RaceOption {
  race: Race;
  label: string;
  desc: string;
  econ: [ResIcon, ResIcon];
}

const RACES: RaceOption[] = [
  { race: Race.Crown, label: 'CROWN', desc: 'Shield + balance', econ: ['uiGold', 'uiWood'] },
  { race: Race.Horde, label: 'HORDE', desc: 'Brute force + knockback', econ: ['uiGold', 'uiMeat'] },
  { race: Race.Goblins, label: 'GOBLINS', desc: 'Speed + poison', econ: ['uiGold', 'uiWood'] },
  { race: Race.Oozlings, label: 'OOZLINGS', desc: 'Swarm + haste', econ: ['uiGold', 'uiMeat'] },
  { race: Race.Demon, label: 'DEMON', desc: 'Glass cannon + burn', econ: ['uiMeat', 'uiWood'] },
  { race: Race.Deep, label: 'DEEP', desc: 'Control + slow', econ: ['uiWood', 'uiGold'] },
  { race: Race.Wild, label: 'WILD', desc: 'Aggro + poison', econ: ['uiWood', 'uiMeat'] },
  { race: Race.Geists, label: 'GEISTS', desc: 'Undying + lifesteal', econ: ['uiMeat', 'uiGold'] },
  { race: Race.Tenders, label: 'TENDERS', desc: 'Regen + healing', econ: ['uiWood', 'uiGold'] },
];

const COLS = 3;
const ROWS = 3;

function woodText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#fff', shadowColor = 'rgba(0,0,0,0.6)',
) {
  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export class RaceSelectScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private selectedIndex = 0;
  private hoverIndex = -1;
  private onConfirm: (race: Race) => void;
  private sprites: SpriteLoader;
  private ui: UIAssets;
  private tick = 0;
  private settingsOpen = false;
  private music = new SoundManager();
  private audioSettings = getAudioSettings();
  private audioSettingsUnsub: (() => void) | null = null;

  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private moveHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, sprites: SpriteLoader, ui: UIAssets, onConfirm: (race: Race) => void) {
    this.manager = manager;
    this.canvas = canvas;
    this.sprites = sprites;
    this.ui = ui;
    this.onConfirm = onConfirm;
  }

  enter(): void {
    this.hoverIndex = -1;
    this.settingsOpen = false;
    this.audioSettingsUnsub = subscribeToAudioSettings((settings) => {
      this.audioSettings = settings;
    });
    this.music.startRaceSelectMusic(RACES[this.selectedIndex].race);

    this.keyHandler = (e) => {
      const prevIndex = this.selectedIndex;
      const col = this.selectedIndex % COLS;
      const row = Math.floor(this.selectedIndex / COLS);
      if (e.key === 'ArrowLeft' || e.key === 'a') { if (col > 0) this.selectedIndex--; }
      if (e.key === 'ArrowRight' || e.key === 'd') { if (col < COLS - 1) this.selectedIndex++; }
      if (e.key === 'ArrowUp' || e.key === 'w') { if (row > 0) this.selectedIndex -= COLS; }
      if (e.key === 'ArrowDown' || e.key === 's') { if (row < ROWS - 1) this.selectedIndex += COLS; }
      this.selectedIndex = Math.max(0, Math.min(RACES.length - 1, this.selectedIndex));
      if (this.selectedIndex !== prevIndex) this.music.previewRaceSelection(RACES[this.selectedIndex].race);
      if (e.key === 'Enter' || e.key === ' ') this.confirm();
      if (e.key === 'Escape') {
        if (this.settingsOpen) this.settingsOpen = false;
        else this.manager.switchTo('title');
      }
    };

    this.clickHandler = (e) => {
      const [cx, cy] = this.toCanvasCoords(e.clientX, e.clientY);
      if (this.handleSettingsClick(cx, cy)) return;
      const idx = this.getBoxIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.music.previewRaceSelection(RACES[this.selectedIndex].race);
      } else if (this.isStartButtonAt(cx, cy)) {
        this.confirm();
      }
    };

    this.moveHandler = (e) => {
      const [cx, cy] = this.toCanvasCoords(e.clientX, e.clientY);
      this.hoverIndex = this.getBoxIndexAt(cx, cy);
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const [cx, cy] = this.toCanvasCoords(touch.clientX, touch.clientY);
      if (this.handleSettingsClick(cx, cy)) return;
      const idx = this.getBoxIndexAt(cx, cy);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.music.previewRaceSelection(RACES[this.selectedIndex].race);
      } else if (this.isStartButtonAt(cx, cy)) {
        this.confirm();
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
    this.audioSettingsUnsub?.();
    this.audioSettingsUnsub = null;
    this.music.dispose();
  }

  private handleSettingsClick(cx: number, cy: number): boolean {
    const layout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
    if (hitRect(cx, cy, layout.button)) {
      this.settingsOpen = !this.settingsOpen;
      return true;
    }
    if (!this.settingsOpen) return false;
    if (hitRect(cx, cy, layout.close)) {
      this.settingsOpen = false;
      return true;
    }
    if (hitRect(cx, cy, layout.musicRow)) {
      updateAudioSettings({ musicVolume: sliderValueFromPoint(cx, layout.musicRow) });
      return true;
    }
    if (hitRect(cx, cy, layout.sfxRow)) {
      updateAudioSettings({ sfxVolume: sliderValueFromPoint(cx, layout.sfxRow) });
      return true;
    }
    if (hitRect(cx, cy, layout.panel)) return true;
    this.settingsOpen = false;
    return false;
  }

  private confirm(): void {
    this.onConfirm(RACES[this.selectedIndex].race);
  }

  private getBoxLayout(): { x: number; y: number; w: number; h: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const headerH = 70;
    const footerH = 80;
    const availH = h - headerH - footerH;
    const availW = w - 40;
    const gapX = 8;
    const gapY = 8;
    const maxBoxW = (availW - (COLS - 1) * gapX) / COLS;
    const maxBoxH = (availH - (ROWS - 1) * gapY) / ROWS;
    const boxW = Math.min(maxBoxW, maxBoxH * 0.85);
    const boxH = Math.min(maxBoxH, boxW * 1.18);
    const totalW = COLS * boxW + (COLS - 1) * gapX;
    const totalH = ROWS * boxH + (ROWS - 1) * gapY;
    const startX = (w - totalW) / 2;
    const startY = headerH + (availH - totalH) / 2;

    return RACES.map((_, i) => ({
      x: startX + (i % COLS) * (boxW + gapX),
      y: startY + Math.floor(i / COLS) * (boxH + gapY),
      w: boxW,
      h: boxH,
    }));
  }

  private toCanvasCoords(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private isStartButtonAt(cx: number, cy: number): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = 260;
    const btnH = 56;
    const pad = 8;
    return cx >= (w - btnW) / 2 - pad && cx <= (w + btnW) / 2 + pad && cy >= h - 72 - pad && cy <= h - 72 + btnH + pad;
  }

  private getBoxIndexAt(cx: number, cy: number): number {
    const boxes = this.getBoxLayout();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return i;
    }
    return -1;
  }

  update(_dt: number): void { this.tick++; }

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
    const ribbonH = Math.min(56, h * 0.07);
    const ribbonX = (w - ribbonW) / 2;
    const ribbonY = 8;
    this.ui.drawBigRibbon(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 0);

    const titleSize = Math.max(14, Math.min(ribbonH * 0.4, 22));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('CHOOSE YOUR RACE', w / 2, ribbonY + ribbonH * 0.58);

    const hintSize = Math.max(9, Math.min(w / 55, 12));
    ctx.font = `${hintSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Arrow keys + Enter  |  Click to select', w / 2, ribbonY + ribbonH + 12);

    const boxes = this.getBoxLayout();
    const fontSize = Math.max(10, Math.min(boxes[0].w / 8, 16));

    for (let i = 0; i < RACES.length; i++) {
      const race = RACES[i];
      const box = boxes[i];
      const colors = RACE_COLORS[race.race];
      const isSelected = i === this.selectedIndex;
      const isHover = i === this.hoverIndex;

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();

      const bgPadX = Math.round(box.w * 0.075);
      const bgPadY = Math.round(box.h * 0.075);
      this.ui.drawWoodTable(ctx, box.x - bgPadX, box.y - bgPadY, box.w + bgPadX * 2, box.h + bgPadY * 2);

      if (isSelected) {
        ctx.strokeStyle = colors.primary;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 16;
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
        ctx.shadowBlur = 0;
      } else if (isHover) {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
      }

      const cx = box.x + box.w / 2;
      const unitTypes: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
      const spriteSlotW = box.w / 3;
      const spriteZoneH = box.h * 0.38;
      const spriteBaseY = box.y + 6 + spriteZoneH;
      for (let ui = 0; ui < unitTypes.length; ui++) {
        const spriteData = this.sprites.getUnitSprite(race.race, unitTypes[ui], 0);
        if (!spriteData) continue;
        const [img, def] = spriteData;
        const fitSize = Math.min(spriteSlotW * 0.9, spriteZoneH);
        const aspect = def.frameW / def.frameH;
        const hScale = def.heightScale ?? 1.0;
        const drawW = aspect >= 1 ? fitSize : fitSize * aspect;
        const drawH = (aspect >= 1 ? fitSize / aspect : fitSize) * hScale;
        const frame = isSelected ? Math.floor(this.tick / 6) % def.cols : 0;
        const slotCx = box.x + spriteSlotW * (ui + 0.5);
        const dx = Math.round(slotCx - drawW / 2);
        const dy = Math.round(spriteBaseY - drawH * (def.groundY ?? 0.71));
        drawSpriteFrame(ctx, img, def, frame, dx, dy, drawW, drawH);
      }

      const nameFontSize = fontSize * 1.5;
      const nameY = box.y + box.h * 0.50;
      ctx.textAlign = 'center';
      ctx.font = `bold ${nameFontSize}px monospace`;
      const nameColor = isSelected ? colors.primary : '#fff';
      woodText(ctx, race.label, cx, nameY, nameColor, 'rgba(0,0,0,0.7)');

      ctx.font = `${fontSize * 0.72}px monospace`;
      woodText(ctx, race.desc, cx, nameY + nameFontSize * 0.85, '#ddd', 'rgba(0,0,0,0.5)');

      const iconSize = fontSize * 1.8;
      const iconGap = iconSize * 0.5;
      const iconY = box.y + box.h * 0.70;
      const totalIconW = iconSize * 2 + iconGap;
      const iconStartX = cx - totalIconW / 2;
      for (let ri = 0; ri < 2; ri++) {
        const resData = this.sprites.getResourceSprite(race.econ[ri]);
        if (resData) {
          const [rImg] = resData;
          const ix = iconStartX + ri * (iconSize + iconGap);
          if (!isSelected) ctx.globalAlpha = 0.7;
          ctx.drawImage(rImg, ix, iconY, iconSize, iconSize);
          ctx.globalAlpha = 1;
        }
      }

      if (isSelected) {
        const selRibW = box.w * 0.65;
        const selRibH = fontSize * 1.3;
        const selRibX = cx - selRibW / 2;
        const selRibY = box.y + box.h * 0.90 - selRibH / 2;
        this.ui.drawSmallRibbon(ctx, selRibX, selRibY, selRibW, selRibH, 0);
        ctx.font = `bold ${fontSize * 0.6}px monospace`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('SELECTED', cx, selRibY + selRibH * 0.6);
      }

      ctx.restore();
    }

    const btnW = 260;
    const btnH = 56;
    const btnX = (w - btnW) / 2;
    const btnY = h - 72;
    this.ui.drawSword(ctx, btnX, btnY, btnW, btnH, 0);

    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    const textX = btnX + btnW * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('NEXT', textX + 1, btnY + btnH * 0.58 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText('NEXT', textX, btnY + btnH * 0.58);

    ctx.font = `${hintSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('ESC to go back', w / 2, h - 10);

    const settingsLayout = getSettingsOverlayLayout(w, h);
    drawSettingsButton(ctx, this.ui, settingsLayout.button, this.settingsOpen);
    if (this.settingsOpen) drawSettingsOverlay(ctx, this.ui, settingsLayout, this.audioSettings);
  }
}
