export type SourceFile = { path: string; source: string }

const CONTEXT_MODULE = String.raw`['"][^'"]*/context(?:\.[jt]s)?['"]`
const NAMESPACE_IMPORT = new RegExp(String.raw`import\s*\*\s*as\s+\w+\s+from\s*` + CONTEXT_MODULE)
const DYNAMIC_IMPORT = new RegExp(String.raw`import\s*\(\s*` + CONTEXT_MODULE)
const EXPORT_ALL = new RegExp(String.raw`export\s*\*[^;\n]*from\s*` + CONTEXT_MODULE)
const MENTIONS_MINT = /\bmintTenantContext\b/
const EXPORTS_MINT = /export[^;\n]*\bmintTenantContext\b/

// A source-level guard, not a proof: it closes the bypasses a reviewer found
// (re-exports, namespace and dynamic imports, aliased re-exports from identity).
export function findMintViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = []
  for (const { path, source } of files) {
    if (path === 'src/lib/tenancy/context.ts') continue
    const code = stripComments(source)
    const flag = (reason: string) => violations.push(`${path}: ${reason}`)

    if (EXPORT_ALL.test(code)) flag('re-exports everything from the tenancy context module')
    if (path.startsWith('src/lib/identity/')) {
      if (EXPORTS_MINT.test(code)) flag('identity must not re-export mintTenantContext')
      continue
    }
    if (MENTIONS_MINT.test(code)) flag('references mintTenantContext; only src/lib/identity/** may mint tenant contexts')
    if (NAMESPACE_IMPORT.test(code)) flag('namespace-imports the tenancy context module; import named exports instead')
    if (DYNAMIC_IMPORT.test(code)) flag('dynamically imports the tenancy context module')
  }
  return violations
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
