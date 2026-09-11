# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Estado actual del repositorio

**Construido y verificado en local el 11 de septiembre de 2026. Pendiente únicamente de despliegue real (faltan fondos de testnet) y de grabar el vídeo.**

Repo público: https://github.com/zzzbedream/quita

Hecho:
- Los 6 contratos, con los 4 eventos verificados a través de 3 consumidores.
- 79 tests en verde (<2s), 88% de statements / 91% de líneas. Cero errores de tipos.
- Worker persistente, scripts de despliegue, demo end-to-end, dashboard, deck PDF de 10 slides, guion de vídeo y runbook.
- `docs/ATTESTCOIN_INTEGRATION.md` — el documento que puntúa.
- `npm run probe` confirma contra la red real que el precompile ChainInfo responde y que `chainKey 1` es Sepolia.

Pendiente y bloqueado por fondos:
- Despliegue en Sepolia y CC3 (faucet de CC3 = Discord, manual).
- `verify.e2e.ts` nunca se ha ejecutado contra el prover real.
- Rellenar la tabla de direcciones desplegadas del README.
- Grabar el vídeo (campo obligatorio del formulario).

Las decisiones tomadas sin preguntar están en [ASSUMPTIONS.md](ASSUMPTIONS.md), incluidas las premisas técnicas del plan original que resultaron incorrectas y cómo se corrigieron.

---

## Directiva de asunción activa

Aplica en **todas** las sesiones de este proyecto:

- No preguntes por decisiones de implementación. Si algo es ambiguo: elige la opción más simple que funcione, escríbela en `ASSUMPTIONS.md` con una línea de justificación, y sigue.
- Detente solo ante un bloqueo **externo** real (una API que no responde, una credencial que falta). En ese caso implementa un stub que permita avanzar, márcalo con `TODO(BLOQUEO)` y continúa con el resto del tramo.
- Cierra cada sesión con un resumen de 5 líneas: qué quedó hecho, qué asumiste, qué está bloqueado.

Motivo: en un sprint de días, una pregunta bloqueante cuesta más que una suposición corregible.

---

## Producto

**Quita** — capa de seguro de desgravamen (saldo deudor) on-chain. Cuando el deudor de un crédito fallece, la deuda pasa a su familia; el desgravamen la extingue. Quita hace verificables en cadena la siniestralidad, las reservas y las comisiones.

Hackatón: **BUIDL CTC 2026 Fall** (Creditcoin). Track: **RWA**. Desarrollador único.

---

## Arquitectura

Dos cadenas, con separación estricta de responsabilidades:

- **Cadena fuente — Ethereum Sepolia** (`chainKey 1`): `QuitaOrigin.sol`, contrato mínimo que solo emite eventos y lleva la contabilidad justa para que `outstandingAfter` sea correcto.
- **Cadena de ejecución — Creditcoin CC3 Testnet** (EVM): toda la lógica de seguro. `LoanMirror`, `PolicyRegistry`, `CapitalPool`, `ClaimEngine`.
- **Worker off-chain** (`worker/src`): observa Sepolia, genera pruebas de inclusión con `@gluwa/usc-sdk`, y las envía a Creditcoin, donde el precompile `0x0FD2` las verifica de forma síncrona.

Flujo completo: evento en Sepolia → finalidad (~12,8 min) → atestación → `ProofBuilder.getProof` → llamada al contrato en Creditcoin → `verifyAndEmit` del precompile → mutación de estado.

`QuitaConsumer.sol` (que extiende `ASCBase` de `@gluwa/asc-contracts`) es la base de todo contrato que verifica pruebas. El orden completo, y el orden importa:

1. **chainKey fijado** al de la cadena fuente  ← nuestro, en `executeFromSource`
2. calcula `txIndex` desde el merkle proof  ← ASCBase
3. replay: `queryId = keccak256(chainKey, blockHeight, txIndex)`; revierte si ya procesado  ← ASCBase
4. `VERIFIER.verifyAndEmit(...)`; revierte si `false`  ← ASCBase
5. marca procesado  ← ASCBase
6. valida el tipo de transacción  ← nuestro
7. decodifica el recibo y **revierte si `receiptStatus != 1`**  ← nuestro
8. **valida el ADDRESS del emisor**  ← nuestro

`ASCBase.execute` es `external` y NO `virtual`: no se puede sobreescribir y no pasa el `chainKey` al handler. Por eso el entrypoint bueno es `executeFromSource`, y el heredado se deja **inerte** (revierte con `DirectExecuteDisabled`).

---

## Parámetros de red

Confirmados en `docs.attestcoin.org` (añadir `.md` a cualquier URL da markdown limpio):

```
RPC Creditcoin CC3 Testnet : https://rpc.cc3-testnet.creditcoin.network
BlockProver precompile     : 0x0000000000000000000000000000000000000FD2
ChainInfo precompile       : 0x0000000000000000000000000000000000000fd3
Decoder contract           : 0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f
Proof Builder API          : https://proof-gen-api.cc3-testnet.creditcoin.network/
                             (fallback del ejemplo del SDK: https://prover.cc3-testnet.creditcoin.network)
chainKey Ethereum Sepolia  : 1
chainKey Ethereum Mainnet  : 3
SDK                        : @gluwa/usc-sdk (peer dep ethers v6)
Batch                      : máx 10 pruebas, rango 1000 bloques
```

Referencia de código: `github.com/gluwa/usc-testnet-bridge-examples` (`ASCMinter.sol`, `hello-bridge`). **`INativeQueryVerifier.sol` y `EvmV1Decoder.sol` NO están sueltos en ese repo**: se importan del paquete npm `@gluwa/asc-contracts@0.2.1`, que además trae `ASCBase`. Eso obliga a Solidity **0.8.28** y a `viaIR: true`.

**Writability (Creditcoin → Ethereum) no está disponible:** la doc oficial dice que está *"undergoing 3rd party testing and audits"*. La integración es solo lectura Ethereum → Creditcoin. Es la respuesta correcta si el jurado pregunta.

---

## Cuatro advertencias críticas

**(a) El precompile `0x0FD2` es código Rust nativo del runtime, no bytecode.** Un fork de Hardhat no lo tiene. `ASCBase` lo hardcodea y no admite inyección por constructor, así que en local se instala bytecode mock **en la propia dirección `0xFD2` con `hardhat_setCode`** (ver `test/helpers/attestcoin.ts`). Funciona: es lo que hace testeable todo lo demás.

**(b) El precompile no valida si la transacción tuvo éxito.** Hay que comprobar `receiptStatus == 1` a mano. Omitirlo permite probar una transacción **revertida** cuyos logs existieron en la simulación, y colar un siniestro fraudulento.

**(c) Validar la signature del evento no basta: hay que validar también el ADDRESS del emisor** (`_requireLogFrom`), o cualquiera despliega un clon de `QuitaOrigin` y emite eventos falsos.

**(d) El coste de verificación se multiplica ~10x pasadas 24h desde la finalidad.** El worker procesa en cuanto hay finalidad; nunca en batch nocturno.

Los vectores de ataque de (b) y (c) van documentados en NatSpec de 4-5 líneas en el contrato: ese texto se reutiliza en el deck y en `ATTESTCOIN_INTEGRATION.md`.

---

## Invariantes de diseño — no negociables

