# Adapter A'Space — nansen-cli (couture contrat seule)

## Ce que c'est

Un **contrat seul** pour le CLI Nansen (`nansen-ai/nansen-cli` v2.4.0, MIT),
fork `Amdkn/nansen-cli`, gel `0b39ae5d84f986314e01393cda15bfdeea7fec70`.

L'adapter ne modifie **aucun code amont**, n'importe **aucun module amont**,
n'exige **aucune clé API** et n'appelle **jamais** un endpoint payant.
Il expose uniquement la surface **offline** du CLI — des commandes qui,
par contrat amont (`src/cli.js`, `isOfflineCommand`), promettent zéro
activité réseau, y compris télémétrie, update-check et cost-map.

## Surface autorisée

| Commande | Pourquoi zéro réseau |
|---|---|
| `nansen --version` | Retourne avant tout appel API ; ne déclenche jamais la télémétrie. Le spawn update-check est coupé par `NO_UPDATE_NOTIFIER=1` / `CI=1`. |
| `nansen doctor --offline` | Commande offline par contrat amont : ni télémétrie, ni update-check, ni cost-map. Rapporte l'état de la télémétrie. |
| `nansen auth status` | Commande offline par contrat amont : lecture locale seule. Sortie JSON : `logged_in: false`, `offline: true`. |
| `nansen completion <bash\|zsh\|fish>` | Commande offline par contrat amont : génération locale d'un script de completion. |

## Gardes d'environnement (toujours appliquées)

- `NANSEN_NO_TELEMETRY=1` — coupe la télémétrie maison (`src/telemetry.js`, défaut ON).
- `DO_NOT_TRACK=1` — second interrupteur de la même télémétrie (même prédicat).
- `NO_UPDATE_NOTIFIER=1` — coupe le spawn détaché de vérification de mise à jour (`registry.npmjs.org/nansen-cli/latest`), déclenché par toute commande non-offline, **y compris `--version`**.
- `CI=1` — double barrière (coupe aussi update-check et notices).
- `HOME=<scratch>` — aucune écriture sous le vrai `~/.nansen` (telemetry-id, session, caches, config).
- `NANSEN_API_KEY` **jamais** présente dans l'environnement enfant.

## Ce que l'adapter ne fait JAMAIS

- Aucune commande de données (`research`, `smart-money`, `agent`, `web`, `alerts`, `feedback submit/get`).
- Aucune commande de trading (`trade`, `perp`, `wallet`, `bridge`, `limit-order`, `send`).
- `nansen login` / `logout` (mutation d'authentification).
- `nansen account` (appel API — même si l'amont l'annonce « 0 crédit »).
- `nansen --help` / `nansen help` — **exclu volontairement** : il déclenche
  `refreshCostMapIfStale()` (GET `https://api.nansen.ai/openapi.json` quand le
  cache coûts est absent ou vieux de plus de 24 h — spec publique sans clé,
  0 crédit, mais appel réseau vers l'hôte de l'API payante).
- Aucun appel à `https://api.nansen.ai`, `https://trading-api.nansen.ai`,
  ni au paiement x402, ni à la télémétrie
  (`https://bi-data-sources.nansen.ai/.../v2/event`).

## Arbitrage S0 en attente

Les identifiants et crédits Nansen (`NANSEN_API_KEY`, sessions navigateur,
x402) sont un **arbitrage vision S0, non tranché par la chaîne**. Tant qu'il
n'est pas tranché, l'adapter reste sur la surface offline ci-dessus :
aucune clé, aucun crédit, aucun appel payant.

## Vérification

```bash
node aspace-nansen-cli-adapter/smoke_test.mjs
```

7 checks : version exacte, doctor offline, auth status JSON, completion,
preuve réseau (`unshare -n` : `--version` et `doctor --offline` réussissent
sans interface réseau — 2 checks), zéro fichier de télémétrie/session/cache
sous le HOME scratch, absence de `NANSEN_API_KEY` — soit **8 checks** au total.

## Détails (audit complet)

Voir `nansen-cli-TELEMETRY-AUDIT.md` et la fiche
`nansen-cli-ADAPTATION.md` dans `~/workspace/v4-factory/evidence/D-N048/v4/`
(dépôt d'évidence V5, pas dans ce fork).
