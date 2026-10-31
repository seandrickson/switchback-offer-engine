# Tenant-Isolation Guardrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task follows superpowers:test-driven-development: write the test, watch it fail for the stated reason, write the minimal code, watch it pass, commit.

**Goal:** Build a small offers service in which a Switchback-exclusive offer can never reach a tenant-0 user. It is enforced by unforgeable tenant contexts, tenant-parameterised types and a fail-closed output gate, and proven by runtime, type-level and HTTP tests.

**Architecture:**
- Only `src/lib/identity/` can mint a `TenantContext<T>`, from a JWT verified with `jose`.
- `getOffers` runs a fixed pipeline: catalog → eligibility → pricing join → isolation gate → response.
- Fastify wires it together in-process (`buildApp`). Tests use `inject()` and never listen on a port.

**Tech Stack:**
- Node 26 LTS, TypeScript 7 (strict, ESM)
- Fastify 5, jose 6
- Vitest 5, with `--typecheck` for `*.test-d.ts`

**Spec:** `docs/superpowers/specs/2026-10-31-tenant-isolation-guardrail-design.md`

## Global Constraints

- Node `>=26`; `.nvmrc` contains `26`; CI uses `node-version-file: .nvmrc`.
- `"type": "module"`. tsconfig: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: "preserve"`, `moduleResolution: "bundler"`, `noEmit`, `include: ["src", "test", "vitest.config.ts"]`, `skipLibCheck: true` (needed: Fastify's transitive `thread-stream` types fail under current `@types/node`).
- Runtime dependencies: `fastify`, `jose` only. Dev dependencies: `typescript`, `vitest`, `@types/node`. No React or Next.js, no `fastify-plugin`, no ESLint.
- `npm test` = `tsc --noEmit && vitest run --typecheck`. It must pass on a clean checkout.
- Tenants: exactly `'tenant0' | 'switchback'`. Exclusive tenants: exactly `'switchback'`.
- Only `src/lib/identity/**` may import `mintTenantContext` (enforced in Task 5).
- JWT verification: `algorithms: ['RS256']`, issuer and audience pinned per issuer, `requiredClaims: ['sub', 'exp']`, `currentDate` from the injected clock. Every failure returns `null` and never throws.
- The tenant is the issuer's configured tenant. A `tenant` claim, if present, must equal it.
- 401 body: `{ "error": "unauthorized" }`. 503 body: `{ "error": "pricing_unavailable" }`. 500 body: `{ "error": "internal" }`. No reason details in any of them.
- Test clock: `FIXED_NOW = new Date('2026-10-31T12:00:00.000Z')`.
- Commit messages end with the session's Co-Authored-By and Claude-Session trailers.

## Review Focus

1. **A validly signed token with no `exp` or no `sub`.** jose does not require `exp` by default, so a non-expiring token would be accepted for ever. Expected: `null`. Test added to Task 5.
2. **A malformed `Authorization` header** (`Basic x`, `Bearer` with no token, an empty header, a non-JWT string). Expected: `null` and a 401, never a thrown error and a 500. Tests added to Task 5.
3. **Pricing returns two quotes for the same offer id**, or a quote whose `expiresAt` equals `now()` exactly. Expected: the offer appears once, and a quote expiring exactly now is treated as expired. Tests added to Task 4.
4. **The pricing client rejects (timeout or 5xx).** Expected: 503 `pricing_unavailable` with no `offers` key, not a 500 with a stack trace. Test added to Task 6.
5. **An authenticator that returns a forged context** (a bug in a future auth scheme). Expected: the gate throws and the HTTP response is 500 `{ "error": "internal" }`, with no offers and no error message leaked. Test added to Task 6.

---

### Task 1: Project scaffold and unforgeable `TenantContext`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`, `.github/workflows/ci.yml`
- Create: `src/lib/tenancy/tenant.ts`, `src/lib/tenancy/context.ts`
- Test: `src/lib/tenancy/context.test.ts`

**Interfaces:**
- Produces:
  - `type TenantId = 'tenant0' | 'switchback'`
  - `type ExclusiveTenant = 'switchback'`
  - `function assertNever(x: never): never`, which throws `Error('Unhandled tenant: ' + String(x))`
  - `type Signals = { tenureMonths: number; region: string }`
  - `class TenantContext<T extends TenantId>`, with readonly getters `tenant: T`, `userId: string`, `signals: Signals`. Its constructor is `(token: symbol, tenant: T, userId: string, signals: Signals)`.
  - `function mintTenantContext<T extends TenantId>(tenant: T, userId: string, signals: Signals): TenantContext<T>`
  - `function isTenantContext(x: unknown): x is TenantContext<TenantId>`

- [ ] **Step 1: Scaffold the project.** Use the Global Constraints values. Scripts are `"typecheck": "tsc --noEmit"` and `"test": "npm run typecheck && vitest run --typecheck"`, with `engines.node: ">=26"`. `vitest.config.ts` sets `test.typecheck.include: ['src/**/*.test-d.ts']` and `test.include: ['src/**/*.test.ts', 'test/**/*.test.ts']`. The CI workflow runs on `push` and `pull_request` with checkout, setup-node from `.nvmrc` and `cache: npm`, then `npm ci` and `npm test`. Run `npm install fastify jose` and `npm install -D typescript vitest @types/node`, and commit `package-lock.json`.

- [ ] **Step 2: Write the failing tests** in `context.test.ts`:

```ts
const signals = { tenureMonths: 6, region: 'US' }

it('mints a context carrying tenant, userId and signals', () => {
  const ctx = mintTenantContext('switchback', 'u-1', signals)
  expect(ctx.tenant).toBe('switchback')
  expect(ctx.userId).toBe('u-1')
  expect(ctx.signals).toEqual(signals)
  expect(isTenantContext(ctx)).toBe(true)
})

it('cannot be constructed without the identity mint token', () => {
  expect(() => new TenantContext(Symbol('forged'), 'switchback', 'u-1', signals)).toThrow(/identity layer/)
})

it('rejects look-alike objects at runtime', () => {
  for (const x of [{ tenant: 'switchback', userId: 'u-1', signals }, null, undefined, 'switchback', 42]) {
    expect(isTenantContext(x)).toBe(false)
  }
})
```

- [ ] **Step 3: Run** `npx vitest run src/lib/tenancy`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `tenant.ts` and `context.ts`.**
  - The mint token is `const MINT: unique symbol = Symbol('TenantContext.mint')`. It isn't exported.
  - The constructor throws `Error('TenantContext can only be minted by the identity layer')` when `token !== MINT`.
  - The tenant is stored in an ES `#tenant` field. `isTenantContext` returns `typeof x === 'object' && x !== null && #tenant in x`.

- [ ] **Step 5: Run** `npm test`. Expected: PASS, with tsc clean.

- [ ] **Step 6: Commit:** `feat(tenancy): unforgeable TenantContext with project scaffold and CI`.

---

### Task 2: Offer types and tenant-scoped catalog

**Files:**
- Create: `src/lib/offers/types.ts`, `src/lib/offers/catalog.ts`
- Test: `src/lib/offers/types.test-d.ts`, `src/lib/offers/catalog.test.ts`

**Interfaces:**
- Consumes: `TenantId`, `ExclusiveTenant`, `Signals`, `TenantContext`, `assertNever` (Task 1).
- Produces:
  - `type Product = 'hysa' | 'ewa'`
  - `type Rate = { apy: number } | { feeCents: number }`
  - `type OfferScope = { kind: 'baseline' } | { kind: 'exclusive'; tenant: ExclusiveTenant }`
  - `type BaselineOffer = { id: string; product: Product; scope: { kind: 'baseline' }; eligible: (s: Signals) => boolean }`
  - `type ExclusiveOffer<T extends TenantId> = T extends ExclusiveTenant ? { id: string; product: Product; scope: { kind: 'exclusive'; tenant: T }; eligible: (s: Signals) => boolean } : never`
  - `type OfferFor<T extends TenantId> = BaselineOffer | ExclusiveOffer<T>`
  - `type PricedOffer<T extends TenantId> = OfferFor<T> & { rate: Rate; expiresAt: Date }`
  - `const BASELINE_OFFERS: readonly BaselineOffer[]`
  - `const SWITCHBACK_EXCLUSIVE_OFFERS: readonly ExclusiveOffer<'switchback'>[]`
  - `function catalogFor<T extends TenantId>(ctx: TenantContext<T>): OfferFor<T>[]`
