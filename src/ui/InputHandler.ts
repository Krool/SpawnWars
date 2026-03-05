import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, BUILD_GRID_COLS, BUILD_GRID_ROWS, TOWER_ALLEY_COLS, TOWER_ALLEY_ROWS, Lane,
  HarvesterAssignment,
} from '../simulation/types';
import { getBuildGridOrigin, getTowerAlleyOrigin } from '../simulation/GameState';
import { BUILDING_COSTS, HARVESTER_HUT_COST } from '../simulation/data';

interface BuildTrayItem {
  type: BuildingType;
  label: string;
  key: string;
}

const BUILD_TRAY: BuildTrayItem[] = [
  { type: BuildingType.MeleeSpawner, label: 'Melee', key: '1' },
  { type: BuildingType.RangedSpawner, label: 'Ranged', key: '2' },
  { type: BuildingType.CasterSpawner, label: 'Caster', key: '3' },
  { type: BuildingType.Tower, label: 'Tower', key: '4' },
];

const ASSIGNMENT_CYCLE: HarvesterAssignment[] = [
  HarvesterAssignment.BaseGold,
  HarvesterAssignment.Wood,
  HarvesterAssignment.Stone,
  HarvesterAssignment.Center,
];

const ASSIGNMENT_LABELS: Record<HarvesterAssignment, string> = {
  [HarvesterAssignment.BaseGold]: '★ Gold',
  [HarvesterAssignment.Wood]: '♣ Wood',
  [HarvesterAssignment.Stone]: '▪ Stone',
  [HarvesterAssignment.Center]: '◆ Center',
};


export class InputHandler {
  private game: Game;
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private selectedBuilding: BuildingType | null = null;
  private hoveredGridSlot: { gx: number; gy: number; isAlley: boolean } | null = null;
  private nukeTargeting = false;
  private tooltip: { text: string; x: number; y: number } | null = null;
  private showTutorial = true;

  constructor(game: Game, canvas: HTMLCanvasElement, camera: Camera) {
    this.game = game;
    this.canvas = canvas;
    this.camera = camera;
    this.setupKeyboard();
    this.setupMouse();
  }

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Nuke mode
      if (e.key === 'n' || e.key === 'N') {
        if (this.game.state.players[0]?.nukeAvailable) {
          this.nukeTargeting = !this.nukeTargeting;
          this.selectedBuilding = null;
        }
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        this.game.sendCommand({ type: 'build_hut', playerId: 0 });
        return;
      }

