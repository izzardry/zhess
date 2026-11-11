/** Strings owned by package "assist" (see PLAN.md). EN is the source of truth; DE du, FR vous, ES tú. */
import { defineTable } from './define';

export default defineTable({
  en: {
    // 2A · Engine (shown by the Start pill, the hint bulb and toasts; wired by 2C / the integrator)
    'engine.loading': 'Loading the computer',
    'engine.thinking': 'The computer is thinking',
    'engine.failed': 'The computer could not be loaded.',
    'engine.failedOffline': 'The computer needs a connection the first time. After that it also works offline.',
    'engine.retry': 'Try again',
  },
  de: {
    'engine.loading': 'Computer wird geladen',
    'engine.thinking': 'Der Computer denkt nach',
    'engine.failed': 'Der Computer konnte nicht geladen werden.',
    'engine.failedOffline': 'Der Computer braucht beim ersten Mal eine Verbindung. Danach geht er auch offline.',
    'engine.retry': 'Nochmal versuchen',
  },
  fr: {
    'engine.loading': 'Chargement de l’ordinateur',
    'engine.thinking': 'L’ordinateur réfléchit',
    'engine.failed': 'L’ordinateur n’a pas pu être chargé.',
    'engine.failedOffline':
      'L’ordinateur a besoin d’une connexion la première fois. Ensuite, il fonctionne aussi hors ligne.',
    'engine.retry': 'Réessayer',
  },
  es: {
    'engine.loading': 'Cargando el ordenador',
    'engine.thinking': 'El ordenador está pensando',
    'engine.failed': 'No se pudo cargar el ordenador.',
    'engine.failedOffline': 'El ordenador necesita conexión la primera vez. Después funciona también sin conexión.',
    'engine.retry': 'Reintentar',
  },
});
