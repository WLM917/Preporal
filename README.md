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
3. [Les pages](#les-pages)
4. [Tests](#tests)
5. [Configuration Stripe](#configuration-stripe)
6. [Configuration Supabase](#configuration-supabase)
7. [Mise en production](#mise-en-production)
8. [Fonctionnement du paywall](#fonctionnement-du-paywall)
9. [Modération des avis](#modération-des-avis)
10. [Âge et consentement parental](#âge-et-consentement-parental)
11. [Coût par simulation](#coût-par-simulation)
12. [Langues et accessibilité](#langues-et-accessibilité)
13. [Compatibilité navigateurs](#compatibilité-navigateurs)
14. [À faire avant de vendre](#à-faire-avant-de-vendre)

---

## Arborescence

```
prepOral/
├── index.html                     accueil, coach IA, Mon espace
├── simulateur.html                le simulateur (« Ton oral en trois étapes »)
├── temoignages.html               retours d'utilisateurs, par épreuve
├── moderation.html                console de modération des avis
├── robots.txt · sitemap.xml       référencement
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
│   ├── app.js                     entrée de l'accueil : vues et navigation
│   ├── simulateur.js              entrée du simulateur : déroulé complet
│   ├── temoignages.js             entrée de la page témoignages
│   ├── nav.js                     en-tête partagé par toutes les pages
│   ├── chargement.js              écran d'attente par étapes
│   ├── relecture.js               rouvrir une simulation passée
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
│   ├── i18n.js                    langue de l'interface
│   ├── langues/en.js · es.js      traductions anglaise et espagnole
│   ├── age.js                     déclaration d'âge et consentement parental
│   └── legal.js                   mentions légales, CGV, RGPD, cookies
├── api/
│   ├── _lib/ia.js                 appel au modèle + limitation de débit
│   ├── _lib/quota.js              quota des simulations, côté serveur
│   ├── _lib/supabaseAdmin.js      client service_role
│   ├── verifier-session.js        POST — contrôle réel du paiement Stripe
│   ├── moderation.js              GET/POST — publier ou rejeter un avis
│   ├── questions.js               POST /api/questions
│   ├── feedback.js                POST /api/feedback
│   ├── coach.js                   POST /api/coach
│   ├── create-checkout-session.js POST — redirige vers Stripe Checkout
│   ├── create-portal-session.js   POST — portail d'abonnement Stripe
│   └── webhook.js                 POST — évènements Stripe (source de vérité)
├── tests/                         suite de tests (npm test)
│   ├── csp.test.mjs               la CSP autorise ce que le front charge
│   ├── interface.test.mjs         contrat DOM et promesses commerciales
│   ├── quota.test.mjs             quota serveur contre un faux Supabase
│   ├── moderation.test.mjs        authentification de la modération
│   └── cout.test.mjs              calcul du coût par simulation
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

## Les pages

| Page | Rôle |
|---|---|
| `index.html` | présentation, coach IA et Mon espace (trois vues, `?vue=…`) |
| `simulateur.html` | « Ton oral en trois étapes » : configuration, chargement, simulation, rapport |
| `temoignages.html` | retours d'utilisateurs, filtrables par épreuve, et dépôt d'avis |
| `moderation.html` | publication ou rejet des avis déposés (jeton requis) |

« Essayer gratuitement » mène au simulateur. À la fin d'une simulation, un bouton
renvoie vers **Mes simulations passées**, qui reste dans Mon espace : chaque ligne
s'y rouvre avec les questions posées, les réponses données et la correction
complète de l'examinateur.

Ce détail est conservé **dans le navigateur uniquement**. La synchronisation
Supabase ne transporte que des métadonnées de progression (type d'oral, date,
notes), conformément à la politique de confidentialité : ni les réponses, ni les
documents déposés ne quittent l'appareil.

---

## Tests

```bash
npm test          # 34 tests, sans réseau ni clé d'API
npm run verifier  # régénère la feuille de styles puis lance les tests
```

La suite couvre ce qui casse en silence :

| Fichier | Ce qu'il empêche |
|---|---|
| `csp.test.mjs` | qu'une directive de sécurité bloque une bibliothèque que le front charge — c'est arrivé : la CSP avait cassé l'import de PDF, de DOCX et la lecture optique sans qu'aucun build n'échoue |
| `interface.test.mjs` | qu'une refonte de la page casse le JavaScript (identifiants manquants ou dupliqués), et que de faux avis ou une clé secrète réapparaissent dans le HTML livré |
| `quota.test.mjs` | que le quota gratuit devienne contournable |
| `moderation.test.mjs` | qu'un avis puisse être publié sans le jeton de modération |
| `cout.test.mjs` | qu'une erreur de calcul fausse la décision de prix |

---

## Configuration Stripe

1. Créez trois produits dans le tableau de bord Stripe :

   | Produit | Type de tarif | Montant | Variable |
   |---|---|---|---|
   | **Pass 48 heures** | ponctuel | 4,90 € TTC | `STRIPE_PRICE_PASS48` |
   | **PrepOral Premium** | récurrent mensuel | 9,90 € TTC | `STRIPE_PRICE_MENSUEL` |
   | **PrepOral Extra** | ponctuel | 54,90 € TTC | `STRIPE_PRICE_EXTRA` |

   L'offre Extra est un **paiement unique** couvrant six mois, pas un abonnement :
   rien n'est reconduit et l'échéance est posée par `api/webhook.js`.

2. Copiez les identifiants de tarif (`price_…`) dans les variables correspondantes.

> Les prix affichés viennent uniquement de `js/config.js`, et la modale d'offre
> est rendue à partir de là. Un test refuse tout tarif écrit en dur dans une
> page : un prix affiché qui diffère de celui facturé est une pratique
> commerciale trompeuse.
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
| Lancement de la 3e | modale bloquante : Pass 48 h, Premium mensuel ou Extra 6 mois |
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

> **Compte obligatoire, par défaut.** `EXIGER_CONNEXION` vaut `true` sauf si
> vous écrivez explicitement `false`. Un compte gratuit est donc demandé dès la
> première simulation, et les deux simulations offertes sont rattachées à
> l'identifiant du compte. C'est le seul moyen d'empêcher le tour de passe-passe
> évident : vider son navigateur pour repartir à zéro. Le front s'aligne — le
> bouton « Lancer ma simulation » ouvre la modale d'inscription tant qu'aucune
> session n'existe (`exigerCompte()` dans `js/auth.js`).
>
> À `false`, le quota anonyme repose sur une empreinte IP + navigateur, que
> contournent un VPN, une navigation privée ou un autre appareil : cela relève
> le seuil sans l'étanchéifier.

Le quota n'est décompté **qu'après une génération réussie** : une panne du
modèle ne coûte plus une simulation au candidat.

### Vérification du paiement

`traiterRetourPaiement()` n'accorde plus rien sur la foi de `?paiement=ok`.
Le front envoie le `session_id` à `/api/verifier-session`, qui interroge
Stripe et ne confirme que si la session est réellement payée. Le webhook
(`api/webhook.js`) reste la source de vérité durable en base.

## Modération des avis

Un avis déposé arrive en base avec `publie = false`. Il n'apparaît nulle part
tant qu'il n'a pas été validé.

1. Générez un jeton et placez-le dans `CLE_MODERATION` :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

   - **En production** : Vercel → Settings → Environment Variables → ajoutez
     `CLE_MODERATION`, puis **redéployez** (les variables ne sont lues qu'au
     déploiement).
   - **En local** : la clé est déjà dans `.env.local`, ignoré par git.

2. Ouvrez `https://votre-domaine.fr/moderation.html` et saisissez ce jeton.
   La page liste les avis en attente et permet de les publier ou de les
   supprimer. Elle est en `noindex` et exclue par `robots.txt`.

Sans `CLE_MODERATION`, la route renvoie 503 et aucun avis ne peut être publié.

> **Ne triez pas les avis pour ne garder que les bons.** Publier uniquement les
> avis positifs sans l'indiquer est une pratique commerciale trompeuse, au même
> titre qu'un faux avis (art. L111-7-2 du code de la consommation). Rejetez ce
> qui est illisible, injurieux ou hors sujet — pas ce qui est négatif.

---

## Remplir la page Témoignages

La page est vide au départ, et c'est volontaire : elle n'affiche que des avis
réellement déposés puis vérifiés. **N'y ajoutez pas de témoignages écrits par
vos soins** — publier un faux avis est une pratique commerciale trompeuse
(art. L121-2 du code de la consommation, jusqu'à 2 ans d'emprisonnement et
300 000 € d'amende, portés à 10 % du chiffre d'affaires), et l'art. L111-7-2
impose d'indiquer si les avis sont vérifiés et à quelle date.

Le chemin honnête pour la remplir est déjà en place :

1. À la fin de chaque simulation, un encart invite le candidat à laisser un avis.
2. Le formulaire de `temoignages.html` enregistre l'avis avec `publie = false`
   et l'épreuve concernée.
3. Vous le publiez en un clic depuis `/moderation.html`.

Dès qu'un avis est publié, la note moyenne réellement calculée apparaît sur
l'accueil et sur la page Témoignages, avec la date de collecte. Tant qu'il n'y
en a aucun, aucune note n'est affichée.

---

## Âge et consentement parental

Deux règles distinctes, toutes deux implémentées :

| Situation | Règle | Où |
|---|---|---|
| Moins de 15 ans | accord du représentant légal requis pour le traitement des données (art. 45, loi Informatique et Libertés) | modale de déclaration d'âge, au lancement de la première simulation |
| Tout mineur | ne peut pas souscrire seul un abonnement payant (art. 1145 s. du code civil) | case de confirmation dans la modale d'offre, plus un rappel si l'utilisateur s'est déclaré mineur |

On demande une **tranche d'âge**, jamais une date de naissance : c'est le
minimum nécessaire pour appliquer la règle (minimisation RGPD). La tranche est
stockée dans `profils.tranche_age`.

**Ce qui reste à faire** : sous 15 ans, l'adresse du responsable légal est
collectée mais aucun message ne lui est encore envoyé. Le consentement est donc
déclaratif, pas vérifié. Branchez un envoi d'e-mail avec lien de confirmation
(Resend, Postmark, Supabase Edge Function) pour fermer complètement ce point.

---

## Coût par simulation

Chaque simulation vaut **deux appels** au modèle : génération des questions,
puis correction. Chaque appel journalise une ligne `[cout]` avec le détail des
jetons et une estimation en dollars :

```json
{"route":"questions","modele":"claude-opus-5","jetons_entree":13842,
 "jetons_sortie":870,"dollars":0.09096,"cumul_appels":2,"cumul_dollars":0.1861}
```

Ordres de grandeur, sur la base d'une simulation de cinq questions avec un CV
et une offre d'emploi (~23 000 jetons d'entrée, ~2 900 de sortie au total) :

| Modèle | Coût par simulation | Simulations couvertes par un abonnement à 9,99 € |
|---|---|---|
| `claude-opus-5` (défaut) | ~0,19 $ soit ~0,17 € | ~57 |
| `claude-sonnet-5` | ~0,08 $ soit ~0,07 € | ~144 |

Un abonné qui enchaîne plus d'une cinquantaine de simulations par mois coûte
donc plus qu'il ne rapporte sur Opus. Trois leviers, dans l'ordre :
`MODELE_IA=claude-sonnet-5`, une limite d'usage « équitable » dans les CGV, ou
un prix plus élevé. Mesurez sur vos vrais documents avant de trancher : les
chiffres ci-dessus dépendent directement de la longueur des CV déposés.

---

## Langues et accessibilité

Le site s'affiche en **français, anglais et espagnol**. Le sélecteur est dans
l'en-tête ; le choix est mémorisé, et à défaut la langue du navigateur est
suivie.

Le français reste la langue de référence : il est écrit directement dans le
HTML, les autres langues sont des dictionnaires (`js/langues/`). Une clé sans
traduction retombe donc sur le français plutôt que d'afficher une clé brute —
et un test refuse qu'une clé du balisage manque à un dictionnaire, pour éviter
les pages moitié françaises moitié anglaises.

Trois points comptent pour l'accessibilité, et sont vérifiés par les tests :

- l'attribut `lang` de `<html>` suit la langue choisie, sans quoi un lecteur
  d'écran prononce l'anglais avec un accent français ;
- la **synthèse vocale** utilise le code de voix de la langue (`fr-FR`,
  `en-US`, `es-ES`) ;
- le coach et la correction sont **rédigés** dans la langue choisie : elle est
  transmise à `/api/coach` et `/api/feedback`.

Chaque réponse du coach, le bilan de simulation et chaque correction question
par question portent un bouton **Écouter** : la lecture se déclenche à la
demande, s'arrête d'un second clic, et une seule lecture tourne à la fois.
C'est utile pour préparer un oral — et nécessaire pour qui ne peut pas lire
l'écran.

> **Les textes légaux restent en français.** Mentions légales, CGV et politique
> de confidentialité sont des documents de droit français : une traduction
> approximative y ferait plus de mal que de bien. Faites-les traduire par un
> juriste si vous vendez hors de France.

**Ajouter une langue** : créez `js/langues/<code>.js` sur le modèle de `en.js`,
puis déclarez le code dans `LANGUES` (`js/i18n.js`) avec son étiquette, son
drapeau et son code de voix.

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

### Traité depuis

- **Modération des avis** : console `/moderation.html` + route protégée.
- **Consentement parental** : déclaration d'âge et clause dans les CGV
  (l'envoi du message au responsable légal reste à brancher — voir plus haut).
- **Coût mesuré** : chaque appel journalise ses jetons et son coût estimé.
- **Référencement et partage** : Open Graph, carte Twitter, JSON-LD,
  `robots.txt`, `sitemap.xml`, image de partage.
- **Suite de tests** : 44 tests, dont un qui aurait évité que la politique de
  sécurité casse l'import de documents.
- **Trois langues** (français, anglais, espagnol) avec voix et rédaction de l'IA
  qui suivent le choix, et lecture à voix haute de chaque réponse et correction.

### À votre charge

1. **Mentions légales.** Renseignez le bloc `window.PREPORAL_ENV` dans
   `index.html` : `EDITEUR_NOM`, `EDITEUR_STATUT`, `EDITEUR_SIRET`,
   `EDITEUR_TVA`, `EDITEUR_ADRESSE`, `EDITEUR_EMAIL`, `EDITEUR_DIRECTEUR`,
   `EDITEUR_MEDIATEUR`. Tant que c'est incomplet, un bandeau d'avertissement
   s'affiche en pied de page et les textes légaux signalent chaque mention
   manquante. Le médiateur de la consommation est obligatoire dès la première
   vente à un consommateur. **Faites relire par un juriste** : les textes
   fournis sont un modèle, pas un conseil juridique.
2. **Domaine.** Le site est déclaré sur `https://preporal.vercel.app`, l'URL
   que sert réellement ce dépôt. Pour passer à un domaine personnalisé,
   remplacez-le aux trois endroits — `index.html` (canonique, Open Graph,
   carte Twitter), `robots.txt` et `sitemap.xml` — puis lancez `npm test` :
   un test vérifie que les trois restent d'accord.

   > **`preporal.com` sert un autre site.** Il répond, il est hébergé par
   > Vercel, mais son contenu n'est pas celui de ce dépôt (titre différent,
   > aucune trace de la feuille de styles générée). Il n'a donc **pas** été
   > déclaré comme domaine canonique : une balise canonique pointant vers un
   > autre site revient à demander aux moteurs de recherche de désindexer
   > celui-ci. Si `preporal.com` doit devenir la vitrine de ce projet,
   > faites-le pointer vers ce projet Vercel *avant* de changer le domaine ici.
3. **Vérification du consentement parental.** L'adresse du responsable légal
   est collectée sous 15 ans, mais aucun message ne lui est envoyé : le
   consentement reste déclaratif.
4. **Friction à l'inscription.** `EXIGER_CONNEXION` vaut désormais `true` par
   défaut : le quota gratuit est étanche, mais un compte est demandé avant la
   première simulation. Surveillez le taux d'abandon sur cette étape ; le
   repli `EXIGER_CONNEXION=false` existe, au prix d'un quota contournable.
5. **Prix.** Voir « Coût par simulation » : à 9,99 € sur `claude-opus-5`, un
   abonné devient déficitaire au-delà d'une cinquantaine de simulations par
   mois. Décidez entre un modèle moins cher, une limite d'usage équitable
   inscrite aux CGV, ou un tarif plus élevé.
6. **Purge des empreintes anonymes.** Planifiez la suppression des lignes de
   `usages_anonymes` inactives depuis plus de 6 mois (minimisation RGPD) ;
   la requête est en commentaire dans `supabase/schema.sql`.

---

© PrepOral. Ce dépôt est privé et non licencié pour la redistribution.