      const item = BUILD_TRAY.find(b => b.key === e.key);
      if (item) {
        this.nukeTargeting = false;
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
        return;
      }
      if (e.key === 'Escape') {
        if (this.showTutorial) { this.showTutorial = false; return; }
        this.selectedBuilding = null;
        this.nukeTargeting = false;
      }
      if (e.key === 'l' || e.key === 'L') {
        const myBuildings = this.game.state.buildings.filter(b => b.playerId === 0);
        const currentLane = myBuildings.length > 0 ? myBuildings[0].lane : Lane.Left;
        this.game.sendCommand({ type: 'toggle_all_lanes', playerId: 0, lane: currentLane === Lane.Left ? Lane.Right : Lane.Left });
      }
    });
  }

  private setupMouse(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      this.tooltip = null;
      if (this.selectedBuilding !== null) {
        const world = this.camera.screenToWorld(e.clientX, e.clientY);
        this.hoveredGridSlot = this.worldToGridSlot(0, world.x, world.y);
      } else {
        this.hoveredGridSlot = null;
        // Check for building hover tooltip
        const world = this.camera.screenToWorld(e.clientX, e.clientY);
        const tileX = Math.floor(world.x / TILE_SIZE);
        const tileY = Math.floor(world.y / TILE_SIZE);
        const building = this.game.state.buildings.find(b =>
          b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
        );
        if (building) {
          let tip = `${building.type} HP:${building.hp}/${building.maxHp}`;
          if (building.type === BuildingType.HarvesterHut) {
            const h = this.game.state.harvesters.find(h => h.hutId === building.id);
            if (h) tip += ` [${ASSIGNMENT_LABELS[h.assignment]}]`;
          } else if (building.type !== BuildingType.Tower) {
            tip += ` Lane:${building.lane}`;
          }
          this.tooltip = { text: tip, x: e.clientX, y: e.clientY - 20 };
        }
      }
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.showTutorial) { this.showTutorial = false; return; }
      // UI panels consume click first
      if (this.handleUIClick(e)) return;

      // Nuke targeting
      if (this.nukeTargeting) {
        const world = this.camera.screenToWorld(e.clientX, e.clientY);
        this.game.sendCommand({
          type: 'fire_nuke', playerId: 0,
          x: world.x / TILE_SIZE, y: world.y / TILE_SIZE,
        });
        this.nukeTargeting = false;
        return;
      }

      if (this.selectedBuilding === null) {
        this.handleBuildingClick(e);
        return;
      }
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const slot = this.worldToGridSlot(0, world.x, world.y);
      if (slot) {
        this.game.sendCommand({
          type: 'place_building', playerId: 0,
          buildingType: this.selectedBuilding, gridX: slot.gx, gridY: slot.gy,
          ...(slot.isAlley ? { gridType: 'alley' as const } : {}),
        });
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // If building mode, just deselect
      if (this.selectedBuilding !== null || this.nukeTargeting) {
        this.selectedBuilding = null;
        this.nukeTargeting = false;
        return;
      }

      // Right-click on own building to sell
      const world = this.camera.screenToWorld(e.clientX, e.clientY);
      const tileX = Math.floor(world.x / TILE_SIZE);
      const tileY = Math.floor(world.y / TILE_SIZE);
      const building = this.game.state.buildings.find(b =>
        b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
      );
      if (building) {
        this.game.sendCommand({ type: 'sell_building', playerId: 0, buildingId: building.id });
      }
    });
  }

  private worldToGridSlot(playerId: number, worldPixelX: number, worldPixelY: number): { gx: number; gy: number; isAlley: boolean } | null {
    const tx = Math.floor(worldPixelX / TILE_SIZE);
    const ty = Math.floor(worldPixelY / TILE_SIZE);

    // Check tower alley first (only for Tower type)
    if (this.selectedBuilding === BuildingType.Tower) {
      const alley = getTowerAlleyOrigin(playerId);
      const agx = tx - alley.x, agy = ty - alley.y;
      if (agx >= 0 && agx < TOWER_ALLEY_COLS && agy >= 0 && agy < TOWER_ALLEY_ROWS) {
        return { gx: agx, gy: agy, isAlley: true };
      }
    }

    // Military grid
    const origin = getBuildGridOrigin(playerId);
    const gx = tx - origin.x, gy = ty - origin.y;
    if (gx < 0 || gx >= BUILD_GRID_COLS || gy < 0 || gy >= BUILD_GRID_ROWS) return null;
    return { gx, gy, isAlley: false };
  }

  private handleBuildingClick(e: MouseEvent): void {
    const world = this.camera.screenToWorld(e.clientX, e.clientY);
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    const building = this.game.state.buildings.find(b =>
      b.playerId === 0 && b.worldX === tileX && b.worldY === tileY
    );
    if (!building) return;

    // Click on hut: cycle harvester assignment
    if (building.type === BuildingType.HarvesterHut) {
      const h = this.game.state.harvesters.find(h => h.hutId === building.id);
      if (h) {
        const curIdx = ASSIGNMENT_CYCLE.indexOf(h.assignment);
        const nextAssignment = ASSIGNMENT_CYCLE[(curIdx + 1) % ASSIGNMENT_CYCLE.length];
        this.game.sendCommand({
          type: 'set_hut_assignment', playerId: 0,
          hutId: building.id, assignment: nextAssignment,
        });
      }
      return;
    }

    // Click on spawner: toggle lane
    if (building.type !== BuildingType.Tower) {
      this.game.sendCommand({
        type: 'toggle_lane', playerId: 0, buildingId: building.id,
        lane: building.lane === Lane.Left ? Lane.Right : Lane.Left,
      });
    }
  }

  private drawTutorial(ctx: CanvasRenderingContext2D): void {
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillRect(0, 0, W, H);

    const pw = Math.min(W - 32, 620);
    const ph = Math.min(H - 80, 660);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    // Panel background
    ctx.fillStyle = 'rgba(10, 12, 18, 0.97)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2979ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    const lp = px + 20;  // left padding
    const rp = px + pw - 20;
    let y = py + 30;
    const lh = 22; // line height

    const heading = (text: string, color = '#2979ff') => {
      ctx.fillStyle = color;
      ctx.font = 'bold 17px monospace';
      ctx.fillText(text, lp, y);
      y += lh + 4;
    };
    const line = (text: string, color = '#aaa') => {
      ctx.fillStyle = color;
      ctx.font = '14px monospace';
      ctx.fillText(text, lp, y);
      y += lh;
    };
    const rule = () => {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lp, y - 4); ctx.lineTo(rp, y - 4); ctx.stroke();
      y += 6;
    };

    heading('ASCII WARS', '#fff');
    line('2v2 real-time strategy. Destroy the enemy HQ or deliver', '#ccc');
    line('the Diamond to your base to win instantly.', '#ccc');
    y += 6; rule();

    heading('THE MAP');
    line('Your base is at the bottom. Enemy base is at the top.');
    line('Lanes converge at the neck, fork around the Diamond,');
    line('then converge again — armies clash head-on.');
    line('★ Gold mine near HQ  ♣ Wood at left tip  ▪ Stone at right tip');
    y += 4; rule();

    heading('BUILDINGS  (click grid to place, right-click to sell)');
    line('[1] Melee Spawner — durable fighters, spawns every 10s', '#eee');
    line('[2] Ranged Spawner — archers, costs Wood', '#eee');
    line('[3] Caster Spawner — magic AoE, costs Wood + Stone', '#eee');
    line('[4] Tower — defence turret; also place in territory alley', '#eee');
    line('[M] Miner — harvester worker; auto-places in hut zone', '#c5e1a5');
    y += 4; rule();

    heading('COMBAT & LANES');
    line('Click a spawner to toggle its lane: Left or Right.');
    line('[L] — flip all your buildings to the opposite lane.');
    line('Units fight when they meet enemies. Last team standing wins.');
    y += 4; rule();

    heading('DIAMOND  ◆');
    line('Mine the gold cells around it to expose the Diamond.');
    line('Miners then fight to carry it back to your HQ.');
    y += 4; rule();

    heading('HOTKEYS', '#ff9800');
    line('[M] Miner   [1-4] Buildings   [N] Fire Nuke   [L] Toggle Lanes');
    line('[WASD / drag] Pan   [Scroll] Zoom   [R-Click] Cancel / Sell');

    // X close button in top-right corner of panel
    const btnSize = 32;
    const btnX = px + pw - btnSize - 8;
    const btnY2 = py + 8;
    ctx.fillStyle = 'rgba(41,121,255,0.15)';
    ctx.fillRect(btnX, btnY2, btnSize, btnSize);
    ctx.strokeStyle = '#2979ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(btnX, btnY2, btnSize, btnSize);
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('✕', btnX + btnSize / 2, btnY2 + 22);
    ctx.textAlign = 'start';
  }

  private getTrayLayout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const milH = 68;
    const milY = H - milH;
    // Miner button + 4 military + nuke = 6 buttons total
    const milW = W / 6;
    return { W, H, milH, milY, milW };
  }

  // Returns true if click was consumed by a UI panel
  private handleUIClick(e: MouseEvent): boolean {
    const { milH, milY, milW } = this.getTrayLayout();
    const cx = e.clientX;
    const cy = e.clientY;
    const player = this.game.state.players[0];

    if (cy >= milY && cy < milY + milH) {
      const colIdx = Math.floor(cx / milW);
      if (colIdx === 0) {
        // Miner button
        this.game.sendCommand({ type: 'build_hut', playerId: 0 });
      } else if (colIdx >= 1 && colIdx <= BUILD_TRAY.length) {
        const item = BUILD_TRAY[colIdx - 1];
        this.nukeTargeting = false;
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
      } else if (colIdx === BUILD_TRAY.length + 1) {
        if (player.nukeAvailable) {
          this.selectedBuilding = null;
          this.nukeTargeting = !this.nukeTargeting;
        }
      }
      return true;
    }

    return false;
  }

  render(renderer: Renderer): void {
    const ctx = renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBuildTray(ctx);

    if (this.showTutorial) {
      this.drawTutorial(ctx);
      return; // don't draw other overlays while tutorial is open
    }

    if (this.selectedBuilding !== null && this.hoveredGridSlot) {
      this.drawPlacementPreview(ctx, renderer);
    }

    if (this.nukeTargeting) {
      this.drawNukeOverlay(ctx);
    }

    if (this.tooltip) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.font = '14px monospace';
      const w = ctx.measureText(this.tooltip.text).width + 16;
      ctx.fillRect(this.tooltip.x - w / 2, this.tooltip.y - 18, w, 24);
      ctx.fillStyle = '#ddd';
      ctx.textAlign = 'center';
      ctx.fillText(this.tooltip.text, this.tooltip.x, this.tooltip.y);
      ctx.textAlign = 'start';
    }
  }

  private drawBuildTray(ctx: CanvasRenderingContext2D): void {
    const { W, milH, milY, milW } = this.getTrayLayout();
    const player = this.game.state.players[0];

    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, milY, W, milH);

    // ── Miner button (col 0, earthy green-brown) ──────────────────────
    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === 0 && b.type === BuildingType.HarvesterHut
    );
    const hutCost = HARVESTER_HUT_COST(myHuts.length);
    const canAffordHut = player.gold >= hutCost && myHuts.length < 10;
    const mx = 0;
    ctx.fillStyle = 'rgba(40, 55, 20, 0.9)';
    ctx.fillRect(mx + 1, milY + 1, milW - 2, milH - 2);
    ctx.strokeStyle = canAffordHut ? '#8bc34a' : '#3a4a1a';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 1, milY + 1, milW - 2, milH - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = canAffordHut ? '#c5e1a5' : '#555';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('Miner', mx + milW / 2, milY + 22);
    ctx.fillStyle = canAffordHut ? '#ffd700' : '#553300';
    ctx.font = '13px monospace';
    ctx.fillText(myHuts.length < 10 ? `${hutCost}g` : 'MAX', mx + milW / 2, milY + 40);
    ctx.fillStyle = '#4a5a2a';
    ctx.font = '12px monospace';
    ctx.fillText('[M]', mx + milW / 2, milY + 56);

    // ── Military buttons (cols 1–4) ───────────────────────────────────
    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = (i + 1) * milW;
      const isSelected = this.selectedBuilding === item.type;
      const cost = BUILDING_COSTS[item.type];
      const canAfford = player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone;

      ctx.fillStyle = isSelected ? 'rgba(41, 121, 255, 0.28)' : 'rgba(28, 28, 28, 0.9)';
      ctx.fillRect(bx + 1, milY + 1, milW - 2, milH - 2);
      ctx.strokeStyle = isSelected ? '#2979ff' : (canAfford ? '#555' : '#333');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx + 1, milY + 1, milW - 2, milH - 2);

      ctx.textAlign = 'center';
      ctx.fillStyle = canAfford ? '#eee' : '#555';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(item.label, bx + milW / 2, milY + 22);

      let costStr = `${cost.gold}g`;
      if (cost.wood > 0) costStr += ` ${cost.wood}w`;
      if (cost.stone > 0) costStr += ` ${cost.stone}s`;
      ctx.fillStyle = canAfford ? '#ffd700' : '#553300';
      ctx.font = '13px monospace';
      ctx.fillText(costStr, bx + milW / 2, milY + 40);

      ctx.fillStyle = '#555';
      ctx.font = '12px monospace';
      ctx.fillText(`[${item.key}]`, bx + milW / 2, milY + 56);
    }

    // ── Nuke button (col 5) ───────────────────────────────────────────
    const nukeAvail = player.nukeAvailable;
    const nukeX = (BUILD_TRAY.length + 1) * milW;
    ctx.fillStyle = this.nukeTargeting ? 'rgba(255, 50, 0, 0.35)' : 'rgba(28, 28, 28, 0.9)';
    ctx.fillRect(nukeX + 1, milY + 1, milW - 2, milH - 2);
    ctx.strokeStyle = this.nukeTargeting ? '#ff5722' : (nukeAvail ? '#ff5722' : '#333');
    ctx.lineWidth = this.nukeTargeting ? 2 : 1;
    ctx.strokeRect(nukeX + 1, milY + 1, milW - 2, milH - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = nukeAvail ? '#ff5722' : '#555';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('NUKE', nukeX + milW / 2, milY + 26);
    ctx.fillStyle = '#555';
    ctx.font = '12px monospace';
    ctx.fillText('[N]', nukeX + milW / 2, milY + 50);

    ctx.textAlign = 'start';
  }

  private drawPlacementPreview(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    if (!this.hoveredGridSlot) return;
    const slot = this.hoveredGridSlot;

    const origin = slot.isAlley ? getTowerAlleyOrigin(0) : getBuildGridOrigin(0);
    const worldX = (origin.x + slot.gx) * TILE_SIZE;
    const worldY = (origin.y + slot.gy) * TILE_SIZE;

    const grid = slot.isAlley ? 'alley' : 'military';
    const occupied = this.game.state.buildings.some(
      b => b.playerId === 0 && b.buildGrid === grid && b.gridX === slot.gx && b.gridY === slot.gy
    );

    renderer.camera.applyTransform(ctx);

    ctx.fillStyle = occupied ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(worldX, worldY, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = occupied ? '#f44336' : '#4caf50';
    ctx.lineWidth = 2;
    ctx.strokeRect(worldX, worldY, TILE_SIZE, TILE_SIZE);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawNukeOverlay(ctx: CanvasRenderingContext2D): void {
    // Red-tinted screen overlay
    ctx.fillStyle = 'rgba(255, 0, 0, 0.05)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Instruction text
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK TO FIRE NUKE  [ESC to cancel]', this.canvas.width / 2, 60);
    ctx.textAlign = 'start';
  }
}
