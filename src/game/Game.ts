import {
  GameState, GameCommand, Race, BuildingType, Lane,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, HarvesterAssignment,
} from '../simulation/types';
import { createInitialState, simulateTick } from '../simulation/GameState';
import { BUILDING_COSTS, HARVESTER_HUT_COST } from '../simulation/data';
import { GameLoop } from './GameLoop';
import { Renderer } from '../rendering/Renderer';
import { InputHandler } from '../ui/InputHandler';

export class Game {
  state: GameState;
  private renderer: Renderer;
  private loop: GameLoop;
  private pendingCommands: GameCommand[] = [];
  private input: InputHandler;

  constructor(canvas: HTMLCanvasElement) {
    this.state = createInitialState([
      { race: Race.Surge, isBot: false },   // P0 - human
      { race: Race.Tide, isBot: true },      // P1 - bot teammate
      { race: Race.Ember, isBot: true },     // P2 - bot enemy
      { race: Race.Bastion, isBot: true },   // P3 - bot enemy
    ]);

    this.renderer = new Renderer(canvas);
    this.input = new InputHandler(this, canvas, this.renderer.camera);

    this.loop = new GameLoop(
      () => this.tick(),
      () => this.render(),
    );
  }

  start(): void {
    this.loop.start();
  }

  sendCommand(cmd: GameCommand): void {
    this.pendingCommands.push(cmd);
  }

  private tick(): void {
    this.runBotAI();
    simulateTick(this.state, this.pendingCommands);
    this.pendingCommands = [];
  }

  private render(): void {
    this.renderer.render(this.state);
    this.input.render(this.renderer);
  }

  private runBotAI(): void {
    for (const player of this.state.players) {
      if (!player.isBot) continue;
      if (this.state.matchPhase !== 'playing') continue;
      this.runSingleBotAI(player.id);
    }
  }

  private runSingleBotAI(playerId: number): void {
    const player = this.state.players[playerId];
    const myBuildings = this.state.buildings.filter(b => b.playerId === playerId);
    const meleeCount = myBuildings.filter(b => b.type === BuildingType.MeleeSpawner).length;
    const rangedCount = myBuildings.filter(b => b.type === BuildingType.RangedSpawner).length;
    const casterCount = myBuildings.filter(b => b.type === BuildingType.CasterSpawner).length;
    const towerCount = myBuildings.filter(b => b.type === BuildingType.Tower).length;
    const hutCount = myBuildings.filter(b => b.type === BuildingType.HarvesterHut).length;

    // Decision interval varies per bot to stagger actions
    const interval = 80 + playerId * 15;
    if (this.state.tick % interval !== 0) return;

    const gameMinutes = this.state.tick / (20 * 60);

    // Early game: get economy going
    if (gameMinutes < 1) {
      if (hutCount === 0) {
        this.sendCommand({ type: 'build_hut', playerId });
        return;
      }
      if (meleeCount === 0) {
        this.botPlaceBuilding(playerId, BuildingType.MeleeSpawner, myBuildings);
        return;
      }
      if (hutCount < 2 && player.gold >= HARVESTER_HUT_COST(hutCount)) {
        this.sendCommand({ type: 'build_hut', playerId });
        return;
      }
    }

    // Mid game: build army + economy
    if (gameMinutes < 5) {
      if (meleeCount < 2 && this.botCanAfford(playerId, BuildingType.MeleeSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.MeleeSpawner, myBuildings);
        return;
      }
      if (rangedCount < 1 && this.botCanAfford(playerId, BuildingType.RangedSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.RangedSpawner, myBuildings);
        return;
      }
      if (hutCount < 3 && player.gold >= HARVESTER_HUT_COST(hutCount)) {
        this.sendCommand({ type: 'build_hut', playerId });
        return;
      }
      if (towerCount < 1 && this.botCanAfford(playerId, BuildingType.Tower)) {
        this.botPlaceBuilding(playerId, BuildingType.Tower, myBuildings);
        return;
      }
      if (meleeCount < 3 && this.botCanAfford(playerId, BuildingType.MeleeSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.MeleeSpawner, myBuildings);
        return;
      }
      if (rangedCount < 2 && this.botCanAfford(playerId, BuildingType.RangedSpawner)) {
        this.botPlaceBuilding(playerId, BuildingType.RangedSpawner, myBuildings);
        return;
      }
    }

    // Late game: fill up, add casters, more towers
    const totalSpawners = meleeCount + rangedCount + casterCount;
    if (casterCount < 1 && totalSpawners >= 3 && this.botCanAfford(playerId, BuildingType.CasterSpawner)) {
      this.botPlaceBuilding(playerId, BuildingType.CasterSpawner, myBuildings);
      return;
    }
    if (hutCount < 5 && player.gold >= HARVESTER_HUT_COST(hutCount)) {
      this.sendCommand({ type: 'build_hut', playerId });
      return;
    }
    if (towerCount < 2 && this.botCanAfford(playerId, BuildingType.Tower)) {
      this.botPlaceBuilding(playerId, BuildingType.Tower, myBuildings);
      return;
    }
    if (this.botCanAfford(playerId, meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner)) {
      this.botPlaceBuilding(playerId, meleeCount <= rangedCount ? BuildingType.MeleeSpawner : BuildingType.RangedSpawner, myBuildings);
    }

    // Harvester assignment management
    this.botManageHarvesters(playerId, gameMinutes);

    // Lane management: randomly switch lanes sometimes
    if (this.state.tick % (interval * 5) === 0 && myBuildings.length > 0) {
      const currentLane = myBuildings[0].lane;
      const newLane = currentLane === Lane.Left ? Lane.Right : Lane.Left;
      this.sendCommand({ type: 'toggle_all_lanes', playerId, lane: newLane });
    }

    // Nuke usage: fire at cluster of enemies when available
    if (player.nukeAvailable && gameMinutes > 3) {
      this.botFireNuke(playerId);
    }
  }

