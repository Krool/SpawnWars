import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType, StatusType, StatusEffect, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, RACE_COLORS } from '../simulation/data';

// ─── Mini 1v1 simulation using real game stats ───

const ALL_RACES = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
const UNIT_TYPES: BuildingType[] = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
function categoryOf(bt: BuildingType): 'melee' | 'ranged' | 'caster' {
  if (bt === BuildingType.RangedSpawner) return 'ranged';
  if (bt === BuildingType.CasterSpawner) return 'caster';
  return 'melee';
}

const ARENA_WIDTH = 20;

interface DuelUnit {
  race: Race;
  category: 'melee' | 'ranged' | 'caster';
  name: string;
  x: number;
  hp: number;
  maxHp: number;
  damage: number;
  attackSpeed: number;
  attackTimer: number;
  moveSpeed: number;
  range: number;
  facingLeft: boolean;
  statusEffects: StatusEffect[];
  shieldHp: number;
  hitCount: number;
  alive: boolean;
  playerId: number;
  statusTickAcc: number;
  isAttacking: boolean;
  attackAnimTimer: number;
}

function createDuelUnit(race: Race, unitType: BuildingType, x: number, facingLeft: boolean, playerId: number): DuelUnit {
  const stats = UNIT_STATS[race][unitType]!;
  return {
    race, category: categoryOf(unitType), name: stats.name,
    x, hp: stats.hp, maxHp: stats.hp,
    damage: stats.damage, attackSpeed: stats.attackSpeed, attackTimer: stats.attackSpeed * 0.3,
    moveSpeed: stats.moveSpeed, range: stats.range,
    facingLeft, statusEffects: [], shieldHp: 0, hitCount: 0, alive: true,
    playerId, statusTickAcc: 0, isAttacking: false, attackAnimTimer: 0,
  };
}

function getEffectiveSpeed(unit: DuelUnit): number {
  let speed = unit.moveSpeed;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) speed *= Math.max(0.5, 1 - 0.1 * eff.stacks);
    if (eff.type === StatusType.Haste) speed *= 1.3;
  }
  return speed;
}

function applyStatus(target: DuelUnit, type: StatusType, stacks: number): void {
  const existing = target.statusEffects.find(e => e.type === type);
  const maxStacks = type === StatusType.Slow || type === StatusType.Burn ? 5 : 1;
  const duration = type === StatusType.Burn ? 3 * TICK_RATE :
                   type === StatusType.Slow ? 3 * TICK_RATE :
                   type === StatusType.Haste ? 3 * TICK_RATE :
                   5 * TICK_RATE;
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration;
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 20;
}

function dealDuelDamage(target: DuelUnit, amount: number): void {
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      target.statusEffects = target.statusEffects.filter(e => e.type !== StatusType.Shield);
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (target.hp <= 0) { target.hp = 0; target.alive = false; }
  }
}

function applyDuelOnHit(attacker: DuelUnit, target: DuelUnit): void {
  const isMelee = attacker.range <= 2;
  const isCaster = attacker.category === 'caster';
  switch (attacker.race) {
    case Race.Horde:
      if (isMelee) {
        attacker.hitCount++;
        if (attacker.hitCount % 3 === 0) {
          target.x += target.facingLeft ? -0.8 : 0.8;
          target.x = Math.max(0, Math.min(ARENA_WIDTH, target.x));
        }
      }
      break;
    case Race.Goblins:
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Oozlings:
      if (isMelee && Math.random() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      break;
    case Race.Demon:
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Deep:
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      if (!isMelee && !isCaster) applyStatus(target, StatusType.Slow, 2);
      break;
    case Race.Wild:
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Geists:
      if (isMelee) {
        applyStatus(target, StatusType.Burn, 1);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.15));
      }
      if (!isMelee && !isCaster) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.damage * 0.2));
      }
      break;
    case Race.Tenders:
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      break;
  }
}

