/**
 * Les polices des textes peints sur canevas (enseignes, bannières, cartels) :
 * PT Sans et PT Serif de `public/assets/fonts`, les mêmes que les `<Text>` de
 * three (scene/cartelStyle.ts). `await police('PT Sans')` avant de dessiner,
 * puis `ctx.font = \`${px}px 'PT Sans'\``. Un échec ne bloque rien : le canevas
 * prend la police de repli du navigateur.
 */
const FICHIERS = { 'PT Sans': 'PTSans-Regular.ttf', 'PT Serif': 'PTSerif-Regular.ttf' } as const
export type Police = keyof typeof FICHIERS

const chargees = new Map<Police, Promise<void>>()

export function police(nom: Police): Promise<void> {
  let p = chargees.get(nom)
  if (!p) {
    const f = new FontFace(nom, `url(${import.meta.env.BASE_URL}assets/fonts/${FICHIERS[nom]})`)
    p = f.load().then(
      () => void document.fonts.add(f),
      (e: unknown) => console.warn(`police ${nom} indisponible`, e),
    )
    chargees.set(nom, p)
  }
  return p
}
