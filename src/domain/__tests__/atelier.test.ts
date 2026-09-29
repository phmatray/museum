import { describe, expect, it } from 'vitest'

import { deriverAtelier, manifestesNpm, resoudre, type FichierArbre } from '../atelier'
import { disposerCoupe, OBSTACLES_ATELIERS } from '../../plan/ateliers'
import { MUSEE } from '../../plan/musee'

/** Un dépôt en miniature, sur le modèle de VirtualFileSystem : un cœur, une abstraction, deux fournisseurs, une démo, des tests, le build Nuke. */
const csproj = (sdk: string, refs: string[], extra = '') =>
  `<Project Sdk="${sdk}">\n${extra}\n${refs.map((r) => `<ProjectReference Include="${r}" />`).join('\n')}\n</Project>`
const CSPROJS = new Map([
  ['src/App.Core/App.Core.csproj', csproj('Microsoft.NET.Sdk', [], '<PackageId>App</PackageId>')],
  ['src/App.Abstractions/App.Abstractions.csproj', csproj('Microsoft.NET.Sdk', ['..\\App.Core\\App.Core.csproj'])],
  ['src/App.Ftp/App.Ftp.csproj', csproj('Microsoft.NET.Sdk', ['..\\App.Core\\App.Core.csproj', '..\\App.Abstractions\\App.Abstractions.csproj'], '<PackageReference Include="FluentFTP" />')],
  ['src/App.Demo/App.Demo.csproj', csproj('Microsoft.NET.Sdk.BlazorWebAssembly', ['../App.Ftp/App.Ftp.csproj'], '<PackageReference Include="MudBlazor" />')],
  ['tests/App.UnitTests/App.UnitTests.csproj', csproj('Microsoft.NET.Sdk', ['..\\..\\src\\App.Core\\App.Core.csproj'])],
  ['build/_build.csproj', csproj('Microsoft.NET.Sdk', [], '<OutputType>Exe</OutputType>')],
])
const fichier = (path: string, size = 100): FichierArbre => ({ path, type: 'blob', size })
const ARBRE: FichierArbre[] = [
  ...['A', 'B', 'C'].map((n) => fichier(`src/App.Core/${n}.cs`, 1000)),
  fichier('src/App.Core/README.md', 5000),
  fichier('src/App.Core/obj/Gen.cs', 9999),
  fichier('src/App.Abstractions/I.cs'),
  fichier('src/App.Ftp/Ftp.cs', 400),
  fichier('src/App.Demo/Pages/Index.razor', 300),
  fichier('tests/App.UnitTests/T.cs'),
]