function tickDuelStatusEffects(unit: DuelUnit, dtSec: number): void {
  unit.statusTickAcc += dtSec;
  const fullSecondTicks = Math.floor(unit.statusTickAcc);
  if (fullSecondTicks > 0) unit.statusTickAcc -= fullSecondTicks;

  for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
    const eff = unit.statusEffects[i];
    eff.duration -= dtSec * TICK_RATE;

    if (eff.type === StatusType.Burn && fullSecondTicks > 0) {
      const hasSlowCombo = unit.statusEffects.some(e => e.type === StatusType.Slow);
      const baseBurnDmg = 2 * eff.stacks * fullSecondTicks;
      const burnDmg = hasSlowCombo ? Math.round(baseBurnDmg * 1.5) : baseBurnDmg;
      dealDuelDamage(unit, burnDmg);
    }

    if (eff.type === StatusType.Shield && eff.duration <= 0) {
      unit.shieldHp = 0;
    }

    if (eff.duration <= 0) {
      unit.statusEffects.splice(i, 1);
    }
  }
}

function tickDuelCombat(attacker: DuelUnit, target: DuelUnit, dtSec: number): void {
  if (!attacker.alive || !target.alive) return;

  const dist = Math.abs(target.x - attacker.x);

  if (dist > attacker.range) {
    const speed = getEffectiveSpeed(attacker);
    const step = Math.min(speed * dtSec, dist - attacker.range);
    attacker.x += attacker.facingLeft ? -step : step;
  }

  attacker.attackTimer -= dtSec;
  if (attacker.attackTimer <= 0 && dist <= attacker.range + 0.5) {
    attacker.attackTimer += attacker.attackSpeed;
    if (attacker.category === 'caster') {
      if (attacker.race === Race.Crown) {
        applyStatus(attacker, StatusType.Shield, 1);
      } else if (attacker.race === Race.Oozlings) {
        applyStatus(attacker, StatusType.Haste, 1);
      } else if (attacker.race === Race.Tenders) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + 5);
      }
    }
    dealDuelDamage(target, attacker.damage);
    applyDuelOnHit(attacker, target);
    attacker.isAttacking = true;
    attacker.attackAnimTimer = 0.3;
  }
}

// ─── Minimal procedural sound effects for title screen ───

class TitleSfx {
  private actx: AudioContext | null = null;

  private ctx(): AudioContext {
    if (!this.actx) this.actx = new AudioContext();
    if (this.actx.state === 'suspended') this.actx.resume();
    return this.actx;
  }

  private note(freq: number, dur: number, gain: number, type: OscillatorType = 'square', delay = 0): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ac.currentTime + delay;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  private sweep(from: number, to: number, dur: number, gain: number, type: OscillatorType = 'square', delay = 0): void {
    const ac = this.ctx();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    const t0 = ac.currentTime + delay;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  playHit(): void {
    this.note(200, 0.05, 0.08, 'square');
    this.note(150, 0.03, 0.06, 'sawtooth', 0.02);
  }

  playKill(): void {
    this.sweep(280, 80, 0.12, 0.12, 'square');
  }

  playWin(): void {
    // Victorious ascending arpeggio
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.35 : 0.12;
      this.note(f, dur, 0.12, 'square', i * 0.12);
    });
  }

  playDraw(): void {
    // Descending minor
    this.note(392, 0.15, 0.1, 'square', 0);
    this.note(330, 0.15, 0.1, 'square', 0.15);
    this.note(262, 0.25, 0.1, 'square', 0.3);
  }

  playFightStart(): void {
    // Quick clash sound
    this.note(440, 0.06, 0.08, 'square', 0);
    this.note(554, 0.08, 0.1, 'square', 0.06);
  }
}

// ─── Title Scene ───

