import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const IMPORTS_MINT = /import[^;]*\bmintTenantContext\b[^;]*from/s

// Production sources only: tests mint fixtures on purpose.
function productionSources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !/\.test(-d)?\.ts$/.test(f))
    .map((f) => relative(ROOT, join(dir, f)))
}

describe('architecture', () => {
  it('only src/lib/identity/** may mint tenant contexts', () => {
    const importers = productionSources(join(ROOT, 'src')).filter((f) =>
      IMPORTS_MINT.test(readFileSync(join(ROOT, f), 'utf8')),
    )
    expect(importers.length, 'scan found no importer of mintTenantContext; the check is not working').toBeGreaterThan(0)
    for (const file of importers) {
      expect(
        file.startsWith('src/lib/identity/'),
        `${file} imports mintTenantContext; only src/lib/identity/** may mint tenant contexts`,
      ).toBe(true)
    }
  })
})
