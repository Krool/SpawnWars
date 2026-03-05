import {
  GameState, PlayerState, DiamondState, Team, Race, Lane,
  MAP_WIDTH, HQ_HP, HQ_WIDTH, HQ_HEIGHT,
  BUILD_GRID_COLS, BUILD_GRID_ROWS, ZONES, TICK_RATE,
  DIAMOND_CENTER_X, DIAMOND_CENTER_Y, DIAMOND_HALF_W, DIAMOND_HALF_H,
  GOLD_PER_CELL, GoldCell, CROSS_BASE_MARGIN, CROSS_BASE_WIDTH,
  LANE_PATHS, Vec2,
  GameCommand, BuildingType, BuildingState, ResourceType,
  HarvesterAssignment, HarvesterState, UnitState,
  StatusType,
} from './types';
import { BUILDING_COSTS, HARVESTER_HUT_COST, SPAWN_INTERVAL_TICKS, UNIT_STATS, TOWER_STATS } from './data';

let nextId = 1;
function genId(): number { return nextId++; }

// === Generate diamond-shaped gold cell grid ===

function generateDiamondCells(): GoldCell[] {
  const cells: GoldCell[] = [];
  const cx = DIAMOND_CENTER_X;
  const cy = DIAMOND_CENTER_Y;
  const hw = DIAMOND_HALF_W;
  const hh = DIAMOND_HALF_H;

  for (let dy = -hh; dy <= hh; dy++) {
    const rowWidth = Math.round(hw * (1 - Math.abs(dy) / hh));
    for (let dx = -rowWidth; dx <= rowWidth; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (dx === 0 && dy === 0) continue;
      cells.push({
        tileX: tx,
        tileY: ty,
        gold: GOLD_PER_CELL,
        maxGold: GOLD_PER_CELL,
      });
    }
  }
  return cells;
}

function isDiamondExposed(cells: GoldCell[]): boolean {
  const neighbors = [
    { x: DIAMOND_CENTER_X - 1, y: DIAMOND_CENTER_Y },
    { x: DIAMOND_CENTER_X + 1, y: DIAMOND_CENTER_Y },
    { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y - 1 },
    { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y + 1 },
  ];
  for (const n of neighbors) {
    const cell = cells.find(c => c.tileX === n.x && c.tileY === n.y);
    if (!cell || cell.gold <= 0) {
      if (hasPathToEdge(cells, n.x, n.y)) return true;
    }
  }
  return false;
}