export class TitleScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private pulseTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  // Duel state
  private blue: DuelUnit | null = null;
  private red: DuelUnit | null = null;
  private waitTimer = 0;
  private waiting = true;
  private deathFade = 0;
  private deadUnit: DuelUnit | null = null;
  private winnerLeaving = false;
  private animTime = 0;

  // Win announcement
  private winText = '';
  private winColor = '#fff';
  private winTimer = 0; // seconds the announcement is visible
  private winScale = 0; // 0..1 pop-in animation

  // Sound
  private sfx = new TitleSfx();
  private userInteracted = false;
  private fightStartPlayed = false;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
  }

  enter(): void {
    this.pulseTime = 0;
    this.waiting = true;
    this.waitTimer = 0.5;
    this.blue = null;
    this.red = null;
    this.winText = '';
    this.winTimer = 0;
    this.userInteracted = false;

    const interactHandler = () => { this.userInteracted = true; };
    this.clickHandler = () => {
      interactHandler();
      this.manager.switchTo('raceSelect');
    };
    this.touchHandler = (e: TouchEvent) => {
      e.preventDefault();
      interactHandler();
      this.manager.switchTo('raceSelect');
    };
    // Also mark interacted on any mousedown (even if they don't click through)
    this.canvas.addEventListener('mousedown', interactHandler, { once: true });
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    this.clickHandler = null;
    this.touchHandler = null;
  }

  private spawnDuel(): void {
    const blueRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    const redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    const blueType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
    const redType = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];

    this.blue = createDuelUnit(blueRace, blueType, -2, false, 0);
    this.red = createDuelUnit(redRace, redType, ARENA_WIDTH + 2, true, 2);
    this.waiting = false;
    this.winnerLeaving = false;
    this.deadUnit = null;
    this.deathFade = 0;
    this.winText = '';
    this.winTimer = 0;
    this.winScale = 0;
    this.fightStartPlayed = false;
  }

  update(dt: number): void {
    this.pulseTime += dt;
    const dtSec = dt / 1000;
    this.animTime += dtSec;

    // Animate win announcement
    if (this.winTimer > 0) {
      this.winTimer -= dtSec;
      this.winScale = Math.min(1, this.winScale + dtSec * 5); // pop-in over 0.2s
    }

    if (this.waiting) {
      this.waitTimer -= dtSec;
      if (this.waitTimer <= 0) this.spawnDuel();
      return;
    }

    const blue = this.blue!;
    const red = this.red!;

    // Decay attack animation timers
    if (blue.attackAnimTimer > 0) {
      blue.attackAnimTimer -= dtSec;
      if (blue.attackAnimTimer <= 0) blue.isAttacking = false;
    }
    if (red.attackAnimTimer > 0) {
      red.attackAnimTimer -= dtSec;
      if (red.attackAnimTimer <= 0) red.isAttacking = false;
    }

    // Play fight start sound when units are close enough
    if (!this.fightStartPlayed && blue.alive && red.alive) {
      const dist = Math.abs(red.x - blue.x);
      if (dist <= Math.max(blue.range, red.range) + 1) {
        this.fightStartPlayed = true;
        if (this.userInteracted) this.sfx.playFightStart();
      }
    }

    if (this.winnerLeaving) {
      const winner = blue.alive ? blue : (red.alive ? red : null);
      if (winner) {
        const speed = getEffectiveSpeed(winner);
        winner.x += winner.facingLeft ? -speed * dtSec : speed * dtSec;
      }

      if (this.deathFade > 0) this.deathFade -= dtSec * 2;

      const done = !winner
        ? this.deathFade <= 0
        : (winner.x < -3 || winner.x > ARENA_WIDTH + 3);

      if (done) {
        this.waiting = true;
        this.waitTimer = 3;
        this.blue = null;
        this.red = null;
      }
      return;
    }

    // Both alive — run real combat simulation
    if (blue.alive && red.alive) {
      // Track HP before combat to detect hits
      const blueHpBefore = blue.hp;
      const redHpBefore = red.hp;

      tickDuelCombat(blue, red, dtSec);
      tickDuelCombat(red, blue, dtSec);
      tickDuelStatusEffects(blue, dtSec);
      tickDuelStatusEffects(red, dtSec);

      // Play hit sounds
      if (this.userInteracted) {
        if (red.hp < redHpBefore && red.alive) this.sfx.playHit();
        if (blue.hp < blueHpBefore && blue.alive) this.sfx.playHit();
      }

      // Check deaths
      if (!blue.alive || !red.alive) {
        if (!blue.alive && !red.alive) {
          this.winText = 'DRAW!';
          this.winColor = '#aaa';
          this.winTimer = 2.5;
          this.winScale = 0;
          this.deadUnit = blue;
          this.deathFade = 1;
          this.winnerLeaving = true;
          if (this.userInteracted) this.sfx.playDraw();
        } else {
          const winner = blue.alive ? blue : red;
          const loser = blue.alive ? red : blue;
          this.winText = `${winner.name} WINS!`;
          this.winColor = blue.alive ? '#4488ff' : '#ff4444';
          this.winTimer = 2.5;
          this.winScale = 0;
          this.deadUnit = loser;
          this.deathFade = 1;
          this.winnerLeaving = true;
          if (this.userInteracted) {
            this.sfx.playKill();
            this.sfx.playWin();
          }
        }
      }
    }
  }

  private tileToScreen(tileX: number, w: number): number {
    const margin = w * 0.08;
    const arenaW = w - margin * 2;
    return margin + (tileX / ARENA_WIDTH) * arenaW;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.imageSmoothingEnabled = false;

    // Clean background: sky gradient + solid grass ground
    const groundY = h * 0.82;

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(1, '#c4e4f0');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    // Ground: solid grass with subtle vertical gradient for depth
    const grassGrad = ctx.createLinearGradient(0, groundY, 0, h);
    grassGrad.addColorStop(0, '#5a9a3e');
    grassGrad.addColorStop(0.15, '#4a8c34');
    grassGrad.addColorStop(1, '#3d7a2c');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    // Grass edge highlight line
    ctx.fillStyle = '#6aad4a';
    ctx.fillRect(0, groundY, w, 2);

    // Draw units — feet anchored ON the ground line
    const unitSize = Math.max(48, Math.min(w / 6, 80));
    const unitBaseY = groundY;
    const frameTick = Math.floor(this.animTime * 7);

    // Draw dead unit (fading) first, then living
    if (this.deadUnit && this.deathFade > 0) {
      ctx.globalAlpha = Math.max(0, this.deathFade);
      this.drawDuelUnit(ctx, this.deadUnit, unitSize, unitBaseY, frameTick, w);
      ctx.globalAlpha = 1;
    }

    if (this.blue?.alive) this.drawDuelUnit(ctx, this.blue, unitSize, unitBaseY, frameTick, w);
    if (this.red?.alive) this.drawDuelUnit(ctx, this.red, unitSize, unitBaseY, frameTick, w);

    // Vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // === VS Banner ===
    if (this.blue && this.red) {
      const vsY = groundY + 4;
      const vsH = Math.max(28, Math.min(h * 0.06, 40));
      const vsW = Math.min(w * 0.85, 480);
      const vsX = (w - vsW) / 2;

      // Draw wood table background
      this.ui.drawWoodTable(ctx, vsX, vsY, vsW, vsH);

      const fontSize = Math.max(11, Math.min(vsH * 0.42, 16));
      ctx.textBaseline = 'middle';
      const centerY = vsY + vsH / 2;

      // Blue name (left side)
      const blueColor = RACE_COLORS[this.blue.race].primary;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(this.blue.name, w / 2 - fontSize * 1.2 + 1, centerY + 1);
      ctx.fillStyle = blueColor;
      ctx.fillText(this.blue.name, w / 2 - fontSize * 1.2, centerY);

      // VS in the center
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('VS', w / 2 + 1, centerY + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText('VS', w / 2, centerY);

      // Red name (right side)
      const redColor = RACE_COLORS[this.red.race].primary;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(this.red.name, w / 2 + fontSize * 1.2 + 1, centerY + 1);
      ctx.fillStyle = redColor;
      ctx.fillText(this.red.name, w / 2 + fontSize * 1.2, centerY);
    }

    // === Win announcement ===
    if (this.winTimer > 0 && this.winText) {
      const scale = 0.5 + 0.5 * Math.min(1, this.winScale); // pop from 50% to 100%
      const announceSize = Math.max(18, Math.min(w / 12, 36));

      ctx.save();
      ctx.translate(w / 2, groundY - unitSize * 1.3);
      ctx.scale(scale, scale);

      // Background pill
      ctx.font = `bold ${announceSize}px monospace`;
      const textW = ctx.measureText(this.winText).width;
      const pillW = textW + announceSize * 2;
      const pillH = announceSize * 1.8;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      const r = pillH / 2;
      ctx.moveTo(-pillW / 2 + r, -pillH / 2);
      ctx.lineTo(pillW / 2 - r, -pillH / 2);
      ctx.arc(pillW / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-pillW / 2 + r, pillH / 2);
      ctx.arc(-pillW / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
      ctx.fill();

      // Glow border
      ctx.strokeStyle = this.winColor;
      ctx.shadowColor = this.winColor;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(this.winText, 1, 1);
      ctx.fillStyle = this.winColor;
      ctx.fillText(this.winText, 0, 0);

      ctx.restore();
    }

    // === UI Elements ===

    // Title banner
    const bannerW = Math.min(w * 0.75, 550);
    const bannerH = Math.min(h * 0.18, 140);
    const bannerX = (w - bannerW) / 2;
    const bannerY = h * 0.04;
    this.ui.drawBanner(ctx, bannerX, bannerY, bannerW, bannerH);

    const titleSize = Math.max(20, Math.min(bannerW / 10, 44));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('SPAWN WARS', w / 2 + 2, bannerY + bannerH * 0.45 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('SPAWN WARS', w / 2, bannerY + bannerH * 0.45);

    // Subtitle
    const subW = Math.min(w * 0.45, 300);
    const subH = Math.min(h * 0.055, 40);
    const subX = (w - subW) / 2;
    const subY = bannerY + bannerH - subH * 0.2;
    this.ui.drawSmallRibbon(ctx, subX, subY, subW, subH, 0);
    ctx.font = `bold ${Math.max(10, subH * 0.38)}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('Build. Spawn. Conquer.', w / 2, subY + subH * 0.5);

    // Sword START button
    const swordW = Math.min(w * 0.5, 360);
    const swordH = Math.min(h * 0.09, 64);
    const swordX = (w - swordW) / 2;
    const swordY = h * 0.30;

    const alpha = 0.3 + 0.3 * Math.sin(this.pulseTime / 400);
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 16 * alpha;
    this.ui.drawSword(ctx, swordX, swordY, swordW, swordH, 0);
    ctx.shadowBlur = 0;

    const startSize = Math.max(13, Math.min(swordH * 0.32, 22));
    ctx.font = `bold ${startSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.pulseTime / 500);
    const textX = swordX + swordW * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText('TAP TO START', textX + 1, swordY + swordH * 0.5 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText('TAP TO START', textX, swordY + swordH * 0.5);
    ctx.globalAlpha = 1;

    // Version
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.max(10, Math.min(w / 60, 14))}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('v0.1.0 - dev build', w / 2, h - 12);
  }

  private drawDuelUnit(ctx: CanvasRenderingContext2D, unit: DuelUnit, size: number, baseY: number, frameTick: number, screenW: number): void {
    const attacking = unit.isAttacking;
    const spriteData = this.sprites.getUnitSprite(unit.race, unit.category, unit.playerId, attacking);
    if (!spriteData) return;

    const [img, def] = spriteData;
    const frame = frameTick % def.cols;
    const sx = this.tileToScreen(unit.x, screenW);
    const drawY = baseY - size;

    if (unit.facingLeft) {
      ctx.save();
      ctx.translate(sx, baseY - size / 2);
      ctx.scale(-1, 1);
      drawSpriteFrame(ctx, img, def, frame, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      drawSpriteFrame(ctx, img, def, frame, sx - size / 2, drawY, size, size);
    }

    // HP bar
    if (unit.hp < unit.maxHp || unit.statusEffects.length > 0) {
      const barW = size * 0.7;
      const barH = 5;
      const barX = sx - barW / 2;
      const barY = drawY - 10;
      const hpPct = Math.max(0, unit.hp / unit.maxHp);

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      if (unit.shieldHp > 0) {
        const shieldPct = Math.min(1, unit.shieldHp / 20);
        ctx.fillStyle = 'rgba(100,181,246,0.7)';
        ctx.fillRect(barX, barY, barW * shieldPct, barH);
      }
    }

    // Status effect indicators
    const dotY = drawY - 2;
    let dotX = sx - (unit.statusEffects.length - 1) * 4;
    for (const eff of unit.statusEffects) {
      let color = '#fff';
      if (eff.type === StatusType.Burn) color = '#ff4400';
      else if (eff.type === StatusType.Slow) color = '#2979ff';
      else if (eff.type === StatusType.Haste) color = '#00e676';
      else if (eff.type === StatusType.Shield) color = '#64b5f6';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fill();
      dotX += 8;
    }
  }
}
