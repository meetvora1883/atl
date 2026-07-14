// middleware/translations.js
const { loadTranslations } = require('../db');

// Global cache – reloaded on server start and after translation updates
let translationsCache = null;

function getTranslations() {
  if (!translationsCache) {
    translationsCache = loadTranslations();
  }
  return translationsCache;
}

function reloadTranslations() {
  translationsCache = loadTranslations();
  return translationsCache;
}

function translationMiddleware(req, res, next) {
  // Determine language: user setting > cookie > default 'en'
  let lang = 'en';
  if (req.user && req.user.settings && req.user.settings.language) {
    lang = req.user.settings.language;
  } else if (req.cookies && req.cookies.language) {
    lang = req.cookies.language;
  }
  // Ensure language exists in translations, fallback to 'en'
  const allTranslations = getTranslations();
  if (!allTranslations[lang]) lang = 'en';

  res.locals.lang = lang;
  res.locals.t = allTranslations[lang] || allTranslations['en'] || {};

  // Expose reload function for admin (e.g., after Language Manager changes)
  res.locals.reloadTranslations = reloadTranslations;

  next();
}

module.exports = {
  translationMiddleware,
  reloadTranslations,
  getTranslations,
};