/* ═══════════════════════════════════════════════════════════
   verrou.js — la file d'attente qui remplace navigator.locks

   supabase-js sérialise ses opérations d'authentification
   derrière un verrou. Dans un navigateur il prend par défaut
   navigator.locks, et il le demande sans délai d'abandon :
   updateUser() appelle _acquireLock(-1, …), or navigatorLock ne
   programme un abandon que si ce délai est strictement positif.
   Un verrou qui n'est pas rendu bloque donc « Enregistrer » pour
   toujours.

   Et il n'était pas rendu : navigator.locks est partagé par tous
   les onglets du domaine, il survit à une page mise en cache
   arrière/avant, et supabase-js le garde pris tant qu'un rappel
   onAuthStateChange n'a pas fini. Le candidat voyait « Le serveur
   n'a pas répondu » au bout de vingt secondes — le serveur avait
   très bien répondu, la requête n'était jamais partie.

   Cette file rend le même service : elle sérialise ce qui se
   passe dans CET onglet, ce dont supabase-js a besoin, sans
   jamais dépendre d'un verrou partagé. Deux onglets qui
   renouvellent leur jeton en même temps est un cas que le serveur
   d'authentification gère déjà.
   ═══════════════════════════════════════════════════════════ */

/**
 * Fabrique un verrou à la manière de supabase-js.
 * @returns {(nom: string, delaiAbandon: number, executer: () => Promise<any>) => Promise<any>}
 */
export function fileDAttente() {
  /* Cette promesse ne porte jamais d'échec : c'est ce que garantit la
     ligne qui la réaffecte plus bas. Une opération ratée est rendue à
     celui qui l'a demandée, et la file, elle, continue — sinon un
     enregistrement refusé condamnerait tous les suivants, et le verrou
     resterait pris jusqu'à la fermeture de l'onglet. */
  let file = Promise.resolve();
  return (_nom, _delaiAbandon, executer) => {
    const resultat = file.then(executer);
    file = resultat.then(() => {}, () => {});
    return resultat;
  };
}