- **`outstanding` se toma de `outstandingAfter` del evento, nunca se calcula localmente.** Un `RepaymentMade` con `outstandingAfter` mayor que el actual es un evento fuera de orden: se rechaza con un error específico.
- **El monto del siniestro siempre sale del `LoanMirror`, nunca del evento de óbito.** `payout = min(policy.sumInsured, loanMirror.outstanding(loanId))`. Si el atestador miente sobre el monto, da igual: no se lee de ahí.
- **El beneficiario del pago es el LENDER, no la familia.** En desgravamen el asegurado es el deudor y el beneficiario es el acreedor. Es correcto, no un bug.
- **Los siniestros nunca se pausan, ni bajo MCR.** El MCR bloquea `underwrite`, jamás el pago. Un seguro que deja de pagar cuando va mal no es un seguro.
- **Nunca identificadores en claro.** `borrowerCommitment = keccak256(abi.encode(nationalId, loanId, salt))`. Es requisito de protección de datos (LGPD en Brasil), no una preferencia: documéntalo en NatSpec.
- **Separación verificable / confiado.** El fallecimiento es un hecho del mundo real: Attestcoin no puede verificarlo, solo verifica que una transacción ocurrió en Ethereum. La atestación de óbito es **confiada**, mitigada con umbral 2-de-3 y ventana de impugnación. El **monto** es **criptográficamente verificado**. Esa separación es el diseño, no una carencia — y es la slide que gana credibilidad.
- **La tabla de tarificación es un placeholder declarado.** Tasa plana mensual por banda de edad y sexo, constantes hardcodeadas, orden de magnitud 0,02%–0,35% mensual sobre saldo. Marcada con `TABLE_SOURCE = "PLACEHOLDER - pendiente BR-EMS 2021 de SUSEP"`, NatSpec y línea en el README. No implementar Reverse Kelly ni BR-EMS real. Un placeholder honesto vale más que números inventados presentados como reales.
- **La prima se devenga sobre el saldo insoluto vigente, no sobre el principal**, con tasa única de cartera dentro de cada banda y sin sobreprimas.
- **`challengeWindow` es un parámetro configurable**, con setter `onlyOwner` que emite evento. 24h en producción, 2 minutos en demo, y etiquetado visiblemente como tal en el frontend para que no parezca un truco.

---

## Estructura

```
contracts/
  origin/QuitaOrigin.sol            Sepolia. 4 eventos, Ownable, lenders y atestadores registrados
  creditcoin/QuitaConsumer.sol      abstracto, is ASCBase: executeFromSource, receiptStatus, emisor
  creditcoin/LoanMirror.sol         saldo insoluto verificado
  creditcoin/PolicyRegistry.sol     underwrite, accruePremium, syncSumInsured
  creditcoin/CapitalPool.sol        depósitos LP, lockedCapital, MCR, vistas públicas
  creditcoin/ClaimEngine.sol        atestación 2-de-3, ventana de impugnación, settle
  interfaces/INativeQueryVerifier.sol
  libs/EvmV1Decoder.sol             adaptada del repo de Gluwa
  libs/WadMath.sol                  wmul, wdiv sobre 1e18
  mocks/MockNativeQueryVerifier.sol  se instala en 0xFD2 con hardhat_setCode
  mocks/MockStable.sol              ERC20 de 6 decimales
worker/src/    watcher · queue · prover · submitter · index (SQLite vía better-sqlite3)
frontend/      Vite + React + wagmi/viem. Una página, solo lectura + panel de demo
scripts/       probe · deploy.origin · deploy.creditcoin · deploy.all · emit.demo
               verify.e2e · demo.seed · demo.full
test/ docs/ deployments/
```

Las cuatro firmas de evento de `QuitaOrigin` son **exactas** (ver el contrato): `LoanDisbursed`, `RepaymentMade`, `PremiumPaid`, `DeathAttested`. Cualquier cambio rompe los decoders del otro lado.

---

## Comandos

Toolchain: **Hardhat 2.29.1 + TypeScript, Solidity 0.8.28 con `viaIR`, OpenZeppelin, ethers v6.**

```bash
npx hardhat compile
npx hardhat test                                   # objetivo: verde en <30s
npx hardhat test test/LoanMirror.test.ts           # un solo fichero
npx hardhat test --grep "replay"                   # un solo caso (mocha --grep)

npx hardhat run scripts/probe.ts --network creditcoin        # cadenas soportadas + qué URL del prover responde
npx hardhat run scripts/deploy.origin.ts --network sepolia
npx hardhat run scripts/deploy.creditcoin.ts --network creditcoin
npx hardhat run scripts/emit.demo.ts --network sepolia       # devuelve el txHash a verificar
npx hardhat run scripts/verify.e2e.ts --network creditcoin   # Sepolia → Creditcoin, cronometrado por fase

npm run worker            # worker/src/index.ts
npm run dev               # frontend/, Vite
```

Redes en `hardhat.config.ts`: `sepolia` (`SEPOLIA_RPC_URL`) y `creditcoin` (RPC de arriba).

Todo script de demo o verificación debe **cronometrar e imprimir cada fase con timestamp**: esos números se usan en el vídeo.

---

## Tests obligatorios

Con `MockVerifier`, porque el precompile real no existe en local:

- `LoanMirror`: rechazo por replay · rechazo por `receiptStatus != 1` · rechazo por emisor incorrecto · rechazo de amortización fuera de orden · camino feliz.
- `ClaimEngine`: no paga bajo umbral · el mismo atestador no cuenta dos veces · no paga antes de expirar la ventana · una impugnación bloquea el pago · el pago es exactamente `min(sumInsured, outstanding)` · doble `settle` revierte · el pago funciona con el pool bajo MCR.
- `PolicyRegistry`: vectores deterministas de tarificación · devengo tras N días · rechazo por edad · carencia respetada.
- Worker: matar el proceso a mitad de un job y verificar que al reiniciar lo retoma desde SQLite.

---

## Regla de recorte

Orden de sacrificio cuando falte tiempo, de lo primero que cae a lo último:

**frontend → `CapitalPool` → worker (se sustituye por scripts manuales) → `ClaimEngine` → documentación técnica.**

La doc técnica es requisito explícito de submission; el frontend no. Si la verificación end-to-end no sale, se reduce a **un solo evento** (`LoanDisbursed`): un evento verificado de verdad vale más que cuatro a medias.

El único entregable que no se puede saltar es el **vídeo** (campo obligatorio del formulario). Antes se sacrifica el deck.

Fuera de alcance, declarado como roadmap en el README: Reverse Kelly AMM · tabla BR-EMS completa · verificación por lotes · bonds y slashing de atestadores · ERC-4626 completo · mainnet · devengo pro-rata fino · frontend de gestión · cobertura de invalidez.

---

## Entregables de submission

- `docs/ATTESTCOIN_INTEGRATION.md` — requisito explícito de las bases y **puntuación directa**: *"Depth of Attestcoin Protocol utilization will be evaluated as one of the core scoring criteria"*. Contenido exigido en D6, tarea 1 del plan.
- `README.md` con arquitectura, direcciones desplegadas, tabla verificable vs confiado y limitaciones declaradas.
- Deck PDF de 10 slides, generado programáticamente (reveal.js → PDF). Sin tiempo en diseño.
- Vídeo de 3-4 min con hashes reales en ambos exploradores.
- Envío **antes de las 18:00 ET del domingo 13**, no a las 23:00.

**Limitaciones que se declaran siempre, en README y deck:** la atestación de óbito es confiada · la stablecoin es un mock · la tabla de mortalidad es placeholder pendiente de BR-EMS 2021 · no somos la aseguradora, somos infraestructura para prestamistas. Cada limitación declarada por nosotros vale más que la misma descubierta por el jurado. Las cifras de mercado (R$30.000M/año, siniestralidad ~18%, 87% de comisión) van marcadas como *"fuente: análisis de litigio Tema 972, pendiente de contraste con estadísticas públicas de SUSEP"*.

Antes de publicar: revisar **de verdad** que no queden claves privadas, `.env` ni endpoints con API key en el historial de git.
