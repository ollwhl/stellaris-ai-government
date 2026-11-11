import {domainOwner} from '../../../integrations/game_mcp/registry.js';
import type {Project, Role} from '../../../contracts/index.ts';

export function projectOwner(kind:Project['kind'],scope:Project['scope']={}):Role {
  return kind==='research'?'development':kind==='construction'?'economy':kind==='defense'||kind==='fleet'?'military':domainOwner(scope.domain??'state');
}

function canonical(value:any):any {
  if(Array.isArray(value))return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}

// Match business targets, never a department's entire project kind.
export function projectKey(p:Pick<Project,'kind'|'scope'>):string {
  const s=p.scope;
  const target=p.kind==='research'?{area:typeof s.area==='number'?['physics','society','engineering'][s.area]:s.area??'*'}:
    p.kind==='construction'?{planetIds:s.planetIds??[],buildingPreference:[s.buildingPreference??''].flat()}:
    p.kind==='defense'?{fleetIds:s.fleetIds??[]}:p.kind==='fleet'?{mission:s.mission,fleetIds:s.fleetIds,targetSystemId:s.targetSystemId,targetFleetId:s.targetFleetId,targetPlanetId:s.targetPlanetId,rallySystemId:s.rallySystemId,homeSystemId:s.homeSystemId}:s;
  return `${p.kind}:${JSON.stringify(canonical(target))}`;
}