  private botCanAfford(playerId: number, type: BuildingType): boolean {
    const player = this.state.players[playerId];
    const cost = BUILDING_COSTS[type];
    return player.gold >= cost.gold && player.wood >= cost.wood && player.stone >= cost.stone;
  }

  private botPlaceBuilding(playerId: number, type: BuildingType, myBuildings: typeof this.state.buildings): void {
    const occupied = new Set(myBuildings.map(b => `${b.gridX},${b.gridY}`));
    for (let gy = 0; gy < BUILD_GRID_ROWS; gy++) {
      for (let gx = 0; gx < BUILD_GRID_COLS; gx++) {
        if (!occupied.has(`${gx},${gy}`)) {
          this.sendCommand({
            type: 'place_building', playerId,
            buildingType: type, gridX: gx, gridY: gy,
          });
          return;
        }
      }
    }
  }

  private botManageHarvesters(playerId: number, gameMinutes: number): void {
    const myHarvesters = this.state.harvesters.filter(h => h.playerId === playerId);
    if (myHarvesters.length === 0) return;

    // Assign harvesters strategically:
    // First hut: base gold always
    // Second: wood (need it for ranged/caster)
    // Third+: center (mine diamond gold, contest diamond)
    for (let i = 0; i < myHarvesters.length; i++) {
      const h = myHarvesters[i];
      let desired: HarvesterAssignment;
      if (i === 0) {
        desired = HarvesterAssignment.BaseGold;
      } else if (i === 1) {
        desired = HarvesterAssignment.Wood;
      } else if (i === 2 && gameMinutes > 2) {
        desired = HarvesterAssignment.Stone;
      } else if (gameMinutes > 3) {
        desired = HarvesterAssignment.Center;
      } else {
        desired = HarvesterAssignment.BaseGold;
      }

      if (h.assignment !== desired) {
        const hut = this.state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          this.sendCommand({
            type: 'set_hut_assignment', playerId,
            hutId: hut.id, assignment: desired,
          });
        }
      }
    }
  }

  private botFireNuke(playerId: number): void {
    const player = this.state.players[playerId];
    const enemyTeam = player.team === 0 ? 1 : 0;
    const enemyUnits = this.state.units.filter(u => u.team === enemyTeam);
    if (enemyUnits.length < 5) return; // wait for good cluster

    // Find centroid of enemies
    let cx = 0, cy = 0;
    for (const u of enemyUnits) { cx += u.x; cy += u.y; }
    cx /= enemyUnits.length;
    cy /= enemyUnits.length;

    this.sendCommand({ type: 'fire_nuke', playerId, x: cx, y: cy });
  }
}