function hasPathToEdge(cells: GoldCell[], sx: number, sy: number): boolean {
  const cellSet = new Map<string, GoldCell>();
  for (const c of cells) cellSet.set(`${c.tileX},${c.tileY}`, c);

  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
  visited.add(`${sx},${sy}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dx = Math.abs(cur.x - DIAMOND_CENTER_X);
    const dy = Math.abs(cur.y - DIAMOND_CENTER_Y);
    if (dx > DIAMOND_HALF_W || dy > DIAMOND_HALF_H) return true;

    for (const [nx, ny] of [[cur.x-1,cur.y],[cur.x+1,cur.y],[cur.x,cur.y-1],[cur.x,cur.y+1]]) {
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const cell = cellSet.get(key);
      if (!cell || cell.gold <= 0) {
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

function findBestCellToMine(cells: GoldCell[], fromX: number, fromY: number): number {
  // Build lookup map once for all accessibility checks
  const cellMap = new Map<string, GoldCell>();
  for (const c of cells) cellMap.set(`${c.tileX},${c.tileY}`, c);

  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.gold <= 0) continue;
    if (!isAccessible(cellMap, c.tileX, c.tileY)) continue;
    const dx = c.tileX - fromX;
    const dy = c.tileY - fromY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function isAccessible(cellMap: Map<string, GoldCell>, tx: number, ty: number): boolean {
  for (const [nx, ny] of [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]]) {
    const neighbor = cellMap.get(`${nx},${ny}`);
    if (!neighbor) return true;
    if (neighbor.gold <= 0) return true;
  }
  return false;
}

// === Visual effect helpers ===

function addFloatingText(state: GameState, x: number, y: number, text: string, color: string): void {
  state.floatingTexts.push({ x, y, text, color, age: 0, maxAge: TICK_RATE * 1.5 });
}

function addDeathParticles(state: GameState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      age: 0,
      maxAge: TICK_RATE * (0.5 + Math.random() * 0.8),
      size: 1 + Math.random() * 2,
    });
  }
}

// === State Creation ===

export function createInitialState(
  players: { race: Race; isBot: boolean }[]
): GameState {
  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: i,
    team: i < 2 ? Team.Bottom : Team.Top,
    race: p.race,
    gold: 200,
    wood: 0,
    stone: 0,
    nukeAvailable: true,
    connected: true,
    isBot: p.isBot,
  }));

  const diamond: DiamondState = {
    x: DIAMOND_CENTER_X,
    y: DIAMOND_CENTER_Y,
    exposed: false,
    state: 'hidden',
    carrierId: null,
    carrierType: null,
    mineProgress: 0,
  };

  return {
    tick: 0,
    players: playerStates,
    buildings: [],
    units: [],
    harvesters: [],
    projectiles: [],
    diamond,
    diamondCells: generateDiamondCells(),
    hqHp: [HQ_HP, HQ_HP],
    winner: null,
    winCondition: null,
    matchPhase: 'prematch',
    prematchTimer: 10 * TICK_RATE,
    floatingTexts: [],
    particles: [],
    nukeEffects: [],
    nukeTelegraphs: [],
  };
}

// === Layout helpers ===

export function getBuildGridOrigin(playerId: number): { x: number; y: number } {
  const team = playerId < 2 ? Team.Bottom : Team.Top;
  const isLeft = playerId === 0 || playerId === 2;

  const gap = 2;
  const totalW = BUILD_GRID_COLS * 2 + gap;
  const baseLeft = CROSS_BASE_MARGIN;
  const startX = baseLeft + Math.floor((CROSS_BASE_WIDTH - totalW) / 2);
  const x = isLeft
    ? startX
    : startX + BUILD_GRID_COLS + gap;

  const zoneStart = team === Team.Bottom ? ZONES.BOTTOM_BASE.start : ZONES.TOP_BASE.start;
  const zoneH = (team === Team.Bottom ? ZONES.BOTTOM_BASE.end : ZONES.TOP_BASE.end) - zoneStart;
  const y = zoneStart + Math.floor((zoneH - BUILD_GRID_ROWS) / 2);

  return { x, y };
}

export function getHQPosition(team: Team): { x: number; y: number } {
  const centerX = Math.floor(MAP_WIDTH / 2) - Math.floor(HQ_WIDTH / 2);
  return team === Team.Bottom
    ? { x: centerX, y: ZONES.BOTTOM_BASE.start + 1 }
    : { x: centerX, y: ZONES.TOP_BASE.end - HQ_HEIGHT - 1 };
}

export function gridSlotToWorld(playerId: number, gridX: number, gridY: number): { x: number; y: number } {
  const origin = getBuildGridOrigin(playerId);
  return { x: origin.x + gridX, y: origin.y + gridY };
}

// === Lane path helpers ===

function getLanePath(team: Team, lane: Lane): readonly Vec2[] {
  return team === Team.Bottom
    ? (lane === Lane.Left ? LANE_PATHS.bottom.left : LANE_PATHS.bottom.right)
    : (lane === Lane.Left ? LANE_PATHS.top.left : LANE_PATHS.top.right);
}

function interpolatePath(path: readonly Vec2[], t: number): Vec2 {
  const ct = Math.max(0, Math.min(1, t));
  const segs = path.length - 1;
  const seg = ct * segs;
  const idx = Math.min(Math.floor(seg), segs - 1);
  const lt = seg - idx;
  const a = path[idx], b = path[idx + 1];
  return { x: a.x + (b.x - a.x) * lt, y: a.y + (b.y - a.y) * lt };
}

function getPathLength(path: readonly Vec2[]): number {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// === Simulation Tick ===

export function simulateTick(state: GameState, commands: GameCommand[]): void {
  for (const cmd of commands) processCommand(state, cmd);

  if (state.matchPhase === 'prematch') {
    state.prematchTimer--;
    if (state.prematchTimer <= 0) state.matchPhase = 'playing';
    state.tick++;
    return;
  }
  if (state.matchPhase === 'ended') { state.tick++; return; }

  // Passive income
  if (state.tick % TICK_RATE === 0) {
    for (const p of state.players) p.gold += 1;
  }

  // Update diamond exposed state (check every second, not every tick — BFS is expensive)
  if (!state.diamond.exposed && state.diamond.state === 'hidden' && state.tick % TICK_RATE === 0) {
    if (isDiamondExposed(state.diamondCells)) {
      state.diamond.exposed = true;
      state.diamond.state = 'exposed';
    }
  }

  tickSpawners(state);
  tickUnitMovement(state);
  tickCombat(state);
  tickTowers(state);
  tickProjectiles(state);
  tickStatusEffects(state);
  tickNukeTelegraphs(state);
  tickHarvesters(state);
  tickEffects(state);
  checkWinConditions(state);

  if (state.tick >= 20 * 60 * TICK_RATE) {
    state.matchPhase = 'ended';
    if (state.hqHp[0] > state.hqHp[1]) state.winner = Team.Bottom;
    else if (state.hqHp[1] > state.hqHp[0]) state.winner = Team.Top;
    state.winCondition = 'timeout';
  }

  state.tick++;
}

// === Commands ===

function processCommand(state: GameState, cmd: GameCommand): void {
  switch (cmd.type) {
    case 'place_building': placeBuilding(state, cmd); break;
    case 'sell_building': sellBuilding(state, cmd); break;
    case 'toggle_lane': toggleLane(state, cmd); break;
    case 'toggle_all_lanes': toggleAllLanes(state, cmd); break;
    case 'build_hut': buildHut(state, cmd); break;
    case 'set_hut_assignment': setHutAssignment(state, cmd); break;
    case 'fire_nuke': fireNuke(state, cmd); break;
  }
}

function placeBuilding(state: GameState, cmd: Extract<GameCommand, { type: 'place_building' }>): void {
  const player = state.players[cmd.playerId];
  if (!player) return;
  const cost = BUILDING_COSTS[cmd.buildingType];
  if (!cost) return;
  if (player.gold < cost.gold || player.wood < cost.wood || player.stone < cost.stone) return;
  if (state.buildings.some(b => b.playerId === cmd.playerId && b.gridX === cmd.gridX && b.gridY === cmd.gridY)) return;
  if (cmd.gridX < 0 || cmd.gridX >= BUILD_GRID_COLS || cmd.gridY < 0 || cmd.gridY >= BUILD_GRID_ROWS) return;

  player.gold -= cost.gold;
  player.wood -= cost.wood;
  player.stone -= cost.stone;

  const world = gridSlotToWorld(cmd.playerId, cmd.gridX, cmd.gridY);
  const isLeft = cmd.playerId === 0 || cmd.playerId === 2;

  // Towers use spawnTimer as attack cooldown (start ready to fire)
  const initialTimer = cmd.buildingType === BuildingType.Tower ? 0 : SPAWN_INTERVAL_TICKS;

  state.buildings.push({
    id: genId(), type: cmd.buildingType, playerId: cmd.playerId,
    gridX: cmd.gridX, gridY: cmd.gridY,
    worldX: world.x, worldY: world.y,
    lane: isLeft ? Lane.Left : Lane.Right,
    hp: cost.hp, maxHp: cost.hp,
    spawnTimer: initialTimer, upgradePath: ['A'],
  });
}

function sellBuilding(state: GameState, cmd: Extract<GameCommand, { type: 'sell_building' }>): void {
  const idx = state.buildings.findIndex(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (idx === -1) return;
  const building = state.buildings[idx];
  const cost = BUILDING_COSTS[building.type];
  if (cost) state.players[cmd.playerId].gold += Math.floor(cost.gold * 0.5);

  // If it's a hut, remove the associated harvester
  if (building.type === BuildingType.HarvesterHut) {
    const hIdx = state.harvesters.findIndex(h => h.hutId === building.id);
    if (hIdx !== -1) state.harvesters.splice(hIdx, 1);
  }

  addFloatingText(state, building.worldX, building.worldY, `+${Math.floor(cost.gold * 0.5)}g`, '#ffd700');
  state.buildings.splice(idx, 1);
}

function toggleLane(state: GameState, cmd: Extract<GameCommand, { type: 'toggle_lane' }>): void {
  const b = state.buildings.find(b => b.id === cmd.buildingId && b.playerId === cmd.playerId);
  if (b) b.lane = cmd.lane;
}

function toggleAllLanes(state: GameState, cmd: Extract<GameCommand, { type: 'toggle_all_lanes' }>): void {
  for (const b of state.buildings) {
    if (b.playerId === cmd.playerId && b.type !== BuildingType.Tower) b.lane = cmd.lane;
  }
}

function buildHut(state: GameState, cmd: Extract<GameCommand, { type: 'build_hut' }>): void {
  const player = state.players[cmd.playerId];
  const hutCount = state.buildings.filter(b => b.playerId === cmd.playerId && b.type === BuildingType.HarvesterHut).length;
  if (hutCount >= 10) return;
  const cost = HARVESTER_HUT_COST(hutCount);
  if (player.gold < cost) return;
  player.gold -= cost;

  const occupied = new Set(state.buildings.filter(b => b.playerId === cmd.playerId).map(b => `${b.gridX},${b.gridY}`));
  for (let gy = BUILD_GRID_ROWS - 1; gy >= 0; gy--) {
    for (let gx = 0; gx < BUILD_GRID_COLS; gx++) {
      if (!occupied.has(`${gx},${gy}`)) {
        const world = gridSlotToWorld(cmd.playerId, gx, gy);
        const building: BuildingState = {
          id: genId(), type: BuildingType.HarvesterHut, playerId: cmd.playerId,
          gridX: gx, gridY: gy, worldX: world.x, worldY: world.y,
          lane: Lane.Left, hp: 150, maxHp: 150, spawnTimer: 0, upgradePath: [],
        };
        state.buildings.push(building);
        state.harvesters.push({
          id: genId(), hutId: building.id, playerId: cmd.playerId, team: player.team,
          x: world.x, y: world.y, hp: 30, maxHp: 30, damage: 0,
          assignment: HarvesterAssignment.BaseGold,
          state: 'walking_to_node', miningTimer: 0, respawnTimer: 0,
          carryingDiamond: false, carryingResource: null, carryAmount: 0,
          targetCellIdx: -1, fightTargetId: null,
        });
        return;
      }
    }
  }
}

function setHutAssignment(state: GameState, cmd: Extract<GameCommand, { type: 'set_hut_assignment' }>): void {
  const h = state.harvesters.find(h => h.hutId === cmd.hutId && h.playerId === cmd.playerId);
  if (!h) return;
  h.assignment = cmd.assignment;
  if (h.state === 'walking_to_node' || h.state === 'mining') {
    h.state = 'walking_to_node';
    h.miningTimer = 0;
    h.targetCellIdx = -1;
  }
}

function fireNuke(state: GameState, cmd: Extract<GameCommand, { type: 'fire_nuke' }>): void {
  const player = state.players[cmd.playerId];
  if (!player.nukeAvailable) return;
  player.nukeAvailable = false;

  // 1.25 second telegraph before detonation
  state.nukeTelegraphs.push({
    x: cmd.x, y: cmd.y,
    radius: 8,
    playerId: cmd.playerId,
    timer: Math.round(1.25 * TICK_RATE),
  });
}

function dropDiamond(state: GameState, x: number, y: number): void {
  state.diamond.state = 'dropped';
  state.diamond.x = x;
  state.diamond.y = y;
  state.diamond.carrierId = null;
  state.diamond.carrierType = null;
}

function killHarvester(h: HarvesterState): void {
  h.state = 'dead';
  h.hp = 0;
  h.respawnTimer = 10 * TICK_RATE;
  h.carryingDiamond = false;
  h.carryingResource = null;
  h.carryAmount = 0;
  h.fightTargetId = null;
  h.targetCellIdx = -1;
}

// === Tick Systems ===

function tickSpawners(state: GameState): void {
  for (const building of state.buildings) {
    if (building.type === BuildingType.Tower || building.type === BuildingType.HarvesterHut) continue;
    building.spawnTimer--;
    if (building.spawnTimer <= 0) {
      building.spawnTimer = SPAWN_INTERVAL_TICKS;
      const player = state.players[building.playerId];
      const stats = UNIT_STATS[player.race]?.[building.type];
      if (!stats) continue;
      state.units.push({
        id: genId(), type: stats.name, playerId: building.playerId, team: player.team,
        x: building.worldX, y: building.worldY,
        hp: stats.hp, maxHp: stats.hp, damage: stats.damage,
        attackSpeed: stats.attackSpeed, attackTimer: 0,
        moveSpeed: stats.moveSpeed, range: stats.range,
        targetId: null, lane: building.lane, pathProgress: -1, carryingDiamond: false,
        statusEffects: [], hitCount: 0, shieldHp: 0,
      });
    }
  }
}

function getEffectiveSpeed(unit: UnitState): number {
  let speed = unit.moveSpeed;
  for (const eff of unit.statusEffects) {
    if (eff.type === StatusType.Slow) speed *= Math.max(0.5, 1 - 0.1 * eff.stacks);
    if (eff.type === StatusType.Haste) speed *= 1.3;
  }
  return speed;
}

function tickUnitMovement(state: GameState): void {
  for (const unit of state.units) {
    if (unit.targetId !== null) continue;
    const speed = getEffectiveSpeed(unit);
    const movePerTick = speed / TICK_RATE;

    // Phase 1: Walking from building to lane path start
    if (unit.pathProgress < 0) {
      const path = getLanePath(unit.team, unit.lane);
      const target = path[0]; // first waypoint
      const dx = target.x - unit.x, dy = target.y - unit.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < movePerTick * 2) {
        // Close enough — join the lane path
        unit.pathProgress = 0;
        unit.x = target.x;
        unit.y = target.y;
      } else {
        unit.x += (dx / dist) * movePerTick;
        unit.y += (dy / dist) * movePerTick;
      }
      continue;
    }

    // Phase 2: Following lane path
    const path = getLanePath(unit.team, unit.lane);
    const pathLen = getPathLength(path);
    unit.pathProgress += movePerTick / pathLen;
    if (unit.pathProgress > 1) unit.pathProgress = 1;
    const pos = interpolatePath(path, unit.pathProgress);
    unit.x = pos.x;
    unit.y = pos.y;
  }
}

function applyStatus(target: UnitState, type: StatusType, stacks: number): void {
  const existing = target.statusEffects.find(e => e.type === type);
  const maxStacks = type === StatusType.Slow || type === StatusType.Burn ? 5 : 1;
  const duration = type === StatusType.Burn ? 3 * TICK_RATE :
                   type === StatusType.Slow ? 3 * TICK_RATE :
                   type === StatusType.Haste ? 3 * TICK_RATE :
                   5 * TICK_RATE; // Shield
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, maxStacks);
    existing.duration = duration; // refresh
  } else {
    target.statusEffects.push({ type, stacks: Math.min(stacks, maxStacks), duration });
  }
  if (type === StatusType.Shield && target.shieldHp <= 0) target.shieldHp = 20;
}

function applyKnockback(unit: UnitState, amount: number): void {
  if (unit.pathProgress < 0) return; // not on path yet
  // Push unit backward along its path
  unit.pathProgress = Math.max(0, unit.pathProgress - amount);
  const path = getLanePath(unit.team, unit.lane);
  const pos = interpolatePath(path, unit.pathProgress);
  unit.x = pos.x;
  unit.y = pos.y;
}

function dealDamage(state: GameState, target: UnitState, amount: number, showFloat: boolean): void {
  // Shield absorbs damage first
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, amount);
    target.shieldHp -= absorbed;
    amount -= absorbed;
    if (target.shieldHp <= 0) {
      target.statusEffects = target.statusEffects.filter(e => e.type !== StatusType.Shield);
    }
    if (absorbed > 0 && showFloat) {
      addFloatingText(state, target.x, target.y, `[${absorbed}]`, '#64b5f6');
    }
  }
  if (amount > 0) {
    target.hp -= amount;
    if (showFloat && amount >= 10) addFloatingText(state, target.x, target.y, `-${amount}`, '#ff6666');
  }
}

function applyOnHitEffects(state: GameState, attacker: UnitState, target: UnitState): void {
  const race = state.players[attacker.playerId].race;
  const isMelee = attacker.range <= 2;
  const isCaster = attacker.type.includes('mage') || attacker.type.includes('caller') || attacker.type.includes('shaman');

  switch (race) {
    case Race.Surge:
      if (isMelee && Math.random() < 0.15) applyStatus(attacker, StatusType.Haste, 1);
      break;
    case Race.Tide:
      if (isMelee) applyStatus(target, StatusType.Slow, 1);
      break;
    case Race.Ember:
      if (isMelee) applyStatus(target, StatusType.Burn, 1);
      break;
    case Race.Bastion:
      if (isMelee) {
        attacker.hitCount++;
        if (attacker.hitCount % 3 === 0) applyKnockback(target, 0.02);
      } else if (!isCaster && Math.random() < 0.2) {
        applyKnockback(target, 0.02);
      }
      break;
  }
}

function tickCombat(state: GameState): void {
  for (const unit of state.units) {
    // Check if current target is still valid
    if (unit.targetId !== null) {
      const target = state.units.find(u => u.id === unit.targetId);
      if (!target || target.hp <= 0) unit.targetId = null;
      else {
        const dist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (dist > unit.range + 1) unit.targetId = null;
      }
    }
    // Acquire new target
    if (unit.targetId === null) {
      let nearest: UnitState | null = null;
      let nd = Infinity;
      for (const o of state.units) {
        if (o.team === unit.team || o.hp <= 0) continue;
        const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
        if (d <= unit.range && d < nd) { nearest = o; nd = d; }
      }
      if (nearest) unit.targetId = nearest.id;
    }
    // Attack
    if (unit.targetId !== null && unit.attackTimer <= 0) {
      const target = state.units.find(u => u.id === unit.targetId);
      if (target) {
        const race = state.players[unit.playerId].race;
        const isCaster = unit.type.includes('mage') || unit.type.includes('caller') || unit.type.includes('shaman');

        if (isCaster && race === Race.Bastion) {
          // Bastion Caster: shield allies INSTEAD of dealing damage
          const allies = state.units.filter(u => u.team === unit.team && u.id !== unit.id);
          allies.sort((a, b) => {
            const da = (a.x - unit.x) ** 2 + (a.y - unit.y) ** 2;
            const db = (b.x - unit.x) ** 2 + (b.y - unit.y) ** 2;
            return da - db;
          });
          for (let i = 0; i < Math.min(3, allies.length); i++) {
            applyStatus(allies[i], StatusType.Shield, 1);
          }
        } else if (isCaster) {
          // Other casters fire AoE projectiles
          const aoeRadius = race === Race.Tide ? 4 : 3;
          state.projectiles.push({
            id: genId(), x: unit.x, y: unit.y,
            targetId: target.id, damage: unit.damage,
            speed: 10, aoeRadius, team: unit.team,
            sourcePlayerId: unit.playerId,
          });
        } else if (unit.range > 2) {
          // Ranged unit: fire projectile
          state.projectiles.push({
            id: genId(), x: unit.x, y: unit.y,
            targetId: target.id, damage: unit.damage,
            speed: 15, aoeRadius: 0, team: unit.team,
            sourcePlayerId: unit.playerId,
          });
          // Surge ranged: chain to 1 nearby enemy
          if (race === Race.Surge) {
            let chainTarget: UnitState | null = null;
            let chainDist = Infinity;
            for (const o of state.units) {
              if (o.team === unit.team || o.id === target.id || o.hp <= 0) continue;
              const d = Math.sqrt((o.x - target.x) ** 2 + (o.y - target.y) ** 2);
              if (d <= 4 && d < chainDist) { chainTarget = o; chainDist = d; }
            }
            if (chainTarget) {
              state.projectiles.push({
                id: genId(), x: target.x, y: target.y,
                targetId: chainTarget.id, damage: Math.round(unit.damage * 0.5),
                speed: 20, aoeRadius: 0, team: unit.team,
                sourcePlayerId: unit.playerId,
              });
            }
          }
        } else {
          // Melee: instant damage
          dealDamage(state, target, unit.damage, unit.damage >= 10);
          applyOnHitEffects(state, unit, target);
        }

        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }
    if (unit.attackTimer > 0) unit.attackTimer--;
  }

  // Units at end of path damage HQ
  for (const unit of state.units) {
    if (unit.pathProgress >= 1) {
      const targetTeam = unit.team === Team.Bottom ? Team.Top : Team.Bottom;
      state.hqHp[targetTeam] -= unit.damage;
      addFloatingText(state, unit.x, unit.y, `-${unit.damage} HQ`, '#ff0000');
      unit.hp = 0;
    }
  }

  // Remove dead units with particles
  const deadUnits = state.units.filter(u => u.hp <= 0);
  for (const u of deadUnits) {
    addDeathParticles(state, u.x, u.y, u.team === Team.Bottom ? '#4488ff' : '#ff4444', 5);
    if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
  }
  state.units = state.units.filter(u => u.hp > 0);
}

// === Tower Combat ===

function tickTowers(state: GameState): void {
  for (const building of state.buildings) {
    if (building.type !== BuildingType.Tower) continue;

    const player = state.players[building.playerId];
    const stats = TOWER_STATS[player.race];
    const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

    building.spawnTimer--; // reuse spawnTimer as attack cooldown
    if (building.spawnTimer > 0) continue;

    const tx = building.worldX + 0.5;
    const ty = building.worldY + 0.5;

    // Bastion tower: shield allies (doesn't attack)
    if (player.race === Race.Bastion) {
      applyTowerSpecial(state, building, player.race, stats);
      continue;
    }

    // Surge/Tide towers have special attack patterns
    if (player.race === Race.Surge || player.race === Race.Tide) {
      const hasEnemiesInRange = state.units.some(u => u.team === enemyTeam &&
        Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2) <= stats.range);
      if (hasEnemiesInRange) {
        applyTowerSpecial(state, building, player.race, stats);
        continue;
      }
    }

    // Default: find closest enemy unit, fire projectile (Ember + fallback)
    let closest: UnitState | null = null;
    let closestDist = Infinity;

    for (const u of state.units) {
      if (u.team !== enemyTeam) continue;
      const dx = u.x - tx, dy = u.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= stats.range && dist < closestDist) {
        closest = u;
        closestDist = dist;
      }
    }

    if (closest) {
      state.projectiles.push({
        id: genId(),
        x: tx, y: ty,
        targetId: closest.id,
        damage: stats.damage,
        speed: 12,
        aoeRadius: 0,
        team: player.team,
        sourcePlayerId: building.playerId,
      });
      // Ember tower applies burn on hit (handled in tickProjectiles)
      building.spawnTimer = Math.round(stats.attackSpeed * TICK_RATE);
      continue;
    }

    // No unit targets — try enemy harvesters (direct damage)
    let closestHarv: HarvesterState | null = null;
    let closestHarvDist = Infinity;
    for (const h of state.harvesters) {
      if (h.team !== enemyTeam || h.state === 'dead') continue;
      const dx = h.x - tx, dy = h.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= stats.range && dist < closestHarvDist) {
        closestHarv = h;
        closestHarvDist = dist;
      }
    }
    if (closestHarv) {
      closestHarv.hp -= stats.damage;
      addFloatingText(state, closestHarv.x, closestHarv.y, `-${stats.damage}`, '#ffaa00');
      if (closestHarv.hp <= 0) {
        addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
        if (closestHarv.carryingDiamond) dropDiamond(state, closestHarv.x, closestHarv.y);
        killHarvester(closestHarv);
      }
      building.spawnTimer = Math.round(stats.attackSpeed * TICK_RATE);
    }
  }
}

// === Projectiles ===

function tickProjectiles(state: GameState): void {
  const toRemove = new Set<number>();

  for (const p of state.projectiles) {
    const target = state.units.find(u => u.id === p.targetId);
    if (!target || target.hp <= 0) {
      toRemove.add(p.id);
      continue;
    }

    const dx = target.x - p.x, dy = target.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const moveAmt = p.speed / TICK_RATE;

    if (dist <= moveAmt) {
      // Hit! Apply damage through shield
      dealDamage(state, target, p.damage, true);
      addDeathParticles(state, target.x, target.y, '#ffaa00', 2);

      // Apply status effects based on source player's race
      const sourcePlayer = state.players[p.sourcePlayerId];
      if (sourcePlayer) {
        const race = sourcePlayer.race;
        if (race === Race.Tide) applyStatus(target, StatusType.Slow, p.aoeRadius > 0 ? 2 : 1);
        if (race === Race.Ember) applyStatus(target, StatusType.Burn, p.aoeRadius > 0 ? 2 : 1);
      }

      // AOE damage
      if (p.aoeRadius > 0) {
        for (const u of state.units) {
          if (u.id === target.id || u.team === p.team) continue;
          const ad = Math.sqrt((u.x - target.x) ** 2 + (u.y - target.y) ** 2);
          if (ad <= p.aoeRadius) {
            const aoeDmg = Math.round(p.damage * 0.5);
            dealDamage(state, u, aoeDmg, true);
            if (sourcePlayer) {
              const race = sourcePlayer.race;
              if (race === Race.Tide) applyStatus(u, StatusType.Slow, p.aoeRadius > 0 ? 2 : 1);
              if (race === Race.Ember) applyStatus(u, StatusType.Burn, p.aoeRadius > 0 ? 2 : 1);
              if (race === Race.Surge) applyStatus(u, StatusType.Slow, 1);
            }
          }
        }
      }
      toRemove.add(p.id);
    } else {
      p.x += (dx / dist) * moveAmt;
      p.y += (dy / dist) * moveAmt;
    }
  }

  state.projectiles = state.projectiles.filter(p => !toRemove.has(p.id));
}

// === Visual Effects ===

function tickEffects(state: GameState): void {
  // Floating texts
  for (const ft of state.floatingTexts) ft.age++;
  state.floatingTexts = state.floatingTexts.filter(ft => ft.age < ft.maxAge);

  // Particles
  for (const p of state.particles) {
    p.x += p.vx / TICK_RATE;
    p.y += p.vy / TICK_RATE;
    p.vy += 0.1; // gravity
    p.age++;
  }
  state.particles = state.particles.filter(p => p.age < p.maxAge);

  // Nuke effects
  for (const n of state.nukeEffects) n.age++;
  state.nukeEffects = state.nukeEffects.filter(n => n.age < n.maxAge);
}

// === Status Effects ===

function tickStatusEffects(state: GameState): void {
  for (const unit of state.units) {
    for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
      const eff = unit.statusEffects[i];
      eff.duration--;

      // Burn DoT: 2 damage per stack per second (routes through shield)
      if (eff.type === StatusType.Burn && state.tick % TICK_RATE === 0) {
        const burnDmg = 2 * eff.stacks;
        dealDamage(state, unit, burnDmg, true);
        addDeathParticles(state, unit.x, unit.y, '#ff4400', 1);
      }

      // Shield expired
      if (eff.type === StatusType.Shield && eff.duration <= 0) {
        unit.shieldHp = 0;
      }

      if (eff.duration <= 0) {
        unit.statusEffects.splice(i, 1);
      }
    }
  }
}

// === Tower Race Specials ===

function applyTowerSpecial(state: GameState, building: BuildingState, race: Race, stats: { damage: number; range: number; attackSpeed: number }): void {
  const tx = building.worldX + 0.5;
  const ty = building.worldY + 0.5;
  const player = state.players[building.playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  switch (race) {
    case Race.Surge: {
      // Chain lightning: hit up to 3 targets
      const targets: UnitState[] = [];
      let lastX = tx, lastY = ty;
      for (let chain = 0; chain < 3; chain++) {
        let best: UnitState | null = null;
        let bestDist = chain === 0 ? stats.range : 4; // first hit uses range, chains use 4 tiles
        for (const u of state.units) {
          if (u.team !== enemyTeam || targets.some(t => t.id === u.id)) continue;
          const d = Math.sqrt((u.x - lastX) ** 2 + (u.y - lastY) ** 2);
          if (d <= bestDist) { best = u; bestDist = d; }
        }
        if (best) {
          targets.push(best);
          lastX = best.x; lastY = best.y;
        } else break;
      }
      for (let i = 0; i < targets.length; i++) {
        const dmg = i === 0 ? stats.damage : Math.round(stats.damage * 0.6);
        dealDamage(state, targets[i], dmg, true);
        addDeathParticles(state, targets[i].x, targets[i].y, '#00e5ff', 2);
      }
      if (targets.length > 0) building.spawnTimer = Math.round(stats.attackSpeed * TICK_RATE);
      break;
    }
    case Race.Tide: {
      // Hit ALL enemies in range, apply slow
      let hit = false;
      for (const u of state.units) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false);
          applyStatus(u, StatusType.Slow, 1);
          hit = true;
        }
      }
      if (hit) building.spawnTimer = Math.round(stats.attackSpeed * TICK_RATE);
      break;
    }
    case Race.Bastion: {
      // Shield all allies within 4 tiles every 8s (use spawnTimer for this)
      let shielded = false;
      const allies = state.units.filter(u => u.team === player.team);
      for (const a of allies) {
        const d = Math.sqrt((a.x - tx) ** 2 + (a.y - ty) ** 2);
        if (d <= 4) { applyStatus(a, StatusType.Shield, 1); shielded = true; }
      }
      if (shielded) building.spawnTimer = 8 * TICK_RATE;
      break;
    }
    // Ember: default single-target + burn (handled in tickTowers normally)
  }
}

// === Nuke Telegraph ===

function tickNukeTelegraphs(state: GameState): void {
  for (let i = state.nukeTelegraphs.length - 1; i >= 0; i--) {
    const tel = state.nukeTelegraphs[i];
    tel.timer--;
    if (tel.timer <= 0) {
      // Detonate
      executeNukeDetonation(state, tel.playerId, tel.x, tel.y, tel.radius);
      state.nukeTelegraphs.splice(i, 1);
    }
  }
}

function executeNukeDetonation(state: GameState, playerId: number, x: number, y: number, radius: number): void {
  const player = state.players[playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  state.nukeEffects.push({
    x, y, radius, age: 0, maxAge: TICK_RATE * 2,
  });

  state.units = state.units.filter(u => {
    if (u.team !== enemyTeam) return true;
    if ((u.x - x) ** 2 + (u.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, u.x, u.y, '#ff4400', 8);
      if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
      return false;
    }
    return true;
  });

  for (const h of state.harvesters) {
    if (h.team !== enemyTeam || h.state === 'dead') continue;
    if ((h.x - x) ** 2 + (h.y - y) ** 2 <= radius * radius) {
      addDeathParticles(state, h.x, h.y, '#ff4400', 6);
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      killHarvester(h);
    }
  }

  // GDD: Nuke does NOT damage buildings or HQ — only units and harvesters
}

// === Harvesters ===

function findOpenMiningSpot(state: GameState, h: HarvesterState, target: { x: number; y: number }): { x: number; y: number } {
  // Check if any other harvester is already mining within 1.2 tiles of target
  const otherMiners = state.harvesters.filter(o =>
    o.id !== h.id && o.state === 'mining' && o.assignment === h.assignment &&
    Math.sqrt((o.x - target.x) ** 2 + (o.y - target.y) ** 2) < 1.2
  );
  if (otherMiners.length === 0) return target;

  // Find an offset spot in a ring around the node
  const ringDist = 1.0 + otherMiners.length * 0.6;
  const angleStep = (Math.PI * 2) / 8;
  const baseAngle = (h.id * 137.508) % (Math.PI * 2); // golden angle spread
  let bestSpot = target;
  let bestOccupied = Infinity;

  for (let i = 0; i < 8; i++) {
    const a = baseAngle + i * angleStep;
    const cx = target.x + Math.cos(a) * ringDist;
    const cy = target.y + Math.sin(a) * ringDist;
    // Count how many miners are near this spot
    let occupied = 0;
    for (const o of otherMiners) {
      if (Math.sqrt((o.x - cx) ** 2 + (o.y - cy) ** 2) < 1.0) occupied++;
    }
    if (occupied < bestOccupied) {
      bestOccupied = occupied;
      bestSpot = { x: cx, y: cy };
    }
  }
  return bestSpot;
}

function tickHarvesters(state: GameState): void {
  // Soft collision between harvesters: push apart
  for (let i = 0; i < state.harvesters.length; i++) {
    const a = state.harvesters[i];
    if (a.state === 'dead') continue;
    for (let j = i + 1; j < state.harvesters.length; j++) {
      const b = state.harvesters[j];
      if (b.state === 'dead') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = 0.8;
      if (dist < minDist && dist > 0.01) {
        const push = (minDist - dist) * 0.3;
        const nx = dx / dist, ny = dy / dist;
        // Don't push miners who are actively mining
        if (a.state !== 'mining') { a.x -= nx * push; a.y -= ny * push; }
        if (b.state !== 'mining') { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  // Remove orphaned harvesters whose huts were destroyed
  state.harvesters = state.harvesters.filter(h => {
    const hutExists = state.buildings.some(b => b.id === h.hutId);
    if (!hutExists) {
      if (h.carryingDiamond) dropDiamond(state, h.x, h.y);
      return false;
    }
    return true;
  });

  for (const h of state.harvesters) {
    if (h.state === 'dead') {
      h.respawnTimer--;
      if (h.respawnTimer <= 0) {
        const hut = state.buildings.find(b => b.id === h.hutId);
        if (hut) {
          h.x = hut.worldX; h.y = hut.worldY;
          h.hp = h.maxHp; h.state = 'walking_to_node';
          h.carryingDiamond = false; h.carryingResource = null; h.carryAmount = 0;
          h.targetCellIdx = -1; h.fightTargetId = null; h.damage = 0;
        }
      }
      continue;
    }

    const movePerTick = 3 / TICK_RATE;

    if (h.assignment === HarvesterAssignment.Center) {
      tickCenterHarvester(state, h, movePerTick);
      continue;
    }

    if (h.state === 'walking_to_node') {
      const baseTarget = getResourceNodePosition(h);
      const target = findOpenMiningSpot(state, h, baseTarget);
      const dx = target.x - h.x, dy = target.y - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        h.state = 'mining';
        h.miningTimer = 2 * TICK_RATE;
      } else {
        h.x += (dx / dist) * movePerTick;
        h.y += (dy / dist) * movePerTick;
      }
    } else if (h.state === 'mining') {
      h.miningTimer--;
      if (h.miningTimer <= 0) {
        switch (h.assignment) {
          case HarvesterAssignment.BaseGold:
            h.carryingResource = ResourceType.Gold; h.carryAmount = 3; break;
          case HarvesterAssignment.Wood:
            h.carryingResource = ResourceType.Wood; h.carryAmount = 4; break;
          case HarvesterAssignment.Stone:
            h.carryingResource = ResourceType.Stone; h.carryAmount = 4; break;
        }
        h.state = 'walking_home';
      }
    } else if (h.state === 'walking_home') {
      walkHome(state, h, movePerTick);
    }
  }
}

function tickCenterHarvester(state: GameState, h: HarvesterState, movePerTick: number): void {
  if (h.carryingDiamond) {
    if (h.state !== 'walking_home') h.state = 'walking_home';
    walkHome(state, h, movePerTick);
    return;
  }

  const enemyCarrier = state.harvesters.find(
    eh => eh.team !== h.team && eh.carryingDiamond && eh.state !== 'dead'
  );
  if (enemyCarrier) {
    h.damage = 5;
    const dx = enemyCarrier.x - h.x, dy = enemyCarrier.y - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) {
      if (h.state !== 'fighting') h.state = 'fighting';
      h.fightTargetId = enemyCarrier.id;
      if (state.tick % TICK_RATE === 0) {
        enemyCarrier.hp -= h.damage;
        addFloatingText(state, enemyCarrier.x, enemyCarrier.y, `-${h.damage}`, '#ff8800');
        if (enemyCarrier.hp <= 0) {
          dropDiamond(state, enemyCarrier.x, enemyCarrier.y);
          killHarvester(enemyCarrier);
        }
      }
    } else {
      h.state = 'walking_to_node';
      h.x += (dx / dist) * movePerTick;
      h.y += (dy / dist) * movePerTick;
    }
    return;
  }

  h.damage = 0;

  if (state.diamond.exposed && (state.diamond.state === 'exposed' || state.diamond.state === 'dropped')) {
    const targetX = state.diamond.x;
    const targetY = state.diamond.y;
    const dx = targetX - h.x, dy = targetY - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1.5) {
      if (state.diamond.state === 'dropped') {
        h.carryingDiamond = true;
        state.diamond.state = 'carried';
        state.diamond.carrierId = h.id;
        state.diamond.carrierType = 'harvester';
        h.state = 'walking_home';
      } else if (h.state !== 'mining') {
        h.state = 'mining';
        h.miningTimer = 8 * TICK_RATE;
      } else {
        h.miningTimer--;
        if (h.miningTimer <= 0) {
          h.carryingDiamond = true;
          state.diamond.state = 'carried';
          state.diamond.carrierId = h.id;
          state.diamond.carrierType = 'harvester';
          h.state = 'walking_home';
        }
      }
    } else {
      h.state = 'walking_to_node';
      h.x += (dx / dist) * movePerTick;
      h.y += (dy / dist) * movePerTick;
    }
    return;
  }

  if (h.state === 'mining' && h.targetCellIdx >= 0) {
    const cell = state.diamondCells[h.targetCellIdx];
    if (cell && cell.gold > 0) {
      h.miningTimer--;
      if (h.miningTimer <= 0) {
        const mined = Math.min(GOLD_PER_CELL, cell.gold);
        cell.gold -= mined;
        h.carryingResource = ResourceType.Gold;
        h.carryAmount = mined;
        h.targetCellIdx = -1;
        h.state = 'walking_home';
      }
      return;
    } else {
      h.targetCellIdx = -1;
      h.state = 'walking_to_node';
    }
  }

  const cellIdx = findBestCellToMine(state.diamondCells, h.x, h.y);
  if (cellIdx < 0) {
    h.state = 'walking_to_node';
    return;
  }

  const cell = state.diamondCells[cellIdx];
  const dx = cell.tileX - h.x, dy = cell.tileY - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.5) {
    h.state = 'mining';
    h.targetCellIdx = cellIdx;
    h.miningTimer = 2 * TICK_RATE;
  } else {
    h.state = 'walking_to_node';
    h.x += (dx / dist) * movePerTick;
    h.y += (dy / dist) * movePerTick;
  }
}

function walkHome(state: GameState, h: HarvesterState, movePerTick: number): void {
  const hq = getHQPosition(h.team);
  const tx = hq.x + HQ_WIDTH / 2, ty = hq.y + HQ_HEIGHT / 2;
  const dx = tx - h.x, dy = ty - h.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    const player = state.players[h.playerId];
    if (h.carryingDiamond) {
      state.winner = h.team;
      state.winCondition = 'diamond';
      state.matchPhase = 'ended';
      return;
    }
    if (h.carryingResource === ResourceType.Gold) {
      player.gold += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}g`, '#ffd700');
    } else if (h.carryingResource === ResourceType.Wood) {
      player.wood += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}w`, '#4caf50');
    } else if (h.carryingResource === ResourceType.Stone) {
      player.stone += h.carryAmount;
      addFloatingText(state, h.x, h.y, `+${h.carryAmount}s`, '#9e9e9e');
    }
    h.carryingResource = null;
    h.carryAmount = 0;
    h.state = 'walking_to_node';
  } else {
    h.x += (dx / dist) * movePerTick;
    h.y += (dy / dist) * movePerTick;
  }
}

function getResourceNodePosition(h: HarvesterState): { x: number; y: number } {
  switch (h.assignment) {
    case HarvesterAssignment.BaseGold: {
      const hq = getHQPosition(h.team);
      return { x: hq.x + HQ_WIDTH / 2, y: h.team === Team.Bottom ? hq.y - 3 : hq.y + HQ_HEIGHT + 3 };
    }
    case HarvesterAssignment.Wood:
      return { x: 6, y: DIAMOND_CENTER_Y };
    case HarvesterAssignment.Stone:
      return { x: 74, y: DIAMOND_CENTER_Y };
    case HarvesterAssignment.Center:
      return { x: DIAMOND_CENTER_X, y: DIAMOND_CENTER_Y };
  }
}

function checkWinConditions(state: GameState): void {
  if (state.hqHp[Team.Bottom] <= 0) {
    state.winner = Team.Top; state.winCondition = 'military'; state.matchPhase = 'ended';
  } else if (state.hqHp[Team.Top] <= 0) {
    state.winner = Team.Bottom; state.winCondition = 'military'; state.matchPhase = 'ended';
  }
}