- Catalog values, which later tasks' tests use:

  | id | product | scope | eligible when |
  |---|---|---|---|
  | `hysa-baseline` | hysa | baseline | always |
  | `ewa-baseline` | ewa | baseline | `tenureMonths >= 3` |
  | `hysa-switchback-plus` | hysa | exclusive switchback | `tenureMonths >= 1` |
  | `ewa-switchback-zero-fee` | ewa | exclusive switchback | `region === 'US'` |

- [ ] **Step 1: Write the failing type tests** in `types.test-d.ts`:

```ts
test('tenant0 can only ever hold baseline offers', () => {
  expectTypeOf<OfferFor<'tenant0'>>().toEqualTypeOf<BaselineOffer>()
  expectTypeOf<ExclusiveOffer<'tenant0'>>().toBeNever()
})

test('a Switchback exclusive cannot be placed in a tenant0 offer list', () => {
  const exclusive = SWITCHBACK_EXCLUSIVE_OFFERS[0]!
  // @ts-expect-error — Switchback-exclusive offer is not assignable to tenant0
  const leaked: OfferFor<'tenant0'>[] = [exclusive]
  void leaked
})

test('catalogFor is typed by the context tenant', () => {
  expectTypeOf(catalogFor<'tenant0'>).returns.toEqualTypeOf<BaselineOffer[]>()
  expectTypeOf(catalogFor<'switchback'>).returns.toEqualTypeOf<OfferFor<'switchback'>[]>()
})
```

- [ ] **Step 2: Write the failing runtime tests** in `catalog.test.ts`:
  - `catalogFor(mintTenantContext('tenant0', …))` gives ids exactly `['hysa-baseline', 'ewa-baseline']`, and every `scope.kind` is `'baseline'`.
  - `catalogFor(mintTenantContext('switchback', …))` gives ids containing all four, and every exclusive has `scope.tenant === 'switchback'`.
  - Offer ids are unique across `BASELINE_OFFERS` and `SWITCHBACK_EXCLUSIVE_OFFERS` (`new Set(ids).size === ids.length`).

- [ ] **Step 3: Run** `npm test`. Expected: FAIL (modules missing, and the type tests fail).

- [ ] **Step 4: Implement `types.ts` and `catalog.ts`.**
  - `catalogFor` uses `switch (ctx.tenant)`, with `default: return assertNever(ctx.tenant)`.
  - TypeScript doesn't narrow the generic `T` from the switch, so each branch returns `as OfferFor<T>[]`. The type tests in Step 1 are what make this cast safe. Add a one-line comment saying so.
  - Exported arrays are `Object.freeze`d.

- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Mutation check.** Temporarily change the `tenant0` branch to also return `SWITCHBACK_EXCLUSIVE_OFFERS`. Confirm the runtime test fails and names `hysa-switchback-plus`, then revert.

- [ ] **Step 7: Commit:** `feat(offers): tenant-parameterised offer types and catalog`.

---

### Task 3: Fail-closed isolation gate and breach reporter

