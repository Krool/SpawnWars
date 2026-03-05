import { Game } from './game/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

const game = new Game(canvas);
game.start();

console.log('ASCII Wars started');
console.log('Controls:');
console.log('  1-5: Select building (Melee, Ranged, Caster, Tower, Hut)');
console.log('  Click: Place building / Click hut to cycle assignment');
console.log('  Right-click: Cancel build mode / Sell building');
console.log('  L: Toggle all lanes');
console.log('  N: Fire nuke (click to target)');
console.log('  WASD/Arrows: Pan camera');
console.log('  Scroll: Zoom');
console.log('  Mouse drag: Pan camera');
