/** Strings owned by package "assist" (see PLAN.md): 2A's engine.* and 2C's assist.* keys. EN is the source of truth; DE du, FR vous, ES tú. */
import { defineTable } from './define';

export default defineTable({
  en: {
    // 2A · Engine (shown by the Start pill, the hint bulb and toasts; wired by 2C / the integrator)
    'engine.loading': 'Loading the computer',
    'engine.thinking': 'The computer is thinking',
    'engine.failed': 'The computer could not be loaded.',
    'engine.failedOffline': 'The computer needs a connection the first time. After that it also works offline.',
    'engine.retry': 'Try again',
    // 2C · Assistance
    'assist.drawDeclined': 'Declined',
    'assist.drawAccepted': 'The computer accepts the draw',
    'assist.hintFrom': 'Hint: move the piece on {square}',
    'assist.hintTo': 'Hint: to {square}',
    'assist.hintBusy': 'Looking for a hint',
    'assist.blunderRefused': 'That move looks like a blunder. Play it again to confirm.',
  },
  de: {
    'engine.loading': 'Computer wird geladen',
    'engine.thinking': 'Der Computer denkt nach',
    'engine.failed': 'Der Computer konnte nicht geladen werden.',
    'engine.failedOffline': 'Der Computer braucht beim ersten Mal eine Verbindung. Danach geht er auch offline.',
    'engine.retry': 'Nochmal versuchen',
    'assist.drawDeclined': 'Abgelehnt',
    'assist.drawAccepted': 'Der Computer nimmt das Remis an',
    'assist.hintFrom': 'Tipp: Zieh die Figur auf {square}',
    'assist.hintTo': 'Tipp: nach {square}',
    'assist.hintBusy': 'Tipp wird gesucht',
    'assist.blunderRefused': 'Dieser Zug sieht nach einem groben Fehler aus. Spiel ihn nochmal, um ihn zu bestätigen.',
  },
  fr: {
    'engine.loading': 'Chargement de l’ordinateur',
    'engine.thinking': 'L’ordinateur réfléchit',
    'engine.failed': 'L’ordinateur n’a pas pu être chargé.',
    'engine.failedOffline':
      'L’ordinateur a besoin d’une connexion la première fois. Ensuite, il fonctionne aussi hors ligne.',
    'engine.retry': 'Réessayer',
    'assist.drawDeclined': 'Refusé',
    'assist.drawAccepted': 'L’ordinateur accepte la nulle',
    'assist.hintFrom': 'Indice : jouez la pièce en {square}',
    'assist.hintTo': 'Indice : vers {square}',
    'assist.hintBusy': 'Recherche d’un indice',
    'assist.blunderRefused': 'Ce coup ressemble à une gaffe. Rejouez-le pour confirmer.',
  },
  es: {
    'engine.loading': 'Cargando el ordenador',
    'engine.thinking': 'El ordenador está pensando',
    'engine.failed': 'No se pudo cargar el ordenador.',
    'engine.failedOffline': 'El ordenador necesita conexión la primera vez. Después funciona también sin conexión.',
    'engine.retry': 'Reintentar',
    'assist.drawDeclined': 'Rechazado',
    'assist.drawAccepted': 'El ordenador acepta las tablas',
    'assist.hintFrom': 'Pista: mueve la pieza de {square}',
    'assist.hintTo': 'Pista: a {square}',
    'assist.hintBusy': 'Buscando una pista',
    'assist.blunderRefused': 'Esa jugada parece un error grave. Juégala otra vez para confirmar.',
  },
});
