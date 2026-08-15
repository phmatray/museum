"""
Fige le relevé de `capture.ts` en oracle versionné, ou le compare à l'oracle.

    python3 tools/oracle.py fixer     # .captures/rapport.json -> tools/oracle-baseline.json
    python3 tools/oracle.py comparer  # le relevé courant contre l'oracle

── Pourquoi ce fichier existe ──

`.captures/` est ignoré par git — 55 Mo de PNG en 2880×1800, et le dépôt est
public. Le RELEVÉ, lui, tient en quelques kilo-octets et c'est la seule chose
qu'on ait besoin de garder : sans un état d'avant versionné, on ne peut pas
distinguer un rouge qu'on vient d'introduire d'un rouge qui était déjà là. Cette
distinction est la règle de maison, et elle n'avait pas d'outil.

Les images restent jetables ; les chiffres deviennent comparables.
"""

import json
import pathlib
import sys

RACINE = pathlib.Path(__file__).resolve().parents[1]
RELEVE = RACINE / ".captures" / "rapport.json"
ORACLE = RACINE / "tools" / "oracle-baseline.json"

POURQUOI = (
    "Relevé de référence AVANT le chantier Calatrava. Sert d'oracle avant/après. "
    "Rejouable : node tools/capture.ts --url <serveur>, puis python3 tools/oracle.py fixer."
)

CONDITIONS = (
    "Assets CC0 récupérés (node tools/fetch-assets.ts) ET atlas construit (npm run media). "
    "Sans eux le musée rend sans matières, sans HDRI et sans œuvres, et les métriques de "
    "luminance ne veulent rien dire : mesuré le même jour, la vue `entree` donnait 172,1 de "
    "luminance et 255 draw calls à sec, contre 144,7 et 259 une fois les assets en place. "
    "Un oracle pris sur un musée nu aurait fait passer pour une régression tout ce qui "
    "n'aurait été qu'un chargement réussi."
)

CLES = ("calls", "triangles", "lights", "shadowCasters")


def charger(chemin):
    if not chemin.exists():
        sys.exit(f"absent : {chemin}\nLance d'abord `node tools/capture.ts --url <serveur>`.")
    return json.loads(chemin.read_text())


def pires(vues):
    """Le budget se juge sur la vue la PLUS CHÈRE, jamais sur la moyenne."""
    out = {}
    for k in CLES:
        valeurs = [v["mesure"][k] for v in vues if v.get("mesure")]
        out[k] = max(valeurs) if valeurs else None
    return out


def fixer():
    r = charger(RELEVE)
    oracle = {
        "_pourquoi": POURQUOI,
        "_conditions": CONDITIONS,
        "viewport": r["viewport"],
        "budget": r["budget"],
        "pires": pires(r["rapports"]),
        "vues": r["rapports"],
    }
    ORACLE.write_text(json.dumps(oracle, indent=2, ensure_ascii=False) + "\n")
    print(f"oracle figé : {len(r['rapports'])} vues -> {ORACLE.relative_to(RACINE)}")
    for k, v in oracle["pires"].items():
        print(f"  {k:<14} {v}")


def comparer():
    ref = charger(ORACLE)
    cur = charger(RELEVE)
    avant = {v["vue"]: v for v in ref["vues"]}

    print(f"\n{'vue':<20} {'Δcalls':>8} {'Δtris':>10} {'Δσ':>8} {'Δblanc>250':>11}")
    for v in cur["rapports"]:
        a = avant.get(v["vue"])
        if a is None:
            print(f"{v['vue']:<20} {'NOUVELLE':>8}")
            continue
        dc = v["mesure"]["calls"] - a["mesure"]["calls"]
        dt = v["mesure"]["triangles"] - a["mesure"]["triangles"]
        ds = round(v["ecartType"] - a.get("ecartType", 0), 1)
        db = round(v["pctSur250"] - a.get("pctSur250", 0), 2)
        print(f"{v['vue']:<20} {dc:>+8} {dt:>+10} {ds:>+8} {db:>+11}")

    pa, pc = pires(ref["vues"]), pires(cur["rapports"])
    print("\nsur la vue la plus chère :")
    for k in CLES:
        signe = "" if pc[k] == pa[k] else ("↑" if pc[k] > pa[k] else "↓")
        print(f"  {k:<14} {pa[k]} -> {pc[k]}  {signe}")

    # Le critère d'acceptation du chantier : un travail d'embellissement qui rend
    # le compteur plus rouge n'est pas livrable.
    if pc["calls"] > pa["calls"]:
        print(f"\n⚠ draw calls EN HAUSSE ({pa['calls']} -> {pc['calls']})")
    if pc["triangles"] > ref["budget"]["triangles"]:
        print(f"\n⚠ triangles au-dessus du plafond ({pc['triangles']} > {ref['budget']['triangles']})")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "comparer"
    if action == "fixer":
        fixer()
    elif action == "comparer":
        comparer()
    else:
        sys.exit(__doc__)
