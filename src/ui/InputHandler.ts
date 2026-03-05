import { Game } from '../game/Game';
import { Camera } from '../rendering/Camera';
import { Renderer } from '../rendering/Renderer';
import {
  BuildingType, TILE_SIZE, BUILD_GRID_COLS, BUILD_GRID_ROWS, Lane,
  HarvesterAssignment,
} from '../simulation/types';
import { getBuildGridOrigin } from '../simulation/GameState';
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

// Hut slots fill from center outward in a 10-slot row
const CENTER_OUT_ORDER = [4, 5, 3, 6, 2, 7, 1, 8, 0, 9];

const ASSIGNMENT_CYCLE: HarvesterAssignment[] = [
  HarvesterAssignment.BaseGold,
  HarvesterAssignment.Wood,
  HarvesterAssignment.Stone,
  HarvesterAssignment.Center,
];

const ASSIGNMENT_LABELS: Record<HarvesterAssignment, string> = {
  [HarvesterAssignment.BaseGold]: 'Gold',
  [HarvesterAssignment.Wood]: 'Wood',
  [HarvesterAssignment.Stone]: 'Stone',
  [HarvesterAssignment.Center]: 'Center',
};

export class InputHandler {
  private game: Game;
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private selectedBuilding: BuildingType | null = null;
  private hoveredGridSlot: { gx: number; gy: number } | null = null;
  private nukeTargeting = false;
  private tooltip: { text: string; x: number; y: number } | null = null;

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

