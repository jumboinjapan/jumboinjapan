#!/usr/bin/env node
import { readRouteRegistry } from '../../src/lib/route-registry-store.ts'
import { isPublicRoute, isIndexableRoute, CONTENT_KINDS, ROUTE_STATUSES } from '../../src/lib/route-publication.ts'
const routes = await readRouteRegistry()
const issues = routes.flatMap(r => [
  ...(!CONTENT_KINDS.includes(r.contentKind) ? [`${r.slug}: unknown kind ${r.contentKind}`] : []),
  ...(!ROUTE_STATUSES.includes(r.status) ? [`${r.slug}: unknown status ${r.status}`] : []),
  ...(r.status === 'Published' && !isPublicRoute(r) ? [`${r.slug}: ${r.issues.join('; ')}`] : []),
])
console.log(JSON.stringify({ total: routes.length, published: routes.filter(r => isPublicRoute(r)).map(r => ({ slug: r.slug, kind: r.contentKind })), indexable: routes.filter(isIndexableRoute).map(r => r.slug), issues }, null, 2))
if (issues.length) process.exitCode = 1
