# PrepOral — MVP

Simulateur d'entretien : CV + offre → 5 questions sur mesure → correction notée.

```
prepOral/
├── index.html                        page unique (front-end)
├── package.json
└── api/
    ├── questions.js                  génère les 5 questions
    ├── feedback.js                   note et corrige les réponses
    ├── create-checkout-session.js    Stripe Checkout
    └── verify-session.js             confirme le paiement
```

## 1. Installer et tester en local

```bash
npm i -g vercel
npm install
vercel dev          # http://localhost:3000
```

## 2. Variables d'environnement

Dans Vercel → Settings → Environment Variables (et dans un `.env.local` pour le dev) :

| Nom | Où le trouver |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → Développeurs → Clés API (`sk_...`) |
| `STRIPE_PRICE_PACK` | id du tarif 9 € paiement unique (`price_...`) |
| `STRIPE_PRICE_SUB` | id du tarif 12 €/mois récurrent (`price_...`) |

Aucune de ces valeurs ne doit apparaître dans `index.html`.

## 3. Créer les tarifs Stripe

Dashboard Stripe → Catalogue de produits :
- **Pack 3 simulations** — 9,00 € — paiement unique
- **PrepOral mensuel** — 12,00 € — récurrent mensuel

Copiez les deux `price_...` dans les variables ci-dessus. Testez avec la carte
`4242 4242 4242 4242`, date future, CVC quelconque.

## 4. Mettre en ligne

```bash
vercel --prod
```

Vercel détecte `/api` et déploie chaque fichier comme fonction serverless.
L'offre gratuite suffit largement au démarrage. Netlify fonctionne aussi :
déplacez `api/` dans `netlify/functions/` et adaptez les signatures
(`export const handler = async (event) => ...`).

## 5. Avant d'encaisser de l'argent réel

Le MVP mémorise l'accès dans le `localStorage` du navigateur. C'est suffisant
pour valider l'idée auprès de premiers utilisateurs, mais **contournable** :
quelqu'un peut s'attribuer des crédits depuis la console. Trois ajouts à prévoir
dès les premiers vrais clients :

1. **Comptes utilisateurs** — Supabase Auth ou Clerk, tous deux gratuits au départ.
2. **Crédits en base** — une table `users(email, credits, subscription_status)`
   dans Supabase ; `/api/questions` vérifie le solde avant d'appeler le modèle et
   le décrémente lui-même.
3. **Webhook Stripe** — `/api/webhook` sur les événements
   `checkout.session.completed` et `customer.subscription.deleted`, pour créditer
   et révoquer sans dépendre du retour du navigateur.

Deux autres points à ne pas oublier : une limite d'appels par IP ou par compte
(un abonnement « illimité » sur une API facturée au token est un risque financier),
et les mentions légales + CGV, obligatoires pour vendre en France.