describe('deriverAtelier', () => {
  const a = deriverAtelier('moi/app', 'abc1234', ARBRE, CSPROJS)!

  it('range les bibliothèques par profondeur de dépendance, puis les démos, puis les tests', () => {
    expect(a.couches.map((c) => [c.id, c.modules.map((m) => m.nom)])).toEqual([
      ['socle', ['Core']],
      ['extensions', ['Abstractions']],
      ['assemblages', ['Ftp']],
      ['demonstrations', ['Demo']],
      ['tests', ['UnitTests']],
    ])
  })

  it('nomme chaque couche d’après ce qu’elle contient, son rôle dessous', () => {
    expect(a.couches.map((c) => c.nom)).toEqual(['Core', 'Abstractions', 'Ftp', 'Démos MudBlazor', 'Tests unitaires'])
    expect(a.couches[0].role).toBe('Socle · ne dépend d’aucun autre projet')
  })

  it('nomme une extension par le paquet qu’elle habille, comme FormCraft', () => {
    const f = deriverAtelier('moi/form', 'x', [fichier('src/FormCraft/F.cs')], new Map([
      ['src/FormCraft/FormCraft.csproj', csproj('Microsoft.NET.Sdk.Razor', [], '<PackageReference Include="FluentValidation" />')],
      ['src/FormCraft.ForMudBlazor/FormCraft.ForMudBlazor.csproj', csproj('Microsoft.NET.Sdk.Razor', ['../FormCraft/FormCraft.csproj'], '<PackageReference Include="MudBlazor" />')],
      ['src/FormCraft.ForFluentUI/FormCraft.ForFluentUI.csproj', csproj('Microsoft.NET.Sdk.Razor', ['../FormCraft/FormCraft.csproj'], '<PackageReference Include="Microsoft.FluentUI.AspNetCore.Components" />')],
      ['samples/Demo/Demo.csproj', csproj('Microsoft.NET.Sdk', ['../../src/FormCraft/FormCraft.csproj'], '<OutputType>Exe</OutputType>')],
      ['tests/FormCraft.UnitTests/FormCraft.UnitTests.csproj', csproj('Microsoft.NET.Sdk', ['../../src/FormCraft/FormCraft.csproj'])],
      ['tests/FormCraft.Benchmarks/FormCraft.Benchmarks.csproj', csproj('Microsoft.NET.Sdk', ['../../src/FormCraft/FormCraft.csproj'])],
    ]))!
    expect(f.couches.map((c) => c.nom)).toEqual(['FormCraft', 'Fluent UI · MudBlazor', 'Démos console', 'Tests unitaires · Benchmarks'])
  })

  it('laisse l’outillage du build hors de l’architecture', () => {
    expect(a.couches.flatMap((c) => c.modules).some((m) => m.id === '_build')).toBe(false)
  })

  it('pèse le code source du dossier, sans bin/obj ni documentation', () => {
    const core = a.couches[0].modules[0]
    expect([core.fichiers, core.octets]).toEqual([3, 3000])
  })

  it('tire les fils des ProjectReference, chemins Windows ou Unix', () => {
    expect(a.liens).toContainEqual({ de: 'App.Ftp', vers: 'App.Abstractions' })
    expect(a.liens).toContainEqual({ de: 'App.Demo', vers: 'App.Ftp' })
    expect(a.liens).toHaveLength(5)
  })

  it('dit le rôle d’après le SDK et les paquets', () => {
    const role = (id: string) => a.couches.flatMap((c) => c.modules).find((m) => m.id === id)!.role
    expect(role('App.Core')).toBe('Paquet NuGet')
    expect(role('App.Ftp')).toBe('Bibliothèque · FluentFTP')
    expect(role('App.Demo')).toBe('Démo Blazor WebAssembly · MudBlazor')
    expect(role('App.UnitTests')).toBe('Tests de Core')
  })

  it('garde douze modules au plus, en écartant d’abord les plus petits tests', () => {
    const beaucoup = new Map(CSPROJS)
    for (let i = 0; i < 12; i++) beaucoup.set(`tests/T${i}.Tests/T${i}.Tests.csproj`, csproj('Microsoft.NET.Sdk', ['../../src/App.Core/App.Core.csproj']))
    const b = deriverAtelier('moi/app', 'x', ARBRE, beaucoup)!
    expect(b.couches.flatMap((c) => c.modules)).toHaveLength(12)
    expect(b.couches.find((c) => c.id === 'socle')!.modules).toHaveLength(1)
  })

  it('sans bibliothèque, pas d’atelier', () => {
    expect(deriverAtelier('moi/x', 'x', [], new Map([['T.Tests/T.Tests.csproj', csproj('Microsoft.NET.Sdk', [])]]))).toBeNull()
  })

  it('résout un chemin relatif', () => {
    expect(resoudre('tests/B/', '..\\..\\src\\A\\A.csproj')).toBe('src/A/A.csproj')
  })
})