      const item = BUILD_TRAY.find(b => b.key === e.key);
      if (item) {
        this.nukeTargeting = false;
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
        return;
      }
      if (e.key === 'Escape') {
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

  private worldToGridSlot(playerId: number, worldPixelX: number, worldPixelY: number): { gx: number; gy: number } | null {
    const origin = getBuildGridOrigin(playerId);
    const gx = Math.floor(worldPixelX / TILE_SIZE) - origin.x;
    const gy = Math.floor(worldPixelY / TILE_SIZE) - origin.y;
    if (gx < 0 || gx >= BUILD_GRID_COLS || gy < 0 || gy >= BUILD_GRID_ROWS) return null;
    return { gx, gy };
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

  private getTrayLayout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const milH = 68;
    const hutH = 52;
    const gap = 4;
    const hutY = H - hutH;
    const milY = hutY - gap - milH;
    const milW = W / (BUILD_TRAY.length + 1); // +1 for nuke
    const hutSlotW = W / 10;
    return { W, H, milH, hutH, hutY, milY, milW, hutSlotW };
  }

  // Returns true if click was consumed by a UI panel
  private handleUIClick(e: MouseEvent): boolean {
    const { milH, hutH, hutY, milY, milW, hutSlotW } = this.getTrayLayout();
    const cx = e.clientX;
    const cy = e.clientY;
    const player = this.game.state.players[0];

    // Military tray hit test
    if (cy >= milY && cy < milY + milH) {
      const colIdx = Math.floor(cx / milW);
      if (colIdx < BUILD_TRAY.length) {
        const item = BUILD_TRAY[colIdx];
        this.nukeTargeting = false;
        this.selectedBuilding = this.selectedBuilding === item.type ? null : item.type;
      } else if (colIdx === BUILD_TRAY.length) {
        // Nuke button
        if (player.nukeAvailable) {
          this.selectedBuilding = null;
          this.nukeTargeting = !this.nukeTargeting;
        }
      }
      return true;
    }

    // Hut row hit test
    if (cy >= hutY && cy < hutY + hutH) {
      const slotIdx = Math.floor(cx / hutSlotW);
      if (slotIdx < 0 || slotIdx >= 10) return true;

      const myHuts = this.game.state.buildings.filter(
        b => b.playerId === 0 && b.type === BuildingType.HarvesterHut
      );
      // Find which hut (if any) is in this slot
      const hutInSlot = CENTER_OUT_ORDER.slice(0, myHuts.length).indexOf(slotIdx);
      if (hutInSlot >= 0) {
        // Cycle assignment of this hut's harvester
        const hut = myHuts[hutInSlot];
        const h = this.game.state.harvesters.find(h => h.hutId === hut.id);
        if (h) {
          const curIdx = ASSIGNMENT_CYCLE.indexOf(h.assignment);
          const nextAssignment = ASSIGNMENT_CYCLE[(curIdx + 1) % ASSIGNMENT_CYCLE.length];
          this.game.sendCommand({
            type: 'set_hut_assignment', playerId: 0,
            hutId: hut.id, assignment: nextAssignment,
          });
        }
      } else {
        // Empty slot — build a new hut
        this.game.sendCommand({ type: 'build_hut', playerId: 0 });
      }
      return true;
    }

    return false;
  }

  render(renderer: Renderer): void {
    const ctx = renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBuildTray(ctx);

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
    const { W, milH, hutH, hutY, milY, milW, hutSlotW } = this.getTrayLayout();
    const player = this.game.state.players[0];

    // ── Military tray background ──────────────────────────────────────
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, milY, W, milH);

    for (let i = 0; i < BUILD_TRAY.length; i++) {
      const item = BUILD_TRAY[i];
      const bx = i * milW;
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

    // Nuke button
    const nukeAvail = player.nukeAvailable;
    const nukeX = BUILD_TRAY.length * milW;
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

    // ── Hut row ───────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, hutY, W, hutH);

    const myHuts = this.game.state.buildings.filter(
      b => b.playerId === 0 && b.type === BuildingType.HarvesterHut
    );
    // Build slot→hut map
    const slotToHut: (typeof myHuts[0] | null)[] = new Array(10).fill(null);
    for (let i = 0; i < myHuts.length && i < 10; i++) {
      slotToHut[CENTER_OUT_ORDER[i]] = myHuts[i];
    }
    const nextSlot = myHuts.length < 10 ? CENTER_OUT_ORDER[myHuts.length] : -1;
    const hutCost = HARVESTER_HUT_COST(myHuts.length);
    const canAffordHut = player.gold >= hutCost;

    for (let slot = 0; slot < 10; slot++) {
      const hx = slot * hutSlotW;
      const hut = slotToHut[slot];
      const isNext = slot === nextSlot;

      ctx.fillStyle = hut
        ? 'rgba(55, 35, 15, 0.9)'
        : isNext ? 'rgba(35, 35, 20, 0.9)' : 'rgba(18, 18, 18, 0.9)';
      ctx.fillRect(hx + 1, hutY + 1, hutSlotW - 2, hutH - 2);
      ctx.strokeStyle = hut ? '#8d6e63' : (isNext ? '#666' : '#2a2a2a');
      ctx.lineWidth = 1;
      ctx.strokeRect(hx + 1, hutY + 1, hutSlotW - 2, hutH - 2);

      ctx.textAlign = 'center';

      if (hut) {
        const harvester = this.game.state.harvesters.find(h => h.hutId === hut.id);
        ctx.fillStyle = '#c8a070';
        ctx.font = 'bold 14px monospace';
        ctx.fillText('HUT', hx + hutSlotW / 2, hutY + 16);
        ctx.fillStyle = '#aaa';
        ctx.font = '13px monospace';
        ctx.fillText(harvester ? ASSIGNMENT_LABELS[harvester.assignment] : '···', hx + hutSlotW / 2, hutY + 32);
        // HP bar
        const hpFrac = hut.hp / hut.maxHp;
        ctx.fillStyle = '#222';
        ctx.fillRect(hx + 3, hutY + 40, hutSlotW - 6, 6);
        ctx.fillStyle = hpFrac > 0.5 ? '#4caf50' : hpFrac > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillRect(hx + 3, hutY + 40, (hutSlotW - 6) * hpFrac, 6);
      } else if (isNext) {
        ctx.fillStyle = canAffordHut ? '#bbb' : '#555';
        ctx.font = '14px monospace';
        ctx.fillText('+ HUT', hx + hutSlotW / 2, hutY + 20);
        ctx.fillStyle = canAffordHut ? '#ffd700' : '#553300';
        ctx.font = '13px monospace';
        ctx.fillText(`${hutCost}g`, hx + hutSlotW / 2, hutY + 38);
      } else {
        ctx.fillStyle = '#2a2a2a';
        ctx.font = '18px monospace';
        ctx.fillText('·', hx + hutSlotW / 2, hutY + 30);
      }
    }

    ctx.textAlign = 'start';
  }

  private drawPlacementPreview(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    if (!this.hoveredGridSlot) return;

    const origin = getBuildGridOrigin(0);
    const worldX = (origin.x + this.hoveredGridSlot.gx) * TILE_SIZE;
    const worldY = (origin.y + this.hoveredGridSlot.gy) * TILE_SIZE;

    const occupied = this.game.state.buildings.some(
      b => b.playerId === 0 && b.gridX === this.hoveredGridSlot!.gx && b.gridY === this.hoveredGridSlot!.gy
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
