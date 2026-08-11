/**
 * Проба импорта loader’а по алиасу `@/`.
 *
 * Что она доказывает — ровно две вещи, и обе компиляционные: файл с таким
 * импортом компилируется, и алиас `@/lib/poi-taxonomy` разрешается по paths
 * из tsconfig. Ничего больше. Проверено обратным ходом: если убрать модуль,
 * typecheck падает с TS2307, а если сломать тип аргумента — с TS2322.
 *
 * Чего она НЕ доказывает: работоспособность в рантайме Next и совместимость
 * его сборщика — в частности, как сборщик обойдётся с атрибутом импорта JSON.
 * Это выяснится, когда loader впервые войдёт в граф Next у настоящего
 * потребителя; временный production-route ради теста заводить не будем.
 *
 * Рантайм этой пробы не запускается: node алиас `@/` не резолвит. Рантайм-проба
 * того же модуля живёт в tests/poi-taxonomy-loader.mjs и импортирует его
 * относительным путём.
 *
 * Значения ниже берутся из реестра, а не пишутся руками, — по тому же правилу,
 * что и в самом loader’е.
 */
import {
  assertTaxonomyInvariants,
  autoImportAllowed,
  badgeOptions,
  defaultLanguage,
  entityKindCodes,
  facetOptions,
  languages,
  poiTypeLabel,
  poiTypeOptions,
  resolveRoute,
  taxonomy,
  taxonomyVersion,
  typeStateOf,
  type LabelledOption,
  type PoiTypeOption,
  type RouteDecision,
  type TaxonomyRegistry,
} from '@/lib/poi-taxonomy'

export interface TaxonomyProbe {
  readonly version: string
  readonly languages: readonly string[]
  readonly typeCount: number
  readonly facetCount: number
  readonly badgeCount: number
  readonly firstTypeLabel: string
  readonly firstTypeState: string
  readonly firstTypeAutoImport: boolean
  readonly firstRoute: RouteDecision
}

/**
 * Дёргает каждую группу экспортов ровно один раз. Тело намеренно скучное:
 * задача — заставить компилятор проверить типы всех точек входа, а не что-то
 * посчитать.
 */
export function probeTaxonomyFromNextContext(): TaxonomyProbe {
  assertTaxonomyInvariants()

  const registry: TaxonomyRegistry = taxonomy
  const types: readonly PoiTypeOption[] = poiTypeOptions(defaultLanguage)
  const facets: readonly LabelledOption[] = facetOptions(defaultLanguage)
  const badges: readonly LabelledOption[] = badgeOptions(defaultLanguage)

  const firstType = types[0]
  const firstRoute = resolveRoute({
    entityKind: entityKindCodes[0],
    poiPrimaryType: firstType.code,
    classificationSource: registry.routingPolicy[0].classificationSource,
  })

  return {
    version: taxonomyVersion,
    languages,
    typeCount: types.length,
    facetCount: facets.length,
    badgeCount: badges.length,
    firstTypeLabel: poiTypeLabel(firstType.code, defaultLanguage),
    firstTypeState: typeStateOf(firstType.code),
    firstTypeAutoImport: autoImportAllowed(firstType.code),
    firstRoute,
  }
}
