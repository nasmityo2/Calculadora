# API de cotizaciones DAYZO v2 (+ cálculo v3)

Base: `/api/import-quotes`. Requiere sesión; mutaciones requieren
`X-CSRF-Token`.

## Lista resumida

`GET /api/import-quotes?limit=20&offset=0&search=&company=&plan=all&sort=recent`

- `limit`: 1–50.
- `offset`: 0–1,000,000.
- `plan`: `all`, `with`, `without`.
- `sort`: `recent`, `investment`, `name`, `company`, `profit`.
- Orden estable: cada orden termina en `created_at DESC, id DESC`.
- La lista no contiene el JSON completo. Cada elemento incluye identidad,
  empresa, fecha, inversión, costos y resumen del plan.
- `pagination`: `limit`, `offset`, `total`, `hasMore`, `nextOffset`.
- `facets.companies`: empresas disponibles para el usuario.

Respuesta abreviada:

```json
{
  "success": true,
  "apiVersion": "2",
  "quotes": [],
  "total": 0,
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 0,
    "hasMore": false,
    "nextOffset": null
  },
  "facets": { "companies": [] }
}
```

## Detalle

`GET /api/import-quotes/:uuid`

Devuelve el objeto completo solo si pertenece al usuario autenticado. Un UUID
de otro usuario responde 404 para no revelar existencia.

## Escritura

- `POST /api/import-quotes`
- `PUT /api/import-quotes/:uuid`
- `DELETE /api/import-quotes/:uuid`

POST/PUT aceptan temporalmente campos planos legacy, pero el servidor solo
confía en entradas base y responde/persiste `calculationVersion` igual a
`dayzo-import-v3`. Totales, costos, ROI, margen y ganancias se recalculan.
`empresaEnvioUSD` es alias temporal de `empresaTarifaUSD`.

### Precio de compra v3

Entrada preferida:

```json
{
  "purchasePrice": { "amount": 32.5, "currency": "CNY" }
}
```

- `currency`: solo `CNY` o `USD`.
- CNY se convierte en el servidor con la tasa live (o fallback marcado).
- USD no se reconvierte a la base.
- `cnyRateRequested` del cliente se ignora.
- Se persisten `purchasePriceOriginalAmount`, `purchasePriceOriginalCurrency`,
  `precioMercanciaPorUnidadUSD`, `precioMercanciaPorUnidadCNY`, equivalentes
  finales y `rateSnapshot` (`cny`, `cnySource`, `capturedAt`, `stale`).
- Lecturas legacy v1/v2 se enriquecen con equivalentes CNY usando el snapshot
  congelado (o fallback etiquetado), sin reinterpretar costos USD.

### Envío dentro de China v3

El flete interno chino se cotiza en yuanes tan a menudo como en dólares, así que
acepta la misma forma que el precio de compra:

```json
{
  "envioChinaPrice": { "amount": 28, "currency": "CNY" }
}
```

- `currency`: solo `CNY` o `USD`; a diferencia del precio de compra, `amount`
  puede ser `0`.
- CNY se convierte en el servidor con la misma tasa que el precio de compra.
- `envioChinaPorCajaUSD` sigue aceptándose como entrada legacy (siempre USD) y
  se devuelve siempre, ya convertido.
- La respuesta incluye `envioChinaPrice` con la moneda original, para que
  reeditar una cotización no cambie la moneda en que se escribió.

### Monedas de presentación

Las cotizaciones se leen en **USDT, dólar BCV y yuan**; nunca en bolívares. El
equivalente en dólar BCV se calcula con el **precio de compra** del P2P
(`p2pBuyVesPerUsdt`), nunca con el de venta.

## Error uniforme

```json
{
  "success": false,
  "error": {
    "code": "QUOTE_NOT_FOUND",
    "message": "Cotización no encontrada"
  },
  "message": "Cotización no encontrada"
}
```

El `message` superior es un adaptador temporal. Clientes nuevos deben leer
`error.code` y `error.message`.

## Compatibilidad temporal

`legacy=1&limit<=20` añade `quote` completo para el cliente web anterior y
devuelve un aviso `deprecation`. Se elimina al terminar la migración
resumen/detalle; no debe usarse en clientes nuevos.
