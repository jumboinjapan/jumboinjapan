/** Transport shapes only. Evidence validation and selection stay on the server. */
export type MatrixPropertyView = { code:string; state:string; ageRange:{min:number;max:number}|null }
export type MatrixItemView = { id:string; poiId:string; state:'valid'|'missing'|'invalid'; properties:MatrixPropertyView[] }
export type MatrixSearchResult = { items:MatrixItemView[]; matchedIds:string[]; coverage:{valid:number;missing:number;invalid:number}; checkedAt:string }
export type MatrixQuery = {groups:{group:string;codes:string[];mode:'any'|'all'}[];childAges:number[]}
export type MatrixDetailView = {state:string;projection:{properties:(MatrixPropertyView & {factIds:string[];conditionFactIds:string[]})[]}|null;error:string|null}
export const MATRIX_STATE_LABELS:Record<string,string>={supported:'Подтверждено фактами',refuted:'Не подходит',unknown:'Не проверено',conflicting:'Есть противоречие',expired:'Нужна свежая проверка',unavailable:'Посещение недоступно'}
