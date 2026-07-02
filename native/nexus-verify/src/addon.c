#include <node_api.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "tweetnacl.h"
#include "pubkey.h"

/* TweetNaCl declara randombytes como extern pero NO lo define. Stub seguro:
   solo se usa en keypair generation, no en verificacion. */
void randombytes(unsigned char *x, unsigned long long xlen) {
  (void)x; (void)xlen;
}

/* NOTA: tweetnacl.h define macros que redirigen crypto_sign_open al nombre real
   crypto_sign_ed25519_tweet_open (declarado en el mismo header).
   Usamos ese nombre directamente para evitar ambiguedad. */

/* Verifica firma Ed25519 detached: sm = sig(64) || msg. Devuelve 1 si valida, 0 si no. */
static int ed25519_verify(const unsigned char *pk,
                          const unsigned char *msg, size_t msglen,
                          const unsigned char *sig) {
  unsigned long long smlen = (unsigned long long)msglen + 64ULL;
  unsigned char *sm = (unsigned char *)malloc((size_t)smlen);
  unsigned char *m  = (unsigned char *)malloc((size_t)smlen);
  if (!sm || !m) { free(sm); free(m); return 0; }
  memcpy(sm, sig, 64);
  if (msglen) memcpy(sm + 64, msg, msglen);
  unsigned long long mlen = 0;
  int r = crypto_sign_ed25519_tweet_open(m, &mlen, sm, smlen, pk);
  free(sm); free(m);
  return r == 0 ? 1 : 0;
}

static int get_buffer(napi_env env, napi_value v, unsigned char **data, size_t *len) {
  bool is_buf = false;
  napi_is_buffer(env, v, &is_buf);
  if (!is_buf) return 0;
  void *d = NULL;
  if (napi_get_buffer_info(env, v, &d, len) != napi_ok) return 0;
  *data = (unsigned char *)d;
  return 1;
}

static napi_value SelfTest(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, 424242, &result);
  return result;
}

/* verifyDetachedWithKey(pk32, msgBuf, sig64) -> bool  (utilidad de test/generica) */
static napi_value VerifyWithKey(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_value out;
  unsigned char *pk = NULL, *msg = NULL, *sig = NULL;
  size_t pklen = 0, msglen = 0, siglen = 0;
  if (argc < 3 ||
      !get_buffer(env, args[0], &pk, &pklen) ||
      !get_buffer(env, args[1], &msg, &msglen) ||
      !get_buffer(env, args[2], &sig, &siglen) ||
      pklen != 32 || siglen != 64) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  napi_get_boolean(env, ed25519_verify(pk, msg, msglen, sig) ? true : false, &out);
  return out;
}

/* verifyDetached(msgBuf, sig64) -> bool  (usa la clave EMBEBIDA, uso en produccion) */
static napi_value VerifyEmbedded(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_value out;
  unsigned char *msg = NULL, *sig = NULL;
  size_t msglen = 0, siglen = 0;
  if (argc < 2 ||
      !get_buffer(env, args[0], &msg, &msglen) ||
      !get_buffer(env, args[1], &sig, &siglen) ||
      siglen != 64) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  napi_get_boolean(env, ed25519_verify(NEXUS_PUBKEY, msg, msglen, sig) ? true : false, &out);
  return out;
}

/* getEmbeddedPubKey() -> Buffer(32) */
static napi_value GetPubKey(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value buf; void *data = NULL;
  napi_create_buffer_copy(env, 32, NEXUS_PUBKEY, &data, &buf);
  return buf;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, SelfTest, NULL, &fn);
  napi_set_named_property(env, exports, "selfTest", fn);
  napi_create_function(env, NULL, 0, VerifyWithKey, NULL, &fn);
  napi_set_named_property(env, exports, "verifyDetachedWithKey", fn);
  napi_create_function(env, NULL, 0, VerifyEmbedded, NULL, &fn);
  napi_set_named_property(env, exports, "verifyDetached", fn);
  napi_create_function(env, NULL, 0, GetPubKey, NULL, &fn);
  napi_set_named_property(env, exports, "getEmbeddedPubKey", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
