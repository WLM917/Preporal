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
├── index.html                     interface complète (Tailwind CDN)
├── package.json
├── vercel.json                    runtime, cache, en-têtes de sécurité
├── .env.example                   modèle de variables d'environnement
├── .gitignore
├── assets/
│   └── logo.svg                   logo de marque (bulle + onde sonore)
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
│   └── legal.js                   mentions légales, CGV, RGPD, cookies
├── api/
│   ├── _lib/ia.js                 appel au modèle + limitation de débit
│   ├── _lib/supabaseAdmin.js      client service_role
│   ├── questions.js               POST /api/questions
│   ├── feedback.js                POST /api/feedback
│   ├── coach.js                   POST /api/coach
│   ├── create-checkout-session.js POST — redirige vers Stripe Checkout
│   ├── create-portal-session.js   POST — portail d'abonnement Stripe
│   └── webhook.js                 POST — évènements Stripe (source de vérité)
└── supabase/
    └── schema.sql                 tables profils / simulations / avis + RLS
```

Aucune étape de build : le front est du HTML et des modules ES natifs.

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
| Après paiement | retour sur `/?paiement=ok` → accès débloqué immédiatement |
| Résiliation | bouton « Gérer mon abonnement » → portail client Stripe |

Le compteur local (`localStorage`) est un **confort d'affichage**, pas une
sécurité : il suffit de vider le navigateur pour le remettre à zéro. La vérité est
le champ `premium` de la table `profils`, écrit par `api/webhook.js`.

**Pour un blocage réel**, exigez la connexion avant la première simulation et
vérifiez le quota côté serveur dans `api/questions.js` (table `usages`, déjà
présente dans le schéma). C'est le principal chantier restant côté sécurité.

---

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

Points de conformité et de sécurité à traiter — ils ne sont pas optionnels.

1. **Témoignages et note moyenne.** Les six avis de `js/reviews.js` et la mention
   « 4,9/5 sur +1 200 oraux » d'`index.html` sont des **exemples de mise en page**.
   Publier de faux avis ou une note inventée constitue une pratique commerciale
   trompeuse (art. L121-2 et suivants du code de la consommation, jusqu'à 2 ans
   d'emprisonnement et 300 000 € d'amende, portés à 10 % du chiffre d'affaires).
   Remplacez-les par de vrais retours, ou retirez le bandeau tant que vous n'en
   avez pas. Affichez ensuite la note réellement calculée et la date de collecte.
2. **Mentions légales et CGV.** `js/legal.js` est un modèle : toutes les mentions
   `[À COMPLÉTER]` (identité, SIRET, TVA, adresse, médiateur de la consommation)
   sont obligatoires. Le médiateur est requis dès la première vente à un
   consommateur. Faites relire par un juriste.
3. **Mineurs.** Le produit vise notamment des collégiens et lycéens : prévoyez le
   recueil du consentement parental sous 15 ans, et sachez qu'un mineur ne peut
   pas souscrire seul un abonnement payant.
4. **Quota côté serveur** (voir plus haut) et limitation de débit partagée
   (Upstash Redis plutôt que le compteur en mémoire d'`api/_lib/ia.js`, qui se
   remet à zéro à chaque instance froide).
5. **Coût par simulation.** Chaque simulation = 2 appels au modèle. Mesurez le
   coût réel avant d'arrêter le prix : à 9,99 €, un abonné qui enchaîne les
   simulations doit rester rentable. Le champ `tronquer()` d'`api/_lib/ia.js`
   plafonne déjà la taille des documents envoyés.
6. **Vérification du paiement au retour.** `traiterRetourPaiement()` débloque
   l'accès dès `?paiement=ok`, ce qui est falsifiable à la main. Pour un contrôle
   strict, interrogez `session_id` via une route `/api/verifier-session` avant de
   marquer l'accès comme actif.

---

© PrepOral. Ce dépôt est privé et non licencié pour la redistribution.
