// Chrome MV3 service-worker entry: copy next to background.js when packaging
// for Chrome. Firefox MV2 loads the same files via manifest.json.
//
// bergamot-engine.js is loaded so messages resolve, but local translation does
// not work here: MV3 service workers cannot create a dedicated Worker. Running
// Bergamot on Chrome would need an offscreen document (chrome.offscreen).
importScripts('lang-codes.js', 'bergamot-engine.js', 'background.js');