**Files:**
- Create: `src/lib/observability/breach.ts`, `src/lib/offers/gate.ts`
- Test: `src/lib/offers/gate.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `isTenantContext`, `TenantId` (Task 1); `PricedOffer`, catalog constants (Task 2).
- Produces:
  - `type TenantIsolationBreach = { requestTenant: TenantId; offerId: string; offerScope: unknown }`
  - `interface BreachReporter { report(e: TenantIsolationBreach): void }`
  - `class TenantIsolationError extends Error`
  - `function enforceTenantIsolation<T extends TenantId>(ctx: TenantContext<T>, offers: readonly PricedOffer<TenantId>[], reporter: BreachReporter): PricedOffer<T>[]`. The input type is deliberately wide because the input is untrusted at runtime.

- [ ] **Step 1: Write the failing tests.** A helper `priced(offer)` adds `{ rate: { apy: 4 }, expiresAt: new Date('2026-10-31T12:15:00Z') }`, and `reporter = { report: vi.fn() }`.

```ts
it('BREACH: drops a Switchback-exclusive offer for a tenant0 user and keeps baseline', () => {
  const ctx = mintTenantContext('tenant0', 'u-0', { tenureMonths: 12, region: 'US' })
  const out = enforceTenantIsolation(ctx, [priced(hysaBaseline), priced(hysaSwitchbackPlus)], reporter)
  expect(out.map((o) => o.id)).toEqual(['hysa-baseline'])
  expect(reporter.report).toHaveBeenCalledTimes(1)
  expect(reporter.report).toHaveBeenCalledWith({
    requestTenant: 'tenant0', offerId: 'hysa-switchback-plus',
    offerScope: { kind: 'exclusive', tenant: 'switchback' },
  })
})

it('fails closed on an unknown scope kind', () => {
  // the `as never` cast simulates bad runtime data that slipped past the types
  const rogue = { ...priced(hysaBaseline), id: 'rogue', scope: { kind: 'partner' } } as never
  const out = enforceTenantIsolation(switchbackCtx, [rogue, priced(hysaBaseline)], reporter)
  expect(out.map((o) => o.id)).toEqual(['hysa-baseline'])
  expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ offerId: 'rogue' }))
})

it('throws on a forged context', () => {
  const forged = { tenant: 'switchback', userId: 'x', signals: {} } as never
  expect(() => enforceTenantIsolation(forged, [priced(hysaBaseline)], reporter)).toThrow(TenantIsolationError)
})

