import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findMintViolations, type SourceFile } from './helpers/mint-guard'

const ROOT = join(import.meta.dirname, '..')

// Production sources only: tests mint fixtures on purpose.
function productionSources(): SourceFile[] {
  return readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !/\.test(-d)?\.ts$/.test(f))
    .map((f) => {
      const path = relative(ROOT, join(ROOT, 'src', f))
      return { path, source: readFileSync(join(ROOT, path), 'utf8') }
    })
}

describe('architecture', () => {
  it('only src/lib/identity/** may mint tenant contexts', () => {
    const files = productionSources()
    expect(files.some((f) => f.path === 'src/lib/identity/jwt-authenticator.ts'), 'scan is not reading src').toBe(true)
    expect(findMintViolations(files)).toEqual([])
  })
})

describe('mint guard', () => {
  const at = (path: string, source: string) => findMintViolations([{ path, source }])
  const outside = 'src/lib/offers/x.ts'

  it.each([
    ['a named import', `import { mintTenantContext } from '../tenancy/context'`],
    ['a re-export', `export { mintTenantContext } from '../tenancy/context'`],
    ['a namespace import', `import * as c from '../tenancy/context'\nc.mintTenantContext()`],
    ['a namespace import used by bracket access', `import * as c from '../tenancy/context'\nc['mint' + 'TenantContext']()`],
    ['a dynamic import', `const m = await import('../tenancy/context')`],
    ['an export-all', `export * from '../tenancy/context'`],
  ])('flags %s outside identity', (_name, source) => {
    expect(at(outside, source)).not.toEqual([])
  })

  it('flags identity re-exporting the mint, even under an alias', () => {
    expect(at('src/lib/identity/index.ts', `export { mintTenantContext as mk } from '../tenancy/context'`)).not.toEqual([])
    expect(at('src/lib/identity/index.ts', `import { mintTenantContext } from '../tenancy/context'\nexport { mintTenantContext as mk }`)).not.toEqual([])
  })

  it('allows identity to import and use the mint', () => {
    expect(at('src/lib/identity/a.ts', `import { mintTenantContext } from '../tenancy/context'\nmintTenantContext('tenant0', 'u', s)`)).toEqual([])
  })

  it('allows type-only and named non-mint imports of the context module', () => {
    expect(at(outside, `import { isTenantContext, type TenantContext } from '../tenancy/context'`)).toEqual([])
  })

  it('ignores the name in comments', () => {
    expect(at(outside, `// mintTenantContext lives in identity\nimport { x } from './y'`)).toEqual([])
  })
})
