import type {DemoSeedPlan} from '../types.js';
import {buildFoundationPlan} from './foundation.js';
import {buildBusinessGraphPlan} from './businessGraph.js';
export function buildCompleteDemoPlan(authUid:string):DemoSeedPlan{const foundation=buildFoundationPlan(authUid);const graph=buildBusinessGraphPlan();return{documents:[...foundation.documents,...graph.documents],references:[...foundation.references,...graph.references]}}