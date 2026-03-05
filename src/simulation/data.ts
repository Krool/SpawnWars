import { BuildingType, Race, TICK_RATE } from './types';

// Building costs: { gold, wood, stone, hp }
export const BUILDING_COSTS: Record<BuildingType, { gold: number; wood: number; stone: number; hp: number }> = {
  [BuildingType.MeleeSpawner]: { gold: 100, wood: 0, stone: 0, hp: 300 },
  [BuildingType.RangedSpawner]: { gold: 120, wood: 10, stone: 0, hp: 250 },
  [BuildingType.CasterSpawner]: { gold: 150, wood: 15, stone: 10, hp: 200 },
  [BuildingType.Tower]: { gold: 200, wood: 0, stone: 25, hp: 200 },
  [BuildingType.HarvesterHut]: { gold: 50, wood: 0, stone: 0, hp: 150 },
};

// Escalating hut cost
export function HARVESTER_HUT_COST(hutIndex: number): number {
  return Math.floor(50 * Math.pow(1.35, hutIndex));
}

// Spawn interval in ticks
export const SPAWN_INTERVAL_TICKS = 10 * TICK_RATE; // 10 seconds

// Unit stats per race per building type
interface UnitStatDef {
  name: string;
  hp: number;
  damage: number;
  attackSpeed: number; // seconds
  moveSpeed: number; // tiles per second
  range: number; // tiles
  ascii: string; // display sprite
}

type RaceUnits = Partial<Record<BuildingType, UnitStatDef>>;

export const UNIT_STATS: Record<Race, RaceUnits> = {
  [Race.Surge]: {
    [BuildingType.MeleeSpawner]: {
      name: 'spark_blade', hp: 80, damage: 12, attackSpeed: 0.8, moveSpeed: 5, range: 1, ascii: '/>',
    },
    [BuildingType.RangedSpawner]: {
      name: 'arc_archer', hp: 50, damage: 10, attackSpeed: 1.2, moveSpeed: 4, range: 8, ascii: '~>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'storm_mage', hp: 40, damage: 18, attackSpeed: 2.0, moveSpeed: 3, range: 7, ascii: '{S}',
    },
  },
  [Race.Tide]: {
    [BuildingType.MeleeSpawner]: {
      name: 'wave_guard', hp: 110, damage: 8, attackSpeed: 1.0, moveSpeed: 3.5, range: 1, ascii: '|W|',
    },
    [BuildingType.RangedSpawner]: {
      name: 'bubble_shot', hp: 55, damage: 9, attackSpeed: 1.3, moveSpeed: 3.5, range: 7, ascii: 'o~',
    },
    [BuildingType.CasterSpawner]: {
      name: 'tidal_caller', hp: 45, damage: 14, attackSpeed: 2.2, moveSpeed: 3, range: 7, ascii: '{T}',
    },
  },
  [Race.Ember]: {
    [BuildingType.MeleeSpawner]: {
      name: 'flame_knight', hp: 70, damage: 15, attackSpeed: 0.9, moveSpeed: 4.5, range: 1, ascii: '/F\\',
    },
    [BuildingType.RangedSpawner]: {
      name: 'fire_archer', hp: 45, damage: 13, attackSpeed: 1.1, moveSpeed: 4, range: 8, ascii: '>>',
    },
    [BuildingType.CasterSpawner]: {
      name: 'inferno_mage', hp: 35, damage: 22, attackSpeed: 2.5, moveSpeed: 3, range: 6, ascii: '{I}',
    },
  },
  [Race.Bastion]: {
    [BuildingType.MeleeSpawner]: {
      name: 'stone_wall', hp: 150, damage: 6, attackSpeed: 1.2, moveSpeed: 2.5, range: 1, ascii: '[#]',
    },
    [BuildingType.RangedSpawner]: {
      name: 'rock_thrower', hp: 60, damage: 11, attackSpeed: 1.4, moveSpeed: 3, range: 7, ascii: '.o',
    },
    [BuildingType.CasterSpawner]: {
      name: 'earth_shaman', hp: 50, damage: 10, attackSpeed: 2.0, moveSpeed: 3, range: 6, ascii: '{E}',
    },
  },
};

// Tower stats per race
export const TOWER_STATS: Record<Race, { hp: number; damage: number; attackSpeed: number; range: number; ascii: string }> = {
  [Race.Surge]: { hp: 200, damage: 15, attackSpeed: 1.5, range: 9, ascii: '[Z]' },
  [Race.Tide]: { hp: 250, damage: 8, attackSpeed: 1.0, range: 7, ascii: '(@)' },
  [Race.Ember]: { hp: 180, damage: 20, attackSpeed: 1.8, range: 8, ascii: '<F>' },
  [Race.Bastion]: { hp: 350, damage: 10, attackSpeed: 1.5, range: 6, ascii: '[||]' },
};

// Race accent colors
export const RACE_COLORS: Record<Race, { primary: string; secondary: string }> = {
  [Race.Surge]: { primary: '#00e5ff', secondary: '#7c4dff' },
  [Race.Tide]: { primary: '#2979ff', secondary: '#00e676' },
  [Race.Ember]: { primary: '#ff5722', secondary: '#ffab00' },
  [Race.Bastion]: { primary: '#8d6e63', secondary: '#bdbdbd' },
};

// Player colors: Blue and Teal (bottom team) vs Red and Orange (top team)
export const PLAYER_COLORS: string[] = [
  '#2979ff',  // P0 - Blue
  '#00bfa5',  // P1 - Teal
  '#ff1744',  // P2 - Red
  '#ff9100',  // P3 - Orange
];
