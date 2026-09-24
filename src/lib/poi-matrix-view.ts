/** Transport shapes only. Evidence validation and selection stay on the server. */
export type MatrixPropertyView = { code:string; state:string; ageRange:{min:number;max:number}|null }
export type MatrixItemView = { id:string; poiId:string; state:'valid'|'missing'|'invalid'; properties:MatrixPropertyView[] }
export type MatrixSearchResult = { items:MatrixItemView[]; matchedIds:string[]; coverage:{valid:number;missing:number;invalid:number}; checkedAt:string }
export type MatrixQuery = {groups:{group:string;codes:string[];mode:'any'|'all'}[];childAges:number[]}
export type MatrixDetailView = {state:string;projection:{properties:(MatrixPropertyView & {factIds:string[];conditionFactIds:string[]})[]}|null;error:string|null}
export const MATRIX_STATE_LABELS:Record<string,string>={supported:'Подтверждено фактами',refuted:'Не подходит',unknown:'Не проверено',conflicting:'Есть противоречие',expired:'Нужна свежая проверка',unavailable:'Посещение недоступно'}
export type PlanningQuery = {spec:'poi-planning-query/v1';search:string;geography:{region:string;prefecture:string;city:string};required:MatrixQuery;preferred:string[];page:number;bucket:'matched'|'needsCheck'}
export const emptyPlanningQuery = (): PlanningQuery => ({spec:'poi-planning-query/v1',search:'',geography:{region:'all',prefecture:'all',city:'all'},required:{groups:[],childAges:[]},preferred:[],page:1,bucket:'matched'})
export type PlanningProfile = {spec:string;query:PlanningQuery;explanations:string[];notices:string[]}
