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
8. [Import de documents et dictée](#import-de-documents-et-dictée)
9. [Comptes et inscription](#comptes-et-inscription)
10. [Fonctionnement du paywall](#fonctionnement-du-paywall)
11. [Modération des avis](#modération-des-avis)
12. [Âge et consentement parental](#âge-et-consentement-parental)
13. [Coût par simulation](#coût-par-simulation)
14. [Langues et accessibilité](#langues-et-accessibilité)
15. [Compatibilité navigateurs](#compatibilité-navigateurs)
16. [À faire avant de vendre](#à-faire-avant-de-vendre)

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

### Mise en place

1. Créez un projet **en région européenne** (RGPD).
2. SQL Editor → collez et exécutez `supabase/schema.sql`. Le script est
   ré-exécutable : relancez-le après chaque mise à jour du dépôt.
3. Authentication → Sign In / Providers : activez *Email* et *Google*
   (renseignez le client OAuth et ajoutez l'URL de redirection de votre domaine).
   Sous *Email*, laissez **Enable email provider** actif et gardez
   **Confirm email** coché : sans confirmation, n'importe qui peut créer un
   compte avec l'adresse d'un tiers.
4. Reportez `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans les variables
   d'environnement Vercel.
5. Dans `index.html`, renseignez le bloc `window.PREPORAL_ENV` avec l'URL du
   projet et la clé **anon public** (ces deux valeurs sont publiques par
   conception ; la clé `service_role`, elle, ne doit jamais y figurer).

Tant que ce bloc reste vide, l'application fonctionne en **mode local** :
historique et avis restent dans le navigateur.

### « Je me connecte, et l'en-tête affiche toujours Connexion »

C'est presque toujours la liste des URL de redirection, pas le code.

Un lien de connexion (lien magique, confirmation d'inscription, retour Google)
ramène le visiteur vers l'URL demandée par le navigateur — **à condition que
Supabase la reconnaisse**. Sinon, il le renvoie silencieusement vers la *Site
URL* du projet. Le jeton part donc sur un autre domaine que celui où le
visiteur se trouvait : la session s'ouvre là-bas, et la page d'origine reste
déconnectée, avec « Connexion » en haut à droite.

Dans **Authentication → URL Configuration** :

| Champ | Valeur |
|---|---|
| **Site URL** | l'adresse de production, sans barre finale — `https://preporal.vercel.app` |
| **Redirect URLs** | une ligne par environnement d'où l'on se connecte |

```
https://preporal.vercel.app/**
https://*-<votre-compte>.vercel.app/**      ← les déploiements de prévisualisation
http://localhost:3000/**                     ← le développement local
https://votre-domaine.fr/**                  ← après branchement du domaine
```

Le `/**` est nécessaire : `js/auth.js` renvoie sur `index.html?vue=compte`
(pour arriver dans *Mon espace*, pas sur l'accueil), et une entrée sans
joker ne couvre ni le chemin ni les paramètres.

Vérifications, dans l'ordre, si le symptôme persiste :

1. Ouvrez le lien reçu par e-mail et regardez l'adresse finale. Si le domaine a
   changé en route, c'est bien la liste ci-dessus.
2. Console du navigateur : `localStorage` doit contenir une clé
   `sb-<projet>-auth-token` après le retour.
3. Un lien de connexion **ne sert qu'une fois** et expire (1 h par défaut,
   *Email OTP Expiration*). Un lien rouvert, ou pré-chargé par un antivirus de
   messagerie, arrive déjà consommé — d'où l'intérêt de proposer aussi le mot
   de passe, ce que fait maintenant l'onglet *Se connecter*.
4. Google OAuth : l'URL `https://<projet>.supabase.co/auth/v1/callback` doit
   figurer dans les *Authorized redirect URIs* de la console Google Cloud.

### « Je m'inscris et je ne reçois aucun message »

Trois causes, dans l'ordre de fréquence.

1. **Le plafond de 2 messages par heure du SMTP intégré.** C'est de loin la
   plus courante en phase de test : on essaie le lien magique deux fois, puis
   on crée un compte, et ce troisième message ne part jamais. Aucune erreur
   n'apparaît dans le navigateur. Attendez une heure, ou branchez un vrai SMTP.
2. **L'adresse a déjà un compte.** `signUp` répond alors « succès » avec un
   utilisateur factice et n'envoie rien : Supabase évite ainsi de révéler qui
   possède un compte. Le seul indice est `identities`, qui revient vide.
   `js/auth.js` le détecte et bascule sur l'onglet *Se connecter* en gardant
   l'adresse saisie, au lieu d'annoncer un e-mail qui ne partira pas.
3. **Le message est dans les indésirables.** Sans SPF ni DKIM sur un domaine à
   vous, c'est le sort ordinaire d'un message d'authentification.

Pour vérifier ce qui est réellement parti : **Authentication → Users**, la
colonne de confirmation dit si l'adresse a été validée ; et
**Logs → Auth Logs** montre chaque tentative d'envoi.

### Des e-mails dans la langue du candidat

Supabase envoie **un seul jeu de modèles**, en anglais par défaut, et n'a pas de
sélecteur de langue. Il faut donc écrire les modèles soi-même. `js/auth.js`
joint la langue de l'interface aux métadonnées du compte, lisible dans les
modèles sous `{{ .Data.langue }}` :

```js
const donnees = (extra = {}) => ({ langue: langue(), ...extra });
```

**Authentication → Emails → Templates**, onglet *Confirm signup* (puis
*Magic Link*, *Reset password*, *Change email address*) :

```html
{{ if eq .Data.langue "en" }}
  <h2>Confirm your account</h2>
  <p>Hi {{ .Data.prenom }}, one click and your two free sessions are yours.</p>
  <p><a href="{{ .ConfirmationURL }}">Confirm my email address</a></p>
  <p>Didn't sign up for PrepOral? Ignore this message.</p>
{{ else if eq .Data.langue "es" }}
  <h2>Confirma tu cuenta</h2>
  <p>Hola {{ .Data.prenom }}: un clic y tus dos simulaciones gratuitas son tuyas.</p>
  <p><a href="{{ .ConfirmationURL }}">Confirmar mi correo</a></p>
  <p>¿No te has registrado en PrepOral? Ignora este mensaje.</p>
{{ else }}
  <h2>Confirmez votre compte</h2>
  <p>Bonjour {{ .Data.prenom }}, un clic et vos deux simulations offertes sont à vous.</p>
  <p><a href="{{ .ConfirmationURL }}">Confirmer mon adresse</a></p>
  <p>Vous n'avez pas créé de compte PrepOral ? Ignorez ce message.</p>
{{ end }}
```

Le français sert de branche par défaut : un compte créé avant cette mise à jour
n'a pas de `langue` en métadonnées et tombe donc sur le français, ce qui vaut
mieux qu'un message vide.

L'objet du message se règle juste au-dessus du corps, dans le même onglet.
La documentation Supabase ne dit rien de l'usage des conditions dans ce champ :
testez-le sur votre projet avant de compter dessus, et prévoyez à défaut un
objet qui passe dans les trois langues — « PrepOral · confirmation /
confirmación » — plutôt qu'un objet anglais devant un corps français.

Quatre points d'attention :

- **Le SMTP intégré plafonne à 2 messages par heure.** Ce n'est pas une
  approximation : c'est le chiffre annoncé par Supabase, qui précise que ce
  service n'est pas destiné à la production. Deux essais de connexion, et le
  troisième message ne part pas — sans erreur côté navigateur, ce qui donne
  l'impression trompeuse que l'inscription a échoué. Avant d'ouvrir les
  inscriptions, branchez un SMTP réel dans **Project Settings → Authentication
  → SMTP Settings** (Resend, Postmark, Brevo…), avec un domaine à vous
  authentifié en SPF + DKIM. Le plafond passe alors à 30 messages par heure,
  relevable dans *Rate Limits*.
- `{{ .Data.prenom }}` est vide pour un compte créé via Google ou via le lien
  magique : écrivez des phrases qui restent lisibles sans prénom.
- `.Data` lit les métadonnées **enregistrées sur le compte**. Elles sont
  écrites à l'inscription, et `js/auth.js` les remet à jour quand un candidat
  connecté change de langue — un message de réinitialisation de mot de passe,
  qui n'accepte aucune donnée au moment de l'envoi, part donc dans la dernière
  langue choisie.
- Les modèles ne sont pas versionnés dans ce dépôt. Gardez-en une copie
  ailleurs : une réinitialisation de projet les efface.
- Testez chaque modèle en créant un compte réel dans chacune des trois langues.
  Le rendu HTML des messages diffère beaucoup d'un client de messagerie à
  l'autre.

### Gérer les comptes depuis supabase.com

**Authentication → Users** est la liste de référence. On y trouve, par compte :

| Action | Où |
|---|---|
| Chercher un candidat | barre de recherche, par adresse |
| Voir la date d'inscription, la dernière connexion, le fournisseur | colonnes de la liste |
| Renvoyer la confirmation, envoyer un lien de connexion, réinitialiser le mot de passe | menu `⋯` en bout de ligne |
| Créer un compte à la main | **Add user** (utile pour un accès de démonstration) |
| Bloquer sans supprimer | `⋯` → *Ban user*, en choisissant la durée |
| Supprimer définitivement | `⋯` → *Delete user* |

Une suppression efface **en cascade** le profil, l'historique des simulations et
le compteur d'usage (`on delete cascade` dans le schéma) : c'est la réponse
technique à une demande d'effacement RGPD. Les avis publiés, eux, ne sont pas
rattachés au compte — supprimez-les au besoin depuis la page de modération.

Le prénom, le nom et la langue ne s'affichent pas dans cette liste : ils vivent
dans la table `profils`, visible dans **Table Editor → profils**. Pour une vue
d'ensemble, SQL Editor :

```sql
-- Comptes récents, avec leur consommation
select p.prenom, p.nom, p.email, p.langue, p.premium, p.plan,
       coalesce(u.simulations, 0) as simulations_utilisees,
       p.cree_le
from public.profils p
left join public.usages u on u.utilisateur_id = p.id
order by p.cree_le desc
limit 50;
```

```sql
-- Offrir un accès Premium (support, presse, partenaire)
update public.profils
set premium = true, plan = 'offert', premium_jusqu_au = now() + interval '3 months'
where email = 'candidat@exemple.fr';
```

```sql
-- Rendre ses deux simulations gratuites à un candidat
delete from public.usages
where utilisateur_id = (select id from public.profils where email = 'candidat@exemple.fr');
```

> Le statut Premium écrit à la main est écrasé au prochain évènement Stripe
> concernant ce client. Pour un accès offert durable, utilisez un compte sans
> abonnement Stripe, ou un coupon Stripe à 100 %.

---

## Mise en production

```bash
npx vercel --prod
```

Puis, dans Vercel → Settings → Environment Variables, ajoutez toutes les clés de
`.env.example`. Redéployez après tout ajout de variable.

---

## Import de documents et dictée

`js/upload.js` extrait le texte d'un CV, d'une offre ou de notes, **entièrement
dans le navigateur** : aucun fichier ne part vers un serveur.

| Format | Bibliothèque | D'où elle vient |
|---|---|---|
| PDF | pdf.js | `assets/vendor/` |
| DOCX | mammoth | `assets/vendor/` |
| Images, PDF scannés | tesseract.js | CDN, à la demande |
| TXT, MD, CSV, JSON… | `FileReader` | le navigateur |

pdf.js et mammoth **étaient chargés depuis un CDN**, et c'était une mauvaise
idée à trois titres : un CDN injoignable — réseau d'entreprise, bloqueur de
publicité, panne — rendait l'import inopérant sans le moindre message ; le
worker de pdf.js, chargé depuis une autre origine, est un cas fragile ; et cela
signalait à un tiers que quelqu'un dépose son CV ici. Ils sont désormais servis
par le site (2 Mo dans `assets/vendor`, chargés seulement au premier import).

Deux gardes complètent la correction, car le symptôme était un **blocage
silencieux** — l'interface restait sur « Lecture de… » indéfiniment :

- un délai de 20 s sur le chargement d'une bibliothèque, car un script qui ne
  répond pas ne déclenche pas toujours `onerror` ;
- un échec n'est plus mémorisé : un incident réseau passager condamnait sinon
  l'import jusqu'au rechargement de la page.

Pour mettre à jour les bibliothèques :

```bash
npm i pdfjs-dist@<version> mammoth@<version>
cp node_modules/pdfjs-dist/build/pdf.min.js         assets/vendor/
cp node_modules/pdfjs-dist/build/pdf.worker.min.js  assets/vendor/
cp node_modules/mammoth/mammoth.browser.min.js      assets/vendor/
npm test
```

Les licences des deux projets sont conservées à côté des fichiers.

### Dicter au lieu de taper

Les deux champs acceptent la **dictée** : taper trois cents caractères au
clavier sur un téléphone décourage avant même d'avoir commencé. Un bouton
« Dicter » sous chaque zone de dépôt écrit la parole dans le champ, où elle
reste modifiable, dans la langue de l'interface. Les navigateurs sans
reconnaissance vocale l'annoncent au lieu d'afficher un bouton mort.

---

## Comptes et inscription

Quatre façons d'entrer, un seul écran. La modale `#modal-auth` a deux onglets ;
`js/auth.js` les pilote.

| Onglet | Chemins | Fonction |
|---|---|---|
| **Se connecter** | mot de passe · lien magique · Google | `connexionMotDePasse()`, `connexionEmail()`, `connexionGoogle()` |
| **Inscription** | prénom, nom, adresse, mot de passe (+ confirmation) · Google | `inscription()` |

Le prénom, le nom et la langue partent dans `options.data` de `signUp` : ils
atterrissent dans `raw_user_meta_data`, d'où le trigger `creer_profil()` les
recopie dans la table `profils`, et d'où les modèles d'e-mail les lisent
(`{{ .Data.prenom }}`).

### Un compte avant la première simulation

`exigerCompte()` garde le bouton « Lancer ma simulation » :

```js
if (!await exigerCompte()) return;   // js/simulateur.js
```

La promesse se résout à `true` dès qu'une session s'ouvre, à `false` si la
modale est refermée sans connexion. Sans clés Supabase renseignées, elle
renvoie `true` : l'application reste utilisable en mode local.

Le motif de la demande est affiché dans la modale (`#auth-raison`), plutôt que
de laisser le candidat deviner pourquoi on lui réclame un compte à cet
instant précis.

### Une fois connecté

Le bouton d'en-tête devient un menu (`#menu-compte`), titré « Mon compte » :
pastille, nom, adresse, statut de l'abonnement, « Gérer mon compte », « Voir
les offres » / « Gérer mon abonnement », « Se déconnecter ». Dans *Mon
espace*, les deux boutons d'entrée disparaissent au profit de « Se
déconnecter ».

La pastille affiche une **photo de profil** si le compte en a une, et une
silhouette sinon. Les comptes Google en apportent déjà une (`avatar_url` dans
les métadonnées). Pour permettre un téléversement, il faudra un compartiment
Supabase Storage : la seule chose à faire ensuite est de renseigner
`session.avatar`, tout le rendu suit.

### Robustesse du chargement

Le client Supabase est importé depuis `esm.sh` au chargement de la page. Un
import qui reste en suspens — CDN injoignable, proxy d'entreprise, bloqueur —
gèlerait toute l'initialisation : en-tête figé sur « Connexion », menu de
compte jamais dessiné. `initAuth()` borne donc cette attente à 8 secondes
(`DELAI_CLIENT`), après quoi l'application continue en mode local plutôt que
de rester muette.

Un lien d'authentification en échec est lu et expliqué : Supabase renvoie
`#error=access_denied&error_code=otp_expired` quand le lien a expiré, a déjà
servi, ou a été pré-chargé par un antivirus de messagerie. Sans cette lecture,
le candidat retombe sur l'accueil, déconnecté, sans le moindre message — le
symptôme le plus déroutant de toute l'authentification.

Le retour après authentification pointe sur `index.html?vue=compte` :

```js
const retour = () => new URL('./index.html?vue=compte', location.href).href;
```

Le candidat arrive donc dans son espace, où l'état du compte est visible — et
non sur l'accueil, où rien ne dit que la connexion a fonctionné. Encore
faut-il que Supabase accepte cette URL : voir *Configuration Supabase → « Je me
connecte, et l'en-tête affiche toujours Connexion »*.

---

## Fonctionnement du paywall

| Étape | Comportement |
|---|---|
| « Lancer ma simulation », sans session | ouvre la modale, onglet *Inscription* |
| Simulations 1 et 2 | gratuites, sans carte, rattachées au compte |
| Fin de la 1re simulation | modale d'offre, fermable (« Plus tard ») |
| Lancement de la 3e | modale bloquante : Pass 48 h, Premium mensuel ou Extra 6 mois |
| Après paiement | retour sur `/?paiement=ok&session_id=…`, **vérifié auprès de Stripe** |
| Résiliation | bouton « Gérer mon abonnement » → portail client Stripe |

Les deux simulations offertes vont **au compte, pas au navigateur** : une
nouvelle inscription les ouvre, et changer d'appareil ou de navigateur ne les
réinitialise pas.

Le quota est **appliqué côté serveur** (`api/_lib/quota.js`), et non plus
seulement affiché dans le navigateur :

- **Premium** (abonnement actif ou pass 48 h valide) → illimité ;
- **connecté sans premium** → compteur dans la table `usages` ;
- **anonyme** → refusé (`code: 'connexion'`), sauf `EXIGER_CONNEXION=false`, qui
  rétablit un compteur dans `usages_anonymes` indexé par une empreinte non
  réversible (IP + navigateur + langue + sel serveur).

Le compteur `localStorage` ne sert plus qu'à l'affichage. `/api/questions`,
`/api/feedback` et `/api/coach` refusent la requête avec un **402** quand le
quota est épuisé ; le front ouvre alors la modale d'offre — ou la modale
d'inscription si le refus porte le code `connexion`.

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

### Le coach IA s'essaie avant de s'acheter

`/api/coach` compte les échanges par jour et par compte
(`MESSAGES_COACH_PAR_JOUR`, 5 par défaut), dans la table `usages_coach` dont la
clé porte la date : le compteur repart seul le lendemain, sans tâche de purge.

- **Abonné** → illimité.
- **Connecté sans abonnement** → 5 échanges par jour, puis la modale d'offre.
- **Sans compte** → refusé (`code: 'connexion'`), la modale d'inscription s'ouvre.

Le front affichait jusqu'ici une réponse hors ligne pour *toute* réponse non-OK,
402 compris : la limite qu'on venait de poser était donc contournée par le
message d'erreur lui-même. Un 402 est désormais traité comme un refus, pas comme
une panne.

### L'offre six mois est devenue un abonnement

Elle était un paiement unique. Deux exigences l'ont fait basculer :

1. **La semaine d'essai.** `trial_period_days` n'existe chez Stripe que sur un
   abonnement. Pendant l'essai, l'abonnement est en statut `trialing`, que le
   webhook traite déjà comme actif : l'accès est complet, et Stripe ne débite
   qu'à la fin.
2. **Le changement de formule.** Le portail client sait échanger un abonnement
   contre un autre ; il ne sait pas transformer un paiement unique en
   abonnement. Passer de mensuel à six mois, ou l'inverse, exigeait donc deux
   abonnements.

> **Reconduction tacite : une obligation vous incombe.** Un abonnement
> semestriel reconduit automatiquement relève de l'art. L215-1 du code de la
> consommation : vous devez informer le client de sa faculté de ne pas
> reconduire, **au plus tôt trois mois et au plus tard un mois** avant
> l'échéance. À défaut, il peut résilier à tout moment et se faire rembourser
> les sommes prélevées après l'échéance. Stripe ne le fait pas pour vous —
> programmez cet envoi, ou renoncez à la reconduction. Les CGV annoncent la
> reconduction ; c'est le rappel avant échéance qui reste à brancher.

Deux corrections liées, trouvées en faisant ce changement :

- `customer.subscription.updated` écrivait `plan: 'mensuel'` en dur. Avec deux
  abonnements, tout abonné Extra aurait été étiqueté « mensuel » dès son premier
  changement de formule. Le plan se lit désormais sur le tarif souscrit
  (`api/_lib/plans.js`).
- `customer.subscription.created` n'était pas écouté. C'est pourtant l'évènement
  qui annonce un abonnement ouvert en essai.
- `DUREES.extra` posait une échéance figée à 183 jours au moment du paiement.
  Sur un abonnement, l'échéance vient de `current_period_end` : la laisser
  aurait maintenu l'accès six mois même après une résiliation.

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

| Modèle | Coût par simulation | Simulations couvertes par un abonnement à 9,90 € |
|---|---|---|
| `claude-opus-5` (défaut) | ~0,19 $ soit ~0,17 € | ~57 |
| `claude-sonnet-5` | ~0,08 $ soit ~0,07 € | ~142 |

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
- **Suite de tests** : 47 tests, dont un qui aurait évité que la politique de
  sécurité casse l'import de documents.
- **Trois langues** (français, anglais, espagnol) avec voix et rédaction de l'IA
  qui suivent le choix, et lecture à voix haute de chaque réponse et correction.
- **Compte obligatoire avant la première simulation**, avec inscription et
  connexion séparées, menu de compte dans l'en-tête, et deux simulations
  offertes rattachées au compte plutôt qu'au navigateur.

### À votre charge

1. **Rappel avant reconduction (offre six mois).** L'art. L215-1 du code de la
   consommation impose d'informer le client de sa faculté de ne pas reconduire,
   entre trois mois et un mois avant l'échéance. Stripe ne l'envoie pas. Sans ce
   rappel, l'abonné peut résilier à tout moment et se faire rembourser les
   sommes prélevées après l'échéance.
2. **Tarif Stripe de l'offre six mois.** `STRIPE_PRICE_EXTRA` doit désormais
   pointer sur un tarif **récurrent de six mois**, et non plus sur un paiement
   unique. Créez-le dans Stripe avant le déploiement, sinon la souscription
   échoue.
3. **Portail client Stripe.** Pour que le changement de formule fonctionne :
   Stripe → Settings → Billing → Customer portal → autorisez la mise à jour
   d'abonnement et listez-y les deux tarifs (mensuel et six mois).
4. **Compartiment `avatars`.** Créé par `supabase/schema.sql` : relancez le
   script pour que les photos de profil fonctionnent.
5. **Modèles d'e-mail Supabase.** Les messages d'authentification partent en
   anglais tant que vous n'avez pas collé les modèles multilingues, et le SMTP
   intégré est limité aux tests. Voir *Configuration Supabase → Des e-mails
   dans la langue du candidat*. C'est le premier contact d'un nouvel inscrit
   avec le service : il ne peut pas rester en anglais sur un site français.
6. **URL de redirection Supabase.** Ajoutez chaque environnement dans
   *Authentication → URL Configuration*, sinon la connexion aboutit sur un
   autre domaine que celui où se trouvait le candidat.
7. **Mentions légales.** Renseignez le bloc `window.PREPORAL_ENV` dans
   `index.html` : `EDITEUR_NOM`, `EDITEUR_STATUT`, `EDITEUR_SIRET`,
   `EDITEUR_TVA`, `EDITEUR_ADRESSE`, `EDITEUR_EMAIL`, `EDITEUR_DIRECTEUR`,
   `EDITEUR_MEDIATEUR`. Tant que c'est incomplet, un bandeau d'avertissement
   s'affiche en pied de page et les textes légaux signalent chaque mention
   manquante. Le médiateur de la consommation est obligatoire dès la première
   vente à un consommateur. **Faites relire par un juriste** : les textes
   fournis sont un modèle, pas un conseil juridique.
8. **Domaine.** Le site est déclaré sur `https://preporal.vercel.app`, l'URL
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
9. **Vérification du consentement parental.** L'adresse du responsable légal
   est collectée sous 15 ans, mais aucun message ne lui est envoyé : le
   consentement reste déclaratif.
10. **Friction à l'inscription.** `EXIGER_CONNEXION` vaut désormais `true` par
   défaut : le quota gratuit est étanche, mais un compte est demandé avant la
   première simulation. Surveillez le taux d'abandon sur cette étape ; le
   repli `EXIGER_CONNEXION=false` existe, au prix d'un quota contournable.
11. **Prix.** Voir « Coût par simulation » : à 9,90 € sur `claude-opus-5`, un
   abonné devient déficitaire au-delà d'une cinquantaine de simulations par
   mois. Décidez entre un modèle moins cher, une limite d'usage équitable
   inscrite aux CGV, ou un tarif plus élevé.
12. **Purge des empreintes anonymes.** Planifiez la suppression des lignes de
   `usages_anonymes` inactives depuis plus de 6 mois (minimisation RGPD) ;
   la requête est en commentaire dans `supabase/schema.sql`.

---

© PrepOral. Ce dépôt est privé et non licencié pour la redistribution.
