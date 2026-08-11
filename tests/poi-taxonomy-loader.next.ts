/**
 * Проба импорта loader’а из TypeScript/Next-контекста.
 *
 * Смысл файла — путь импорта, а не поведение: `@/lib/poi-taxonomy` резолвится
 * только через paths из tsconfig и через сборку Next; node такой путь не знает
 * и знать не должен. Поэтому доказательство здесь компиляционное: tsconfig
 * включает все файлы .ts, значит файл входит в `npm run typecheck` — и если
 * алиас, атрибут импорта JSON или типы разъедутся, падает typecheck,
 * а не production.
 *
 * Рантайм-проба того же модуля из node живёт в tests/poi-taxonomy-loader.mjs
 * и импортирует его относительным путём. Вместе они закрывают оба рантайма.
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
