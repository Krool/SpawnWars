import { Scene, SceneManager } from './Scene';
import { GameState, Team, PlayerStats } from '../simulation/types';
import { PLAYER_COLORS, RACE_COLORS } from '../simulation/data';
import { UIAssets } from '../rendering/UIAssets';

export interface MatchStats {
  state: GameState;
  localPlayerId: number;
  /** Per-slot display names (human players). */
  slotNames?: { [slot: string]: string };
  /** Per-slot bot difficulty (absent = human). */
  slotBotDifficulties?: { [slot: string]: string };
}

export class PostMatchScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private stats: MatchStats | null = null;
  private animTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
  }

  setStats(stats: MatchStats): void {
    this.stats = stats;
  }

  enter(): void {
    this.animTime = 0;

    this.clickHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo('raceSelect');
    };

    this.keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        this.manager.switchTo('raceSelect');
      }
    };

    this.touchHandler = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      if (this.isButtonAt(cx, cy)) this.manager.switchTo('raceSelect');
    };

    this.canvas.addEventListener('click', this.clickHandler);
    window.addEventListener('keydown', this.keyHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.clickHandler = null;
    this.keyHandler = null;
    this.touchHandler = null;
  }

  private getButtonRect(): { x: number; y: number; w: number; h: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = 260;
    const btnH = 56;
    return { x: (w - btnW) / 2, y: h * 0.90, w: btnW, h: btnH };
  }

  private isButtonAt(cx: number, cy: number): boolean {
    const b = this.getButtonRect();
    const pad = 8;
    return cx >= b.x - pad && cx <= b.x + b.w + pad && cy >= b.y - pad && cy <= b.y + b.h + pad;
  }

  update(dt: number): void {
    this.animTime += dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    // Water background
    if (!this.ui.drawWaterBg(ctx, w, h, this.animTime)) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);

    if (!this.stats) {
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#888';
      ctx.fillText('No match data', w / 2, h / 2);
      return;
    }

    const { state, localPlayerId } = this.stats;
    const localTeam = state.players[localPlayerId].team;
    const won = state.winner === localTeam;
    const fontSize = Math.max(14, Math.min(w / 28, 24));

    // VICTORY / DEFEAT banner
    const headerBannerW = Math.min(w * 0.75, 540);
    const headerBannerH = Math.min(90, h * 0.1);
    const headerBannerX = (w - headerBannerW) / 2;
    const headerBannerY = h * 0.02;
    this.ui.drawBigRibbon(ctx, headerBannerX, headerBannerY, headerBannerW, headerBannerH, won ? 0 : 1);

    ctx.font = `bold ${fontSize * 2.2}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(won ? 'VICTORY' : 'DEFEAT', w / 2, headerBannerY + headerBannerH * 0.62);

    // Win condition + match time
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#ddd';
    const condText = state.winCondition === 'military' ? 'HQ Destroyed'
      : state.winCondition === 'diamond' ? 'Diamond Delivered'
      : state.winCondition === 'timeout' ? 'Time Expired' : '';
    const totalSec = Math.floor(state.tick / 20);
    ctx.fillText(`${condText}  -  ${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`, w / 2, headerBannerY + headerBannerH + 24);

    // Stats table panel - Banner 9-slice with generous padding
    const panelW = Math.min(w * 0.94, 1060);
    const panelH = h * 0.82;
    const panelX = (w - panelW) / 2;
    const panelY = headerBannerY + headerBannerH + 38;
    const bgPadX = Math.round(panelW * 0.05);
    const bgPadY = Math.round(panelH * 0.05);
    this.ui.drawBanner(ctx, panelX - bgPadX, panelY - bgPadY, panelW + bgPadX * 2, panelH + bgPadY * 2);

    // Inner content area (inset from Banner 9-slice borders)
    const pad = panelW * 0.06;
    const innerL = panelX + pad;
    const innerR = panelX + panelW - pad;
    const innerW = innerR - innerL;

    // Player stats table
    const tableFontSize = fontSize * 0.7;
    const tableY = panelY + 48;
    const rowH = tableFontSize * 2.4;
    // Columns positioned relative to inner area
    const colX = [
      innerL,                    // PLAYER (left-aligned)
      innerL + innerW * 0.32,   // gold
      innerL + innerW * 0.44,   // wood
      innerL + innerW * 0.55,   // stone
      innerL + innerW * 0.66,   // spawned
      innerL + innerW * 0.78,   // killed
      innerL + innerW * 0.92,   // damage
    ];

    // Header row with icons
    ctx.font = `bold ${tableFontSize * 0.85}px monospace`;
    ctx.fillStyle = '#3e2c1a';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', colX[0], tableY);
    ctx.textAlign = 'right';
    const hdrIconSz = tableFontSize * 1.05;
    this.ui.drawIcon(ctx, 'gold', colX[1] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'wood', colX[2] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'meat', colX[3] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    this.ui.drawIcon(ctx, 'sword', colX[4] - hdrIconSz, tableY - hdrIconSz + 2, hdrIconSz);
    ctx.fillStyle = '#3e2c1a';
    ctx.fillText('KILLED', colX[5], tableY);
    ctx.fillText('DMG', colX[6], tableY);

    // Header separator line
    ctx.strokeStyle = 'rgba(62,44,26,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerL, tableY + 8);
    ctx.lineTo(innerR, tableY + 8);
    ctx.stroke();

    const pStats = state.playerStats ?? [];
    let rowIdx = 0;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (p.isEmpty) continue;
      const ps = pStats[i];
      rowIdx++;
      const y = tableY + rowIdx * rowH;
      const rowTop = y - rowH * 0.65;

      // Alternating row backgrounds
      if (rowIdx % 2 === 0) {
        ctx.fillStyle = 'rgba(62,44,26,0.08)';
        ctx.fillRect(innerL, rowTop, innerW, rowH);
      }
      // Highlight local player row
      if (i === localPlayerId) {
        ctx.fillStyle = 'rgba(41,121,255,0.15)';
        ctx.fillRect(innerL, rowTop, innerW, rowH);
      }

      const isBot = !!this.stats?.slotBotDifficulties?.[String(i)];
      const raceColor = RACE_COLORS[p.race]?.primary ?? '#888';
      const iconSz = tableFontSize * 1.0;
      let textX = colX[0];

      // Bot indicator icon (gear)
      if (isBot) {
        this.ui.drawIcon(ctx, 'settings', textX, y - iconSz + 2, iconSz);
        textX += iconSz + 2;
      }

      // Race color dot
      ctx.fillStyle = raceColor;
      const dotR = tableFontSize * 0.32;
      ctx.beginPath();
      ctx.arc(textX + dotR, y - dotR + 1, dotR, 0, Math.PI * 2);
      ctx.fill();
      textX += dotR * 2 + 4;

      // Player name — truncate to fit column
      const label = this.slotLabel(i);
      const raceStr = p.race.charAt(0).toUpperCase() + p.race.slice(1);
      const fullText = `${label} ${raceStr}`;
      ctx.font = `bold ${tableFontSize}px monospace`;
      const maxTextW = colX[1] - textX - hdrIconSz - 4;
      const truncated = this.truncateText(ctx, fullText, maxTextW);
      ctx.textAlign = 'left';
      const pc = PLAYER_COLORS[i];
      ctx.fillStyle = this.darkenColor(pc, 0.6);
      ctx.fillText(truncated, textX, y);

      ctx.font = `${tableFontSize}px monospace`;
      ctx.fillStyle = '#2a1e10';
      ctx.textAlign = 'right';
      ctx.fillText(`${ps?.totalGoldEarned ?? 0}`, colX[1], y);
      ctx.fillText(`${ps?.totalWoodEarned ?? 0}`, colX[2], y);
      ctx.fillText(`${ps?.totalStoneEarned ?? 0}`, colX[3], y);
      ctx.fillText(`${ps?.unitsSpawned ?? 0}`, colX[4], y);
      ctx.fillText(`${ps?.unitsLost ?? 0}`, colX[5], y);
      ctx.font = `bold ${tableFontSize}px monospace`;
      ctx.fillText(`${ps?.totalDamageDealt ?? 0}`, colX[6], y);
    }

    // HQ HP with bar sprites
    const hqY = tableY + (rowIdx + 1.5) * rowH;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3e2c1a';
    ctx.fillText('HQ Health', w / 2, hqY);

    const barW = Math.min(140, panelW * 0.18);
    const barH = 18;
    const barGap = 30;
    const ourHp = state.hqHp[localTeam];
    const enemyTeam = localTeam === Team.Bottom ? Team.Top : Team.Bottom;
    const enemyHp = state.hqHp[enemyTeam];
    this.ui.drawBar(ctx, w / 2 - barW - barGap, hqY + 8, barW, barH, ourHp / 1000);
    ctx.fillStyle = '#1a4a8a';
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.fillText(`US ${ourHp}`, w / 2 - barW / 2 - barGap, hqY + 34);
    this.ui.drawBar(ctx, w / 2 + barGap, hqY + 8, barW, barH, enemyHp / 1000);
    ctx.fillStyle = '#a01020';
    ctx.fillText(`ENEMY ${enemyHp}`, w / 2 + barW / 2 + barGap, hqY + 34);

    // Awards
    const awards = this.computeAwards(pStats);
    const awardY = hqY + rowH * 2.2;
    const awardRibW = Math.min(340, panelW * 0.55);
    const awardRibH = fontSize * 1.6;
    this.ui.drawSmallRibbon(ctx, (w - awardRibW) / 2, awardY - awardRibH * 0.7, awardRibW, awardRibH, 2);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#3e2c1a';
    ctx.fillText('AWARDS', w / 2, awardY);
    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    for (let i = 0; i < awards.length; i++) {
      const a = awards[i];
      ctx.fillStyle = this.darkenColor(PLAYER_COLORS[a.playerId], 0.6);
      ctx.fillText(`${a.label}: ${this.slotLabel(a.playerId)} (${a.value})`, w / 2, awardY + (i + 1) * rowH * 0.8);
    }

    // War Hero
    const heroY = awardY + (awards.length + 1.5) * rowH * 0.8;
    this.drawWarHero(ctx, state, w, heroY, fontSize);

    // Continue button - Sword
    const btn = this.getButtonRect();
    const rv = UIAssets.swordReveal(this.animTime, 0);
    const ox = this.ui.drawSword(ctx, btn.x, btn.y, btn.w, btn.h, 0, rv);
    if (rv > 0) {
      ctx.font = `bold ${Math.max(20, fontSize)}px monospace`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = rv;
      const btnTextX = btn.x + btn.w * 0.52 + ox;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('CONTINUE', btnTextX + 1, btn.y + btn.h * 0.58 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('CONTINUE', btnTextX, btn.y + btn.h * 0.58);
      ctx.globalAlpha = 1;
    }
  }

  private drawWarHero(ctx: CanvasRenderingContext2D, state: GameState, w: number, y: number, fontSize: number): void {
    const heroes = state.warHeroes;
    if (heroes.length === 0) return;

    const hero = heroes[0];
    const playerColor = PLAYER_COLORS[hero.playerId];
    const raceColor = RACE_COLORS[state.players[hero.playerId]?.race]?.primary ?? '#fff';

    // Shield icon + title
    this.ui.drawIcon(ctx, 'shield', w / 2 - fontSize * 0.5, y - fontSize * 0.8, fontSize * 1.0);
    ctx.font = `bold ${fontSize * 0.85}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3e2c1a';
    ctx.fillText('WAR HERO', w / 2, y + fontSize * 0.5);

    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = this.darkenColor(raceColor, 0.55);
    ctx.fillText(`${hero.name}`, w / 2, y + fontSize * 1.6);

    ctx.font = `bold ${fontSize * 0.8}px monospace`;
    ctx.fillStyle = this.darkenColor(playerColor, 0.6);
    const categoryIcon = hero.category === 'melee' ? 'Melee' : hero.category === 'ranged' ? 'Ranged' : 'Caster';
    ctx.fillText(`${this.slotLabel(hero.playerId)}'s ${categoryIcon}  -  ${hero.kills} kills`, w / 2, y + fontSize * 2.8);

    ctx.font = `bold ${fontSize * 0.75}px monospace`;
    if (hero.survived) {
      ctx.fillStyle = '#1b6e24';
      ctx.fillText('Survived the battle', w / 2, y + fontSize * 3.8);
    } else {
      ctx.fillStyle = '#9a1a1a';
      ctx.fillText(`Slain by ${hero.killedByName}`, w / 2, y + fontSize * 3.8);
    }
  }

  /** Get display name for a slot: player name, bot difficulty, or fallback P{n}. */
  private slotLabel(slotId: number): string {
    const name = this.stats?.slotNames?.[String(slotId)];
    if (name) return name;
    const diff = this.stats?.slotBotDifficulties?.[String(slotId)];
    if (diff) return `Bot ${diff.charAt(0).toUpperCase() + diff.slice(1)}`;
    return `P${slotId + 1}`;
  }

  /** Truncate text to fit within maxWidth, adding ellipsis if needed. */
  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /** Darken a hex color by multiplying RGB channels by factor (0–1). */
  private darkenColor(hex: string, factor: number): string {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    const r = Math.round(parseInt(m[1], 16) * factor);
    const g = Math.round(parseInt(m[2], 16) * factor);
    const b = Math.round(parseInt(m[3], 16) * factor);
    return `rgb(${r},${g},${b})`;
  }

  private computeAwards(stats: PlayerStats[]): { label: string; playerId: number; value: string }[] {
    if (stats.length === 0) return [];
    const awards: { label: string; playerId: number; value: string }[] = [];

    const best = (fn: (ps: PlayerStats) => number, label: string, fmt: (v: number) => string) => {
      let bestIdx = 0;
      let bestVal = fn(stats[0]);
      for (let i = 1; i < stats.length; i++) {
        const v = fn(stats[i]);
        if (v > bestVal) { bestVal = v; bestIdx = i; }
      }
      if (bestVal > 0) awards.push({ label, playerId: bestIdx, value: fmt(bestVal) });
    };

    best(ps => ps.totalDamageDealt, 'MVP Damage', v => `${v} dmg`);
    best(ps => ps.totalGoldEarned + ps.totalWoodEarned + ps.totalStoneEarned, 'Best Economy', v => `${v} resources`);
    best(ps => ps.totalDamageNearHQ, 'Best Defender', v => `${v} dmg near HQ`);

    return awards;
  }
}
