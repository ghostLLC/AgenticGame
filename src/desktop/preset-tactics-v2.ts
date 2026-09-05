/** Pure CommonJS source: pathfinding and aiming run entirely inside the guest interpreter. */
export function presetTacticSourceV2(style: 'scout' | 'medium' | 'heavy'): string {
  return `module.exports = function createTank(ctx) {
    const style = ${JSON.stringify(style)};
    const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    const walls = new Set(ctx.terrainCells.filter(c => c.terrainId === 'wall').map(c => c.x + ',' + c.y));
    const inside = (x,y) => x >= 0 && y >= 0 && x < ctx.field.width && y < ctx.field.height && !walls.has(x+','+y);
    const direction = (dx,dy) => (Math.round(Math.atan2(dx,-dy) / (Math.PI/4)) + 8) % 8;
    const turn = (from,to) => { const d = (to-from+12)%8-4; return Math.sign(d); };
    const zone = ctx.captureZones[0];
    function clearShot(x,y,enemy) {
      const dx = enemy.x-x, dy = enemy.y-y, distance = Math.max(Math.abs(dx),Math.abs(dy));
      if (!distance || distance > ctx.weapon.rangeCells || (dx && dy && Math.abs(dx) !== Math.abs(dy))) return false;
      for (let i=1;i<distance;i++) if (walls.has((x+Math.sign(dx)*i)+','+(y+Math.sign(dy)*i))) return false;
      return true;
    }
    function nextStep(self, enemy, goal) {
      const queue = [{x:self.x,y:self.y,first:null}], seen = new Set([self.x+','+self.y]);
      for (let head=0;head<queue.length;head++) {
        const cell=queue[head]; if (goal(cell.x,cell.y)) return cell.first;
        for (let d=0;d<8;d++) {
          const x=cell.x+dirs[d][0],y=cell.y+dirs[d][1],key=x+','+y;
          if (!inside(x,y) || seen.has(key) || (enemy && x===enemy.x && y===enemy.y)) continue;
          seen.add(key); queue.push({x,y,first:cell.first === null ? d : cell.first});
        }
      }
      return null;
    }
    return { name: style + ' field tactic', onTick(view) {
      const self=view.self, enemy=view.visibleEnemies[0];
      const inZone = (x,y) => zone && x>=zone.x && x<zone.x+zone.width && y>=zone.y && y<zone.y+zone.height;
      let goal;
      if (ctx.modeId === 'capture' && zone) goal=inZone;
      else if (enemy) goal=(x,y) => clearShot(x,y,enemy) && (style!=='medium' || Math.max(Math.abs(enemy.x-x),Math.abs(enemy.y-y))<=6);
      else {
        const waypoints=[[Math.floor(ctx.field.width/2),Math.floor(ctx.field.height/2)], [Math.floor(ctx.field.width*0.75),Math.floor(ctx.field.height/2)], [Math.floor(ctx.field.width*0.25),Math.floor(ctx.field.height/2)]];
        const target=waypoints[Math.floor(view.tick/24)%waypoints.length];
        goal=(x,y) => x===target[0] && y===target[1];
      }
      const next=nextStep(self,enemy,goal);
      const aim=enemy ? direction(enemy.x-self.x,enemy.y-self.y) : self.turretDirection;
      const turretTurn=enemy ? turn(self.turretDirection,aim) : 0;
      const bodyTurn=next===null ? (enemy && style==='heavy' ? turn(self.bodyDirection,aim) : 0) : turn(self.bodyDirection,next);
      const fire=!!enemy && clearShot(self.x,self.y,enemy) && self.turretDirection===aim;
      return { throttle: next!==null && bodyTurn===0 ? 1 : 0, bodyTurn, turretTurn, fire };
    }};
  };`;
}