it('passes Switchback exclusives to Switchback users without reporting', () => {
  const out = enforceTenantIsolation(switchbackCtx, [priced(hysaBaseline), priced(hysaSwitchbackPlus)], reporter)
  expect(out.map((o) => o.id)).toEqual(['hysa-baseline', 'hysa-switchback-plus'])
  expect(reporter.report).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** `npx vitest run src/lib/offers/gate.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `breach.ts` and `gate.ts`.**
  - Check `isTenantContext` first, and throw `TenantIsolationError('Untrusted tenant context reached the isolation gate')`.
  - The allow rule is exactly `scope.kind === 'baseline' || (scope.kind === 'exclusive' && scope.tenant === ctx.tenant)`. Everything else is dropped and reported.
  - The result is cast `as PricedOffer<T>[]` after filtering, with a comment that the runtime check is what justifies it.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Replace the filter's predicate with `() => true`. Confirm the BREACH test fails with `hysa-switchback-plus` in the diff, then revert. Record the failure output for `DECISIONS.md` (Task 7).

- [ ] **Step 6: Commit:** `feat(offers): fail-closed tenant isolation gate with breach reporting`.

---

### Task 4: Pricing contract and `getOffers` pipeline

**Files:**
- Create: `src/lib/pricing/client.ts`, `src/lib/offers/get-offers.ts`, `test/helpers/clock.ts` (exports `FIXED_NOW`)
- Test: `src/lib/offers/get-offers.test.ts`

**Interfaces:**
- Consumes: `catalogFor`, `PricedOffer`, `Rate`, `Product` (Task 2); `enforceTenantIsolation`, `BreachReporter` (Task 3).
- Produces:
  - `type Quote = { offerId: string; rate: Rate; expiresAt: Date }`
  - `interface PricingClient { quote(tenant: TenantId, offerIds: readonly string[]): Promise<Quote[]> }`
  - `type OffersDeps = { pricing: PricingClient; reporter: BreachReporter; now: () => Date }`
  - `type OfferView = { id: string; product: Product; kind: 'baseline' | 'exclusive'; rate: Rate; expiresAt: string }`
  - `type OffersResponse = { generatedAt: string; count: number; offers: OfferView[] }`
  - `class PricingUnavailableError extends Error`
  - `function getOffers<T extends TenantId>(ctx: TenantContext<T>, deps: OffersDeps): Promise<OffersResponse>`. If `pricing.quote` rejects, it rejects with `PricingUnavailableError` (original as `cause`); the route maps that to 503.

- [ ] **Step 1: Write the failing tests.**
  - The test `pricing` is a `vi.fn` that by default returns a quote for every requested id (`expiresAt = FIXED_NOW + 15 min`). `now = () => FIXED_NOW`.
  - Contexts:
    - `t0` is tenant0 with `{ tenureMonths: 12, region: 'US' }`.
    - `sb` is switchback with `{ tenureMonths: 12, region: 'US' }`.
    - `sbNew` is switchback with `{ tenureMonths: 0, region: 'CA' }`.

  1. `'pricing cannot add an offer: rogue quotes for exclusive ids are ignored for tenant0'`
     - The pricing mock returns quotes for all four catalog ids regardless of input.
     - `ids` = `['hysa-baseline', 'ewa-baseline']` and `not.toContain('hysa-switchback-plus')`.
     - `pricing.quote` was called with `('tenant0', ['hysa-baseline', 'ewa-baseline'])`.
     - The reporter was not called. The join stops the leak before it reaches the gate.
  2. `'only eligible offers are priced'`: for `sbNew`, pricing is called with exactly `['hysa-baseline']`.
  3. `'offers without a quote are omitted'`: the mock omits `ewa-baseline`, so the output for `t0` is `['hysa-baseline']`.
  4. `'expired quotes are omitted, including one expiring exactly now'`: `ewa-baseline` gets `expiresAt = FIXED_NOW`, so it's omitted.
  5. `'duplicate quotes do not duplicate an offer'`: two quotes for `hysa-baseline`, so it appears once. The first quote wins.
  6. `'response shape'`: for `sb`, `generatedAt === '2026-10-31T12:00:00.000Z'`, `count === offers.length === 4`, each `expiresAt === '2026-10-31T12:15:00.000Z'`, `kind` reflects the scope, and no `eligible` or `scope` key leaks into `OfferView`.
  7. `'rejects when pricing is unavailable'`: `quote` rejects, so `await expect(getOffers(...)).rejects.toBeInstanceOf(PricingUnavailableError)`.

- [ ] **Step 2: Run** `npx vitest run src/lib/offers/get-offers.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `client.ts` and `get-offers.ts`.** The order is fixed: catalog → `eligible(ctx.signals)` → `quote` → join → gate → view.
  - The join iterates over **the selected offers** and looks up the first matching quote by `offerId`. It never iterates over quotes, which is the key invariant.
  - A quote counts only if `expiresAt > now()`.
  - Call `now()` once per request and use that value for both the expiry check and `generatedAt`.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Rewrite the join to iterate over quotes, building offers from the whole catalog. Confirm test 1 fails with `hysa-switchback-plus`, then revert. Record the output for `DECISIONS.md`.

- [ ] **Step 6: Commit:** `feat(offers): getOffers pipeline with pricing contract`.

---

### Task 5: JWT authenticator (sole minter) and architecture test

**Files:**
- Create: `src/lib/identity/authenticator.ts`, `src/lib/identity/jwt-authenticator.ts`
- Create: `test/helpers/tokens.ts`
- Test: `src/lib/identity/jwt-authenticator.test.ts`, `test/architecture.test.ts`

**Interfaces:**
- Consumes: `mintTenantContext`, `TenantContext`, `TenantId`, `Signals` (Task 1).
- Produces:
  - `type AuthRequest = { headers: Record<string, string | string[] | undefined> }`
  - `interface Authenticator { authenticate(req: AuthRequest): Promise<TenantContext<TenantId> | null> }`
  - `type IssuerConfig = { issuer: string; audience: string; tenant: TenantId; publicKey: CryptoKey }`
  - `function createJwtAuthenticator(opts: { issuers: readonly IssuerConfig[]; now: () => Date }): Authenticator`
  - Test helpers (`tokens.ts`, which imports `FIXED_NOW` from `test/helpers/clock.ts`):
    - `makeTestIssuers(): Promise<{ issuers: IssuerConfig[]; sign(tenant: TenantId, claims?: JWTPayload, opts?: { expiresIn?: string; omitExp?: boolean; omitSub?: boolean }): Promise<string> }>`
    - Switchback issuer `https://sso.switchback.example`; tenant0 issuer `https://auth.tenant0.example`; audience `offers-service` for both.
    - `sign` uses `iat = FIXED_NOW`, a default `exp` of `FIXED_NOW + 5m` and a default `sub` of `'user-1'`.
- Claim mapping:
  - `sub` → `userId`.
  - `tenure_months` → `tenureMonths` if it's a non-negative integer, else `0`.
  - `region` → `region` if it's a non-empty string, else `'unknown'`.

- [ ] **Step 1: Write the failing authenticator tests.** Each case calls `authenticate({ headers: { authorization } })`.
  - Valid Switchback token with `{ tenure_months: 6, region: 'US' }` → `isTenantContext` is true, `tenant === 'switchback'`, `userId === 'user-1'`, and `signals` equal `{ tenureMonths: 6, region: 'US' }`.
  - Valid tenant0 token → `tenant === 'tenant0'`.
  - **Tenant comes from the issuer:** a tenant0-issued token with the claim `tenant: 'switchback'` → `null`.
  - Bad signals (`tenure_months: -1`, `region: 42`) → `{ tenureMonths: 0, region: 'unknown' }`.
  - `it.each` returning `null` for:
    - a missing header
    - `''`
    - `'Basic abc'`
    - `'Bearer'`
    - `'Bearer not-a-jwt'`
    - an expired token (`expiresIn: '-1m'`)
    - a token signed by the Switchback key but with the tenant0 issuer
    - a payload tampered after signing (switch a character in the middle segment)
    - an unknown issuer
    - a wrong audience
    - an `alg: none` token (jose `UnsecuredJWT`)
    - an HS256 token signed with a 32-byte secret
    - `omitExp`
    - `omitSub`
  - Never throws: wrap the `it.each` call in `expect(...).resolves`.

- [ ] **Step 2: Write the failing architecture test** in `test/architecture.test.ts`.
  - Recursively read every `.ts` file under `src/`.
  - The importers of `mintTenantContext` are files matching `/import[^;]*\bmintTenantContext\b[^;]*from/s`.
  - Assert every importer path starts with `src/lib/identity/`, and that at least one importer exists, which proves the scan works.
  - Failure message: `` `${file} imports mintTenantContext; only src/lib/identity/** may mint tenant contexts` ``.

- [ ] **Step 3: Run** `npm test`. Expected: FAIL. The authenticator module is missing, and the architecture test fails "at least one importer" because nothing imports the mint yet.

- [ ] **Step 4: Implement the authenticator.**
  - Parse with `/^Bearer ([^\s]+)$/` on a string header only.
  - `decodeJwt` the token, inside try/catch, only to read `iss`, and find its `IssuerConfig`.
  - Call `jwtVerify(token, cfg.publicKey, { algorithms: ['RS256'], issuer: cfg.issuer, audience: cfg.audience, requiredClaims: ['sub', 'exp'], currentDate: now() })`.
  - Return `null` if `payload.tenant !== undefined && payload.tenant !== cfg.tenant`.
  - Mint the context with `cfg.tenant`.
  - Wrap the whole method in try/catch and return `null` on any error.

- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Mutation check.** Add `import { mintTenantContext } from '../tenancy/context'` to `src/lib/offers/catalog.ts`. Confirm the architecture test fails with the message, then revert.

- [ ] **Step 7: Commit:** `feat(identity): jose JWT authenticator as sole tenant-context minter`.

---

### Task 6: Fastify app — identity hook, offers route, error mapping

**Files:**
- Create: `src/server/app.ts`, `src/server/plugins/identity.ts`, `src/server/routes/offers.ts`
- Test: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `Authenticator`, `makeTestIssuers` (Task 5); `getOffers`, `OffersDeps`, `PricingClient`, `PricingUnavailableError`, `FIXED_NOW` (Task 4); `BreachReporter` (Task 3).
- Produces:
  - `type AppDeps = OffersDeps & { authenticator: Authenticator }`
  - `function buildApp(deps: AppDeps): FastifyInstance`. It doesn't call `listen`.
  - `function registerIdentity(app: FastifyInstance, authenticator: Authenticator): void`. It adds an `onRequest` hook to the root instance and `decorateRequest('tenantContext', null)`.
  - `function registerOffersRoute(app: FastifyInstance, deps: OffersDeps): void`
  - Module augmentation: `FastifyRequest.tenantContext: TenantContext<TenantId> | null`.

- [ ] **Step 1: Write the failing tests.** Use the real `createJwtAuthenticator` with `makeTestIssuers()`, the default pricing mock from Task 4, a `vi.fn` reporter, and `app.inject({ method: 'GET', url: '/offers', headers })`.
  1. Tenant0 token → 200. The `ids` don't contain any id starting with `'hysa-switchback'` or `'ewa-switchback'`, `count === offers.length`, and `generatedAt === '2026-10-31T12:00:00.000Z'`.
  2. Switchback token with `{ tenure_months: 6, region: 'US' }` → 200, and the ids include `'hysa-switchback-plus'` and `'ewa-switchback-zero-fee'`.
  3. No token → 401 with body `{ error: 'unauthorized' }`, and the pricing mock is never called.
  4. Pricing rejects → 503 with body exactly `{ error: 'pricing_unavailable' }`.
  5. The authenticator stub resolves to the forged object `{ tenant: 'switchback', userId: 'x', signals: { tenureMonths: 9, region: 'US' } }` → 500 with body exactly `{ error: 'internal' }`.

- [ ] **Step 2: Run** `npx vitest run src/server`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**
  - The identity hook replies 401 when `authenticate` returns `null`, otherwise it sets `request.tenantContext`.
  - The route calls `getOffers(request.tenantContext!, deps)` and replies 503 `{ error: 'pricing_unavailable' }` on `PricingUnavailableError`; any other error is rethrown.
  - `app.setErrorHandler` replies 500 `{ error: 'internal' }` for anything else, after `request.log.error(err)`.
  - In `buildApp`, set `Fastify({ logger: false })`.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(server): Fastify app wiring identity hook and offers route`.

---

### Task 7: README, DECISIONS.md and final verification

**Files:**
- Modify: `README.md`
- Create: `DECISIONS.md`

**Interfaces:**
- Consumes: the mutation-check outputs recorded in Tasks 3 and 4.

- [ ] **Step 1: Write `README.md`.**
  - Requirements: Node 26 and `nvm use`.
  - Commands: `npm ci` and `npm test`.
  - A short explanation of what the test suite proves.
  - A map of `src/`.

- [ ] **Step 2: Write `DECISIONS.md`.** Keep it to about one page, with these sections:
  - **Key decisions:**
    - Capability token
    - Phantom types and `never`
    - Tenant derived from the issuer
    - Join over the selected offers
    - Gate drops and reports, but throws on a forged context
    - Fastify over Next.js
    - `jose`
    - Node 26 and TypeScript 7 with `skipLibCheck`
    - Pattern table from spec §4
  - **Loud-failure proof:** the two mutation outputs, trimmed to the failing assertion lines.
  - **Harden next:** the spec §9 list.
  - **Extending it:**
    - *Adding a tenant:* add it to the `TenantId` union. `tsc` then flags `catalogFor`'s `assertNever`. Add an issuer config, then tests.
    - *Adding an exclusive offer:* add it to the tenant's array; the type tests and the uniqueness test cover it.
    - Name Sam's tenant-keyed cache as the first extension: a `cacheKey(ctx: TenantContext<T>, …)` that can't be called without a context.

- [ ] **Step 3: Verify from a clean install.** Run `rm -rf node_modules && npm ci && npm test` on Node 26. Expected: tsc is clean and every test file passes, including the type tests. Paste the summary line into the PR description later, not into the docs.

- [ ] **Step 4: Commit** `docs: README and DECISIONS for the isolation guardrail`, then push to `claude/bold-rubin-seh20c`.