describe('un dépôt JavaScript', () => {
  const pkg = (o: object) => JSON.stringify(o)
  const RACINE = pkg({ name: 'acme', private: true, workspaces: ['packages/*', 'apps/*'] })
  const PAQUETS = new Map([
    ['packages/core/package.json', pkg({ name: '@acme/core' })],
    ['packages/react/package.json', pkg({ name: '@acme/react', dependencies: { '@acme/core': 'workspace:*' }, peerDependencies: { react: '^19' } })],
    ['packages/vue/package.json', pkg({ name: '@acme/vue', dependencies: { '@acme/core': '^1.0.0', vue: '^3' } })],
    ['apps/playground/package.json', pkg({ name: 'playground', private: true, dependencies: { '@acme/react': '*', react: '^19' } })],
    ['packages/e2e/package.json', pkg({ name: '@acme/e2e', private: true, devDependencies: { '@acme/react': '*' } })],
  ])
  const ARBRE_JS: FichierArbre[] = [
    fichier('package.json'),
    ...[...PAQUETS.keys()].map((p) => fichier(p)),
    fichier('packages/core/src/index.ts', 3000),
    fichier('packages/core/dist/index.js', 9999),
    fichier('packages/core/node_modules/x/package.json'),
    fichier('packages/react/src/Bouton.tsx', 800),
    fichier('packages/vue/src/Bouton.vue', 600),
    fichier('apps/playground/src/main.tsx', 500),
    fichier('packages/e2e/src/a.spec.ts', 200),
  ]

  it('trouve les paquets des espaces de travail, sans node_modules', () => {
    expect(manifestesNpm(RACINE, null, ARBRE_JS)).toEqual([...PAQUETS.keys()].sort())
    expect(manifestesNpm(pkg({ name: 'x' }), 'packages:\n  - "libs/**"\n', [fichier('libs/a/b/package.json')])).toEqual(['libs/a/b/package.json'])
    expect(manifestesNpm(pkg({ name: 'seul' }), null, [fichier('package.json'), fichier('src/a.ts')])).toEqual(['package.json'])
  })

  it('en tire les mêmes couches et les fils des dépendances internes', () => {
    const j = deriverAtelier('moi/acme', 'x', ARBRE_JS, PAQUETS)!
    expect(j.couches.map((c) => [c.id, c.nom, c.modules.map((m) => m.nom)])).toEqual([
      ['socle', 'core', ['core']],
      ['extensions', 'React · Vue', ['react', 'vue']],
      ['demonstrations', 'Démos React', ['playground']],
      ['tests', 'Tests de bout en bout', ['e2e']],
    ])
    expect(j.couches[0].modules[0]).toMatchObject({ role: 'Paquet npm', fichiers: 1, octets: 3000 })
    expect(j.liens).toContainEqual({ de: '@acme/react', vers: '@acme/core' })
    expect(j.liens).toContainEqual({ de: 'playground', vers: '@acme/react' })
    expect(j.liens).toHaveLength(4)
  })
})

describe('disposerCoupe', () => {
  const coupe = disposerCoupe(deriverAtelier('moi/app', 'abc1234', ARBRE, CSPROJS)!)

  it('empile une plaque par couche, de 25 à 35 cm l’une de l’autre', () => {
    expect(coupe.plaques).toHaveLength(5)
    for (let i = 1; i < coupe.plaques.length; i++) {
      const pas = coupe.plaques[i].y - coupe.plaques[i - 1].y
      expect(pas).toBeGreaterThanOrEqual(0.25)
      expect(pas).toBeLessThanOrEqual(0.35)
    }
  })

  it('le plus lourd des projets est le plus gros bloc', () => {
    const [core, ...autres] = [...coupe.blocs].sort((x, y) => y.cote - x.cote)
    expect(core.id).toBe('App.Core')
    expect(autres.every((b) => b.cote < core.cote)).toBe(true)
  })

  it('chaque fil part d’au-dessus de sa dépendance et monte', () => {
    expect(coupe.fils).toHaveLength(5)
    for (const f of coupe.fils) expect(f.points[3][1]).toBeGreaterThan(f.points[0][1])
  })
})

describe('les ateliers dans le plan', () => {
  it('sont des obstacles du rez-de-chaussée, dans la galerie du nord, hors de l’axe des portes (z 5–7)', () => {
    const obstacles = MUSEE.levels[0].obstacles
    for (const o of OBSTACLES_ATELIERS) {
      expect(obstacles).toContainEqual(o)
      expect(o.x).toBeGreaterThan(16.15)
      expect(o.x + o.width).toBeLessThan(31.85)
      expect(o.z).toBeGreaterThan(0.15 + 2)
      expect(o.z + o.depth).toBeLessThan(5)
    }
  })

  it('laissent au moins 2 m de passage entre deux ateliers', () => {
    const [a, b] = OBSTACLES_ATELIERS
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(2)
  })
})
