import type {DemoSeedPlan} from '../types.ts';
import {buildFoundationPlan} from './foundation.ts';
import {buildBusinessGraphPlan} from './businessGraph.ts';
export function buildCompleteDemoPlan(authUid:string):DemoSeedPlan{const foundation=buildFoundationPlan(authUid);const graph=buildBusinessGraphPlan();return{documents:[...foundation.documents,...graph.documents],references:[...foundation.references,...graph.references]}}