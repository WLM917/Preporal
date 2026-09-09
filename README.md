# PrepOral

Simulateur d'oraux assisté par IA : entretien d'embauche ou de stage, Grand Oral,
oral du brevet, concours et grandes écoles, pitch, oral de matière, certifications
de langue (TOEIC, TOEFL, IELTS…).

L'utilisateur dépose son CV et l'offre — ou son sujet et ses notes —, l'application
génère les questions, les **pose à voix haute**, écoute la réponse au micro,
chronomètre, puis rend un bilan noté avec une analyse d'éloquence et un export PDF.

---

## Sommaire

1. [Arborescence](#arborescence)
2. [Démarrage rapide](#démarrage-rapide)
3. [Configuration Stripe](#configuration-stripe)
4. [Configuration Supabase](#configuration-supabase)
5. [Mise en production](#mise-en-production)
6. [Fonctionnement du paywall](#fonctionnement-du-paywall)
7. [Compatibilité navigateurs](#compatibilité-navigateurs)
8. [À faire avant de vendre](#à-faire-avant-de-vendre)

---

## Arborescence

```
prepOral/
├── index.html                     interface complète
├── package.json
├── vercel.json                    runtime, cache, en-têtes de sécurité (CSP)
├── tailwind.config.cjs            configuration des styles
├── styles/entree.css              source Tailwind
├── .env.example                   modèle de variables d'environnement
├── .gitignore
├── assets/
│   ├── logo.svg                   logo de marque (bulle + onde sonore)
│   └── tailwind.css               feuille générée (npm run styles)
├── js/
│   ├── app.js                     orchestrateur : vues, écrans, déroulé
│   ├── config.js                  catalogue des 7 épreuves, tarifs, quotas
│   ├── ui.js                      sélecteurs, modales, toasts, stockage local
│   ├── upload.js                  PDF / DOCX / image (OCR) / texte → zone de texte
│   ├── speech.js                  voix de l'examinateur + dictée vocale
│   ├── questions.js               questions (API + secours hors ligne)
│   ├── feedback.js                correction + analyse d'éloquence
│   ├── report.js                  tableau de bord final + export PDF
│   ├── paywall.js                 quota gratuit, modale, Stripe Checkout
│   ├── auth.js                    Supabase Auth (Google + lien magique)
│   ├── history.js                 « Mes simulations » + courbe de progression
│   ├── reviews.js                 témoignages et dépôt d'avis
│   ├── coach.js                   onglet Coach IA (chat écrit et vocal)
│   ├── theme.js                   bascule clair / sombre, bandeau cookies
│   └── legal.js                   mentions légales, CGV, RGPD, cookies
├── api/
│   ├── _lib/ia.js                 appel au modèle + limitation de débit
│   ├── _lib/quota.js              quota des simulations, côté serveur
│   ├── _lib/supabaseAdmin.js      client service_role
│   ├── verifier-session.js        POST — contrôle réel du paiement Stripe
│   ├── questions.js               POST /api/questions
│   ├── feedback.js                POST /api/feedback
│   ├── coach.js                   POST /api/coach
│   ├── create-checkout-session.js POST — redirige vers Stripe Checkout
│   ├── create-portal-session.js   POST — portail d'abonnement Stripe
│   └── webhook.js                 POST — évènements Stripe (source de vérité)
└── supabase/
    └── schema.sql                 tables profils / simulations / avis /
                                   usages / usages_anonymes + RLS
```

Le front reste du HTML et des modules ES natifs. Seule la feuille de styles
est générée : `npm run styles` après avoir ajouté ou modifié des classes
Tailwind (`npm run styles:watch` pendant le développement).

> Le CDN « play » de Tailwind a été retiré : il est réservé au développement,
> pèse plusieurs centaines de kilo-octets, recompile le CSS à chaque
> chargement de page et impose `'unsafe-eval'` dans la politique de sécurité.
> `assets/tailwind.css` fait 21 ko et est servi en statique.

---

## Démarrage rapide

```bash
npm install
cp .env.example .env.local     # puis renseignez vos clés
npx vercel dev                 # http://localhost:3000
```

Sans `.env.local`, l'application tourne quand même : le front bascule
automatiquement en **mode démo** (questions et correction générées localement,
badge affiché). Utile pour travailler le design sans consommer d'API.

> Ouvrir `index.html` par un double-clic ne fonctionne pas : les modules ES et le
> micro exigent `http://localhost` ou `https://`. Utilisez `npx vercel dev` ou
> `npm run statique`.

---

## Configuration Stripe

1. Créez deux produits dans le tableau de bord Stripe :
   - **PrepOral Premium** — tarif récurrent, 9,99 € TTC / mois
   - **Pass 48 heures** — tarif ponctuel, 4,99 € TTC
2. Copiez les identifiants de tarif (`price_…`) dans `STRIPE_PRICE_MENSUEL` et
   `STRIPE_PRICE_PASS48`.
3. Développeurs → Webhooks → *Add endpoint* :
   - URL : `https://votre-domaine.fr/api/webhook`
   - Évènements : `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`
   - Copiez le *signing secret* dans `STRIPE_WEBHOOK_SECRET`.
4. En local, pour tester les webhooks :

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

Carte de test : `4242 4242 4242 4242`, date future, CVC quelconque.

---

## Configuration Supabase

1. Créez un projet **en région européenne** (RGPD).
2. SQL Editor → collez et exécutez `supabase/schema.sql`.
3. Authentication → Providers : activez *Email* (lien magique) et *Google*
   (renseignez le client OAuth et ajoutez l'URL de redirection de votre domaine).
4. Reportez `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans les variables
   d'environnement Vercel.
5. Dans `index.html`, renseignez le bloc `window.PREPORAL_ENV` avec l'URL du
   projet et la clé **anon public** (ces deux valeurs sont publiques par
   conception ; la clé `service_role`, elle, ne doit jamais y figurer).

Tant que ce bloc reste vide, l'application fonctionne en **mode local** :
historique et avis restent dans le navigateur.

---

## Mise en production

```bash
npx vercel --prod
```

Puis, dans Vercel → Settings → Environment Variables, ajoutez toutes les clés de
`.env.example`. Redéployez après tout ajout de variable.

---

## Fonctionnement du paywall

| Étape | Comportement |
|---|---|
| Simulations 1 et 2 | gratuites, sans compte ni carte |
| Fin de la 1re simulation | modale d'offre, fermable (« Plus tard ») |
| Lancement de la 3e | modale bloquante : Premium 9,99 €/mois ou Pass 48 h 4,99 € |
| Après paiement | retour sur `/?paiement=ok&session_id=…`, **vérifié auprès de Stripe** |
| Résiliation | bouton « Gérer mon abonnement » → portail client Stripe |

Le quota est désormais **appliqué côté serveur** (`api/_lib/quota.js`), et non
plus seulement affiché dans le navigateur :

- **Premium** (abonnement actif ou pass 48 h valide) → illimité ;
- **connecté sans premium** → compteur dans la table `usages` ;
- **anonyme** → compteur dans `usages_anonymes`, indexé par une empreinte
  non réversible (IP + navigateur + langue + sel serveur).

Le compteur `localStorage` ne sert plus qu'à l'affichage. `/api/questions`,
`/api/feedback` et `/api/coach` refusent la requête avec un **402** quand le
quota est épuisé ; le front ouvre alors la modale d'offre.

> **Point d'attention.** L'empreinte anonyme se contourne avec un VPN, une
> navigation privée ou un autre appareil. Elle relève le seuil, elle ne
> l'étanchéifie pas. Pour un blocage strict, passez `EXIGER_CONNEXION=true` :
> un compte gratuit devient obligatoire dès la première simulation, et le
> quota est alors rattaché à un identifiant stable. C'est un arbitrage
> commercial (friction à l'entrée) autant que technique.

Le quota n'est décompté **qu'après une génération réussie** : une panne du
modèle ne coûte plus une simulation au candidat.

### Vérification du paiement

`traiterRetourPaiement()` n'accorde plus rien sur la foi de `?paiement=ok`.
Le front envoie le `session_id` à `/api/verifier-session`, qui interroge
Stripe et ne confirme que si la session est réellement payée. Le webhook
(`api/webhook.js`) reste la source de vérité durable en base.

## Compatibilité navigateurs

| Fonction | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Interface, upload, PDF, paiement | ✅ | ✅ | ✅ |
| Voix de l'examinateur (`speechSynthesis`) | ✅ | ✅ | ✅ |
| Dictée vocale (`webkitSpeechRecognition`) | ✅ | ✅ (iOS 14.5+) | ❌ |

Sur Firefox, le bouton micro se désactive tout seul avec un message explicite ;
l'utilisateur peut écrire sa réponse et tout le reste fonctionne. La qualité des
voix dépend du système : macOS et iOS sonnent nettement mieux que Windows.

Le micro exige **HTTPS** (ou `localhost`).

---

## À faire avant de vendre

Ce qui a été traité, et ce qui reste **à votre charge**.

### Traité

- **Faux avis retirés.** Les six témoignages d'exemple et la note « 4,9/5 sur
  +1 200 oraux » ont été supprimés. `js/reviews.js` n'affiche que des avis
  réellement déposés et publiés (`avis.publie = true`), et la note moyenne est
  calculée à partir de ces avis seulement — avec la date de collecte, comme
  l'exige l'art. L111-7-2. Sans avis publié, le bloc affiche un état vide
  honnête plutôt qu'une note inventée. **Ne réintroduisez pas d'avis
  d'exemple** : c'est une pratique commerciale trompeuse (art. L121-2, jusqu'à
  2 ans d'emprisonnement et 300 000 € d'amende, portés à 10 % du CA).
- **Quota appliqué côté serveur** et vérification réelle du paiement Stripe
  (voir « Fonctionnement du paywall »).
- **Limitation de débit partagée** via Upstash Redis quand
  `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont renseignés ;
  repli en mémoire sinon.
- **Mineurs.** Clause dédiée dans les CGV (art. 1145 s. du code civil) et
  confirmation d'âge obligatoire avant tout paiement.
- **En-têtes de sécurité** : `vercel.json` pose CSP, HSTS, `X-Frame-Options`,
  `Referrer-Policy` et `Permissions-Policy`.
- **Coût maîtrisé** : `effort: 'low'` pour la génération des questions,
  `'medium'` pour la correction ; sortie contrainte par schéma JSON.

### À votre charge

1. **Mentions légales.** Renseignez le bloc `window.PREPORAL_ENV` dans
   `index.html` : `EDITEUR_NOM`, `EDITEUR_STATUT`, `EDITEUR_SIRET`,
   `EDITEUR_TVA`, `EDITEUR_ADRESSE`, `EDITEUR_EMAIL`, `EDITEUR_DIRECTEUR`,
   `EDITEUR_MEDIATEUR`. Tant que c'est incomplet, un bandeau d'avertissement
   s'affiche en pied de page et les textes légaux signalent chaque mention
   manquante. Le médiateur de la consommation est obligatoire dès la première
   vente à un consommateur. **Faites relire par un juriste** : les textes
   fournis sont un modèle, pas un conseil juridique.
2. **Consentement parental sous 15 ans.** La clause figure dans les CGV et la
   politique de confidentialité, mais aucun recueil effectif n'est implémenté.
   Si vous visez réellement les collégiens, c'est le chantier suivant.
3. **Modération des avis.** Les avis arrivent avec `publie = false`. Il n'y a
   pas encore d'interface d'administration : passez-les à `true` depuis
   Supabase après vérification.
4. **Coût par simulation.** Chaque simulation = 2 appels au modèle. Mesurez le
   coût réel sur `claude-opus-5` avant d'arrêter le prix ; `MODELE_IA=claude-sonnet-5`
   divise la facture par ~2,5 si la qualité de correction reste suffisante pour
   votre usage. À 9,99 €, un abonné qui enchaîne les simulations doit rester
   rentable.
5. **Quota anonyme contournable.** Voir l'encadré de la section paywall :
   `EXIGER_CONNEXION=true` est le seul réglage réellement étanche.
6. **Purge des empreintes anonymes.** Planifiez la suppression des lignes de
   `usages_anonymes` inactives depuis plus de 6 mois (minimisation RGPD) ;
   la requête est en commentaire dans `supabase/schema.sql`.

---

© PrepOral. Ce dépôt est privé et non licencié pour la redistribution.
