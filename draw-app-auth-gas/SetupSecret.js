/**
 * One-shot: set AUTH_HMAC_SECRET (run via clasp run, then safe to keep).
 * The live secret is not stored in this repository. Paste it locally before running.
 */
function setupAuthHmacSecret() {
  var expected = 'REPLACE_WITH_AUTH_HMAC_SECRET';
  if (!expected || expected.indexOf('REPLACE_WITH_') === 0) {
    throw new Error('Fill AUTH_HMAC_SECRET locally before running. Do not commit the live secret.');
  }
  PropertiesService.getScriptProperties().setProperty('AUTH_HMAC_SECRET', expected);
  var got = PropertiesService.getScriptProperties().getProperty('AUTH_HMAC_SECRET');
  return { ok: !!got && got.length === expected.length, len: got ? got.length : 0, version: VERSION };
}
