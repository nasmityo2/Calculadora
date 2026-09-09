# Primer arranque local DAYZO

Máximo cinco comandos:

```bash
npm ci
npm run build:css
npm run doctor:local
npm run dev
```

Luego abre: `http://127.0.0.1:3001/calculadoraa`

## No uses file://

Abrir `public/index.html` desde el explorador **no funciona**: no hay Express, SQLite, sesión ni CSRF. La UI mostrará un aviso explícito.

## Diagnóstico

```bash
npm run doctor:local
```

Valida Node, lockfile, assets locales, CSS, DATA_DIR escribible, puerto y sintaxis del servidor.
