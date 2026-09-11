# Sprint de 6 días — Quita · BUIDL CTC 2026 Fall

**Hoy: lunes 7 de septiembre de 2026. Deadline: domingo 13 de septiembre, 23:59 ET.**
Solo, con Solidity. Hardhat + TypeScript.

---

## 0. Corrección y estado real

Mis documentos anteriores planificaban del 13 de agosto al 6 de septiembre. Esa ventana ya pasó. El deadline se extendió al **13 de septiembre**, así que tienes **6 días completos + hoy**.

Lo que eso cambia:

- El alcance del PRD no cabe. Recorte agresivo, decidido abajo.
- La regla de "original work created during the hackathon" **ya no es un problema**: las submissions abrieron el 13 de agosto, empezar hoy es perfectamente conforme.
- El AMA del 18 de agosto ya pasó. Hay grabación: https://youtu.be/HPL6LjTqQm4 — **mírala en x1.5 mientras haces el scaffold del día 1.** Suele contener criterios de evaluación que no están escritos.

### Cambios en las bases que también corrijo

| Antes | Ahora |
|---|---|
| Docs en `docs.creditcoin.org/creditcoin-usc` | **`docs.attestcoin.org`** (dominio nuevo) |
| "verify events from other blockchains" | "verified cross-chain data **and messaging**" |
| Deadline 6 sep | **13 sep, 23:59 ET** |
| Anuncio 18 sep | **20 sep** |

**Sobre "messaging":** la página de Attestcoin Writability dice literalmente que está *"undergoing 3rd party testing and audits"* y que se documentará *"once the writability feature is mature and released on Creditcoin testnet"*. **No está disponible.** Sigue siendo solo lectura Ethereum → Creditcoin. Si alguien en el jurado pregunta, esa es tu respuesta y demuestra que leíste la doc de verdad.

**URL del Proof Builder resuelta:** la tabla de entornos de `docs.attestcoin.org` confirma `https://proof-gen-api.cc3-testnet.creditcoin.network/` para CC3 Testnet. El ejemplo del SDK usa `prover.cc3-testnet...`. Usa la de la tabla; si falla, prueba la otra.

---

## 1. Alcance recortado — decidido, no negociable

### Entra

- Contrato fuente en Sepolia con **4 eventos**
- Verificación Attestcoin: `receiptStatus`, validación de emisor, replay protection
- `LoanMirror`: saldo insoluto verificado criptográficamente
- `PolicyRegistry`: pólizas con tasa plana por banda de edad
- `Pool`: capital simple, MCR como circuit breaker
- `ClaimEngine`: atestación 2-de-3, ventana de impugnación, pago al prestamista
- Worker con cola persistente
- Dashboard de una página
- `ATTESTCOIN_INTEGRATION.md` (obligatorio en las bases)
- Deck + vídeo

### Sale — y se declara como roadmap en el README

Reverse Kelly AMM · tabla BR-EMS completa · verificación por lotes · bonds y slashing de atestadores · ERC-4626 completo · despliegue en mainnet · devengo de prima pro-rata fino · frontend de gestión · cobertura de invalidez.

> **Regla de recorte durante el sprint:** si el día 3 vas retrasado, sacrifica el Pool antes que el ClaimEngine, y el frontend antes que la documentación técnica. La doc técnica es requisito explícito de submission; el frontend no.

---

## 2. Calendario

| Día | Fecha | Objetivo | Estado al cerrar |
|---|---|---|---|
| D1 | Lun 7 | Scaffold + `QuitaOrigin` en Sepolia | Contrato desplegado, eventos emitiéndose |
| D2 | Mar 8 | **Verificación real end-to-end** | Una tx de Sepolia verificada en Creditcoin |
| D3 | Mié 9 | Worker + PolicyRegistry | Póliza creada automáticamente desde evento |
| D4 | Jue 10 | Pool + ClaimEngine | Siniestro pagado end-to-end |
| D5 | Vie 11 | Frontend + despliegue + seed | Demo ejecutable de principio a fin |
| D6 | Sáb 12 | Docs + deck + vídeo | Todo grabado y escrito |
| — | Dom 13 | Colchón y submission | Enviado antes de las 18:00 ET |

**D2 es el día que decide el proyecto.** Si el martes por la noche no has verificado una transacción real, el miércoles cambias de estrategia: reduces a un solo tipo de evento y priorizas que *algo* funcione.

---

## 3. Prompts

Instrucciones de uso: pega cada prompt completo en una sesión nueva de Claude Code. D1 crea el `CLAUDE.md` que las sesiones posteriores leen solas.

**Todos los prompts llevan una directiva de asunción activa.** No quiero que Claude Code se detenga a preguntar: quiero que decida, documente la decisión en `ASSUMPTIONS.md` y siga. En 6 días una pregunta bloqueante cuesta más que una suposición corregible.

---

### D1 · Lunes 7 — Scaffold y cadena fuente

```
Vas a construir "Quita" para el hackatón BUIDL CTC 2026 Fall de Creditcoin.
Deadline: 13 de septiembre 23:59 ET. Hoy es 7 de septiembre. Soy un solo
desarrollador. La velocidad importa más que la elegancia.

=== DIRECTIVA DE ASUNCIÓN ACTIVA ===
NO me preguntes por decisiones de implementación. Si algo es ambiguo:
  1. Elige la opción más simple que funcione
  2. Escríbela en ASSUMPTIONS.md con una línea de justificación
  3. Sigue adelante
Solo detente si encuentras un bloqueo EXTERNO real (una API que no responde, una
credencial que falta). En ese caso, implementa un stub que permita seguir
avanzando, márcalo con TODO(BLOQUEO) y continúa con el resto del tramo.
Al final de la sesión, dame un resumen de 5 líneas: qué quedó hecho, qué asumiste,
qué está bloqueado.
=====================================

=== PRODUCTO ===
Quita es una capa de seguro de desgravamen (saldo deudor) on-chain.
Cuando el deudor de un crédito fallece, la deuda pasa a su familia. El seguro de
desgravamen la extingue. En Brasil ese mercado mueve R$30.000 millones al año en
primas y devuelve menos del 20% en siniestros, con hasta 87% de la prima
capturada como comisión bancaria. Quita hace lo mismo con la siniestralidad, las
reservas y las comisiones verificables en cadena.
Track del hackatón: RWA.

=== ARQUITECTURA ===
- Cadena fuente: Ethereum Sepolia (chainKey 1). Contrato mínimo, solo eventos.
- Cadena de ejecución: Creditcoin CC3 Testnet (EVM). Toda la lógica.
- Un worker off-chain observa Sepolia, genera pruebas de inclusión con
  @gluwa/usc-sdk, y las envía a Creditcoin donde el precompile 0x0FD2 las
  verifica de forma síncrona.

Parámetros de red (confirmados en docs.attestcoin.org):
  RPC Creditcoin CC3 Testnet : https://rpc.cc3-testnet.creditcoin.network
  BlockProver precompile     : 0x0000000000000000000000000000000000000FD2
  ChainInfo precompile       : 0x0000000000000000000000000000000000000fd3
  Decoder contract           : 0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f
  Proof Builder API          : https://proof-gen-api.cc3-testnet.creditcoin.network/
      (el ejemplo del SDK usa https://prover.cc3-testnet.creditcoin.network —
       si la primera falla, prueba la segunda y anota cuál funciona)
  chainKey Ethereum Sepolia  : 1
  chainKey Ethereum Mainnet  : 3
  SDK                        : @gluwa/usc-sdk (peer dep ethers v6)
  Batch                      : máx 10 pruebas, rango 1000 bloques

=== CUATRO ADVERTENCIAS CRÍTICAS ===
(a) El precompile 0x0FD2 es código Rust nativo del runtime, NO bytecode. Un fork
    de Hardhat no lo tiene. Todo contrato que verifique debe recibir el
    verificador por INTERFAZ INYECTADA en el constructor, nunca hardcodeado.
    Sin esto no hay tests locales posibles.
(b) El precompile NO valida si la transacción tuvo éxito. Hay que comprobar
    receiptStatus == 1 manualmente. Omitirlo permite probar una transacción
    revertida y colar un siniestro falso.
(c) Validar solo la signature del evento NO basta: hay que validar también el
    ADDRESS del emisor, o cualquiera despliega un clon y emite eventos falsos.
(d) El coste de verificación se multiplica ~10x pasadas 24h desde la finalidad.
    El worker debe procesar pronto, no en batch nocturno.

=== TAREAS DE HOY ===

1. Scaffold Hardhat + TypeScript. Solidity ^0.8.23. OpenZeppelin. dotenv.
   Redes: sepolia (SEPOLIA_RPC_URL) y creditcoin (RPC de arriba).
   Estructura: contracts/{origin,creditcoin,libs,interfaces,mocks}
               worker/src  frontend  scripts  test  docs  deployments

2. Instala @gluwa/usc-sdk y ethers v6. Escribe scripts/probe.ts que:
   - consulte las cadenas soportadas vía PrecompileChainInfoProvider
   - compruebe con fetch cuál de las dos URLs del Proof Builder responde
   - imprima el resultado
   Ejecútalo contra CC3 Testnet y anota los resultados en ASSUMPTIONS.md.

3. contracts/origin/QuitaOrigin.sol — lógica mínima, solo eventos.
   Estos cuatro eventos con estas firmas EXACTAS:

   event LoanDisbursed(bytes32 indexed loanId, bytes32 indexed borrowerCommitment,
       address lender, uint256 principal, uint32 termMonths, uint8 ageBand, uint8 sex);
   event RepaymentMade(bytes32 indexed loanId, uint256 amount, uint256 outstandingAfter);
   event PremiumPaid(bytes32 indexed loanId, uint256 amount, uint64 periodIndex);
   event DeathAttested(bytes32 indexed borrowerCommitment, bytes32 indexed loanId,
       uint64 dateOfDeath, bytes32 evidenceHash, address attestor);

   Reglas:
   - borrowerCommitment = keccak256(abi.encode(nationalId, loanId, salt)).
     NUNCA identificadores en claro. Coméntalo en NatSpec: es requisito de
     protección de datos (LGPD en Brasil), no una preferencia.
   - ageBand: bandas de 5 años desde 18. sex: 0=F, 1=M. Necesarios para tarificar.
   - Ownable. Solo lenders registrados emiten eventos de préstamo. Solo
     atestadores registrados emiten DeathAttested.
   - Contabilidad mínima: lo justo para que outstandingAfter sea correcto.

4. Tests de QuitaOrigin: control de acceso, emisión correcta, rechazo de no
   autorizados. Objetivo: verde en menos de 30 segundos.

5. scripts/deploy.origin.ts + despliegue REAL en Sepolia. Guarda direcciones en
   deployments/sepolia.json. Verifica el contrato en Etherscan si tienes API key;
   si no, sáltatelo y anótalo.

6. scripts/emit.demo.ts que emita un LoanDisbursed real y me devuelva el txHash.
   Lo necesito mañana para la primera verificación.

7. CLAUDE.md en la raíz con: producto, track, arquitectura, todos los parámetros
   de red de arriba, las cuatro advertencias críticas, el calendario de 6 días, y
   la directiva de asunción activa para que la respetes en sesiones futuras.

8. ASSUMPTIONS.md inicializado con lo que hayas asumido hoy.

Prioriza en este orden: 1, 3, 5, 6, 7, 2, 4, 8. Si te quedas sin tiempo, lo que
NO puede faltar es un QuitaOrigin desplegado en Sepolia con un txHash de
LoanDisbursed real en la mano.
```

---

### D2 · Martes 8 — Verificación Attestcoin · **DÍA CRÍTICO**

```
Continúa el proyecto Quita. Lee CLAUDE.md y ASSUMPTIONS.md primero.
Aplica la directiva de asunción activa: decide, documenta, sigue.

HOY ES EL DÍA QUE DECIDE EL PROYECTO. El objetivo único es ver una transacción
real de Sepolia verificada criptográficamente en Creditcoin CC3 Testnet.
Todo lo demás es secundario. Si a media tarde no funciona, simplifica hasta que
funcione: un solo tipo de evento, sin batch, sin optimizar.

RECURSOS: clona github.com/gluwa/usc-testnet-bridge-examples y usa USCMinter.sol
y hello-bridge como referencia. Copia y adapta en vez de escribir desde cero.
La doc está en docs.attestcoin.org (añade .md a cualquier URL para markdown limpio).

TAREAS

1. contracts/interfaces/INativeQueryVerifier.sol
   Interfaz exacta del precompile: structs MerkleProof, MerkleProofEntry,
   ContinuityProof; funciones verify y verifyAndEmit. Sácala del repo de ejemplos.

2. contracts/libs/EvmV1Decoder.sol
   Adáptala del repo de Gluwa. Necesito: getTransactionType, isValidTransactionType,
   decodeReceiptFields, decodeCommonTxFields, getLogsByEventSignature.
   Si la librería del repo tiene más funciones de las que necesito, cópiala entera
   igual. No optimices.

3. contracts/creditcoin/UscConsumer.sol — abstracto.

   El verificador se recibe por constructor como INativeQueryVerifier. Nunca
   hardcodeado. Razón en CLAUDE.md advertencia (a).

   Función interna _consume(...) en este orden exacto:
     a) calcula txIndex desde el merkle proof
     b) replay: bytes32 key = keccak256(abi.encodePacked(chainKey, blockHeight,
        txIndex)); revierte si ya procesado
     c) VERIFIER.verifyAndEmit(...); revierte si false
     d) marca procesado
     e) valida tipo de transacción
     f) decodifica recibo y REVIERTE SI receiptStatus != 1
     g) devuelve ReceiptFields

   El paso (f) es una vulnerabilidad real. Escribe un comentario NatSpec de 4-5
   líneas explicando el vector de ataque: sin esta comprobación, un atacante
   prueba una transacción REVERTIDA cuyos logs existieron en la simulación y
   cuela un siniestro fraudulento. Este comentario va a ir en el deck.

   Añade _requireLogFrom(receipt, expectedEmitter, eventSig) que valide que el log
   proviene del address de QuitaOrigin, con NatSpec explicando el ataque del clon.

4. contracts/mocks/MockVerifier.sol — implementa la interfaz, devuelve
   true/false configurable. Para tests locales.

5. contracts/creditcoin/LoanMirror.sol is UscConsumer

   struct Loan { bytes32 borrowerCommitment; address lender; uint256 principal;
                 uint256 outstanding; uint32 termMonths; uint8 ageBand; uint8 sex;
                 uint64 openedAt; bool active; }
   mapping(bytes32 => Loan) public loans;

   ingestDisbursement(...) e ingestRepayment(...): reciben los parámetros de
   prueba, llaman a _consume, extraen el log por signature, validan el emisor,
   actualizan estado.

   INVARIANTE: outstanding se toma de outstandingAfter del evento. Nunca se
   calcula localmente. Si llega un RepaymentMade con outstandingAfter MAYOR que
   el actual, es un evento fuera de orden: rechaza con un error específico.

6. Tests locales con MockVerifier, los cinco obligatorios:
   - rechazo por replay
   - rechazo por receiptStatus != 1
   - rechazo por emisor incorrecto
   - rechazo de amortización fuera de orden
   - camino feliz completo

7. scripts/deploy.creditcoin.ts — despliega LoanMirror en CC3 Testnet inyectando
   0x0FD2. Guarda en deployments/creditcoin.json.

8. scripts/verify.e2e.ts — EL SCRIPT DEL DÍA. Toma el txHash de LoanDisbursed
   que generamos ayer y:
   - resuelve chainKey y espera atestación con waitUntilHeightAttested
   - genera la prueba con ProofBuilder.getProof
   - llama a LoanMirror.ingestDisbursement con todos los componentes de la prueba
   - imprime el estado del préstamo tras la verificación
   - cronometra cada fase y lo imprime (lo necesito para el vídeo)

CRITERIO DE ÉXITO DEL DÍA: verify.e2e.ts se ejecuta y el préstamo aparece en
Creditcoin con el saldo correcto, habiendo sido verificado por el precompile real.

Si a las 6 horas de sesión no funciona, para y dime exactamente dónde falla, con
el error completo. No sigas dando vueltas.
```

---

### D3 · Miércoles 9 — Worker y pólizas

```
Continúa Quita. Lee CLAUDE.md y ASSUMPTIONS.md. Directiva de asunción activa activa.

Ayer conseguimos verificación end-to-end manual. Hoy la automatizamos y añadimos
la capa de seguro.

PARTE A — WORKER (worker/src, TypeScript, ethers v6, @gluwa/usc-sdk, better-sqlite3)

watcher.ts   observa los 4 eventos de QuitaOrigin en Sepolia. Persiste el último
             bloque procesado en SQLite.
queue.ts     tabla jobs(txHash PK, eventType, blockNumber, status, attempts,
             lastError, createdAt). status: pending|proving|submitting|done|failed
prover.ts    waitUntilHeightAttested → getProof. Backoff exponencial. Timeout 15m.
submitter.ts enruta por eventType al contrato correcto, firma y envía.
index.ts     bucle orquestador.

No negociables:
- IDEMPOTENCIA: el contrato ya protege contra replay, pero no quiero quemar gas
  en duplicados. Marca submitted antes de confirmar y reconcilia al arrancar.
- PERSISTENCIA: si mato el proceso, al reiniciar retoma desde disco.
- PRONTITUD: procesa en cuanto hay finalidad (~12,8 min en Ethereum). No acumules:
  el coste se multiplica ~10x pasadas 24h.
- LOGGING con timestamps por fase. Lo necesito para el vídeo.

Test: mata el worker a mitad de un job y verifica que al reiniciar lo retoma.

PARTE B — PÓLIZAS

contracts/libs/WadMath.sol: wmul, wdiv sobre 1e18.

contracts/creditcoin/PolicyRegistry.sol
  struct Policy { bytes32 loanId; uint256 sumInsured; uint256 premiumRateWad;
                  uint64 waitingPeriodEnd; uint64 lastAccrualAt;
                  uint256 premiumsAccrued; Status status; }
  enum Status { Pending, Active, Claimed, Lapsed }

  TARIFICACIÓN — DECISIÓN TOMADA, NO LA CAMBIES:
  Tasa plana mensual por banda de edad y sexo, en una tabla hardcodeada como
  constantes. NO implementes Reverse Kelly. NO uses BR-EMS real (no tengo los
  datos). Usa valores placeholder razonables (orden de magnitud: 0,02% a 0,35%
  mensual sobre saldo según edad) y MÁRCALOS CLARAMENTE:
    - constante TABLE_SOURCE = "PLACEHOLDER - pendiente BR-EMS 2021 de SUSEP"
    - comentario NatSpec en la tabla
    - línea en el README
  Prefiero un placeholder honesto y declarado que números inventados presentados
  como reales. Esto va a salir en el deck como limitación declarada.

  Reglas normativas del desgravamen que SÍ hay que respetar:
  - Tasa ÚNICA de cartera dentro de cada banda, sin sobreprimas
  - La prima se devenga sobre el SALDO INSOLUTO vigente, no sobre el principal
  - Periodo de carencia configurable
  - Límites de edad de entrada

  underwrite(loanId): lee LoanMirror, valida edad, calcula tasa, crea póliza.
  accruePremium(loanId): devenga pro rata. Versión simple: días transcurridos.
  syncSumInsured(loanId): sigue al outstanding del LoanMirror.

Tests: vectores deterministas de tarificación, devengo tras N días, rechazo por
edad, carencia respetada.

Al cerrar el día quiero: emito un LoanDisbursed en Sepolia, no toco nada más, y
al cabo de ~15 minutos aparece una póliza activa en Creditcoin.
```

---

### D4 · Jueves 10 — Capital y siniestros

```
Continúa Quita. Lee CLAUDE.md y ASSUMPTIONS.md. Directiva de asunción activa.

Hoy cerramos el ciclo económico completo. Al final del día quiero un siniestro
pagado end-to-end.

PARTE A — POOL (versión simplificada, NO ERC-4626 completo)

contracts/mocks/MockStable.sol: ERC20 de 6 decimales. Documentar en README que
es un mock que representa una unidad estable.

contracts/creditcoin/CapitalPool.sol — simple y correcto:
  - deposit / withdraw de LP con contabilidad de participaciones proporcional
  - lockedCapital = suma de sumInsured de pólizas activas
  - freeCapacity() = totalAssets - lockedCapital
  - mcr gobernable. Si totalAssets < mcr, underwrite REVIERTE.
    LOS SINIESTROS NUNCA SE PAUSAN, ni bajo MCR. Documéntalo en NatSpec:
    un seguro que deja de pagar cuando va mal no es un seguro.
  - Vistas públicas, son el argumento de venta entero:
      lossRatioWad() = claimsPaid / premiumsCollected
      solvencyRatioWad() = totalAssets / mcr
      totalPremiumsCollected, totalClaimsPaid, activePolicyCount
  - Solo ClaimEngine puede retirar, y solo para pagar siniestros.

PARTE B — SINIESTROS

contracts/creditcoin/ClaimEngine.sol is UscConsumer

  MODELO DE CONFIANZA — escríbelo en NatSpec al inicio del contrato, tal cual:
  "El fallecimiento es un hecho del mundo real. El Attestcoin Protocol no puede
  verificarlo: solo verifica que una transacción ocurrió en Ethereum. Por tanto
  la atestación de óbito es CONFIADA, mitigada con umbral m-de-n y ventana de
  impugnación. El MONTO pagado, en cambio, es CRIPTOGRÁFICAMENTE VERIFICADO:
  proviene del saldo insoluto reconstruido en LoanMirror desde eventos probados
  de Ethereum. Esa separación es el diseño, no una carencia."

  Registro de atestadores embebido, SIN bonds ni slashing (fuera de alcance):
  mapping(address => bool) isAttestor; uint8 threshold = 2; addAttestor/removeAttestor.

  Máquina de estados:
  submitAttestation(...) — _consume, valida emisor, extrae DeathAttested,
    incrementa contador para ese commitment. Un atestador no cuenta dos veces.
    Al alcanzar threshold: challengeDeadline = now + challengeWindow;
    estado = Challenged.
  challenge(commitment) — solo atestadores. Pasa a Disputed. Bloquea el pago.
  settle(commitment) — solo tras challengeDeadline, sin impugnaciones:
    payout = min(policy.sumInsured, loanMirror.outstanding(loanId))
    Paga al LENDER. En desgravamen el asegurado es el deudor pero el beneficiario
    es el acreedor. Esto es correcto, no un error.
    Cierra póliza, libera lockedCapital, registra el siniestro en el pool.

  challengeWindow es una variable configurable. En producción 24 horas; para el
  demo la pondremos en 2 minutos. Expón un setter con onlyOwner y emite evento
  al cambiarla, para que quede claro que es un parámetro y no un truco.

  EL MONTO SIEMPRE SALE DEL LoanMirror, NUNCA del evento de óbito. Si el atestador
  miente sobre el monto, da igual: no se lee de ahí. Coméntalo.

Tests obligatorios:
  - no paga por debajo del umbral
  - el mismo atestador no cuenta dos veces
  - no paga antes de que expire la ventana
  - una impugnación bloquea el pago
  - el pago es exactamente min(sumInsured, outstanding)
  - doble settle revierte
  - el pago funciona con el pool bajo MCR

CRITERIO DE ÉXITO: script que emite DeathAttested desde dos atestadores en
Sepolia, el worker lo procesa, pasa la ventana, y el prestamista recibe el pago
exacto en Creditcoin.
```

---

### D5 · Viernes 11 — Frontend, despliegue y datos de demo

```
Continúa Quita. Lee CLAUDE.md. Directiva de asunción activa.
Hoy NO se añaden features. Solo se hace visible y ensayable lo que ya existe.

PARTE A — FRONTEND (frontend/, Vite + React + wagmi/viem)

UNA página. Solo lectura salvo los botones de demo. Sin login, sin onboarding.
Estética sobria: es un producto de seguros. Los números tienen que leerse en un
vídeo comprimido a 1080p, así que tipografía grande y buen contraste.

Bloques, en este orden vertical:

1. CABECERA DE CONFIANZA — lo más grande de la pantalla
   - Siniestralidad en vivo, con la referencia al lado: "mercado brasileño ~18%"
   - Ratio de solvencia sobre MCR
   - Reservas y capacidad libre
   - Saldo insoluto total asegurado

2. PÓLIZAS ACTIVAS
   Tabla: loanId truncado, saldo asegurado, prima devengada, banda de edad, estado.

3. FLUJO DE VERIFICACIÓN ATTESTCOIN — la sección que demuestra que es real
   Últimas transacciones verificadas: hash de Sepolia, tipo de evento, bloque,
   hash de la tx de Creditcoin que la verificó, y enlaces a AMBOS exploradores.
   Es la prueba visual de que la verificación ocurre.

4. PANEL DE DEMO
   Botones que llaman a QuitaOrigin en Sepolia: originar crédito, amortizar,
   atestar óbito (x2 atestadores), liquidar.
   Tras la segunda atestación, temporizador visible de la ventana de impugnación.
   Etiqueta bien visible: "ventana acortada a 2 minutos para demostración".

PARTE B — DESPLIEGUE Y SEED

scripts/deploy.all.ts — despliegue reproducible completo, guardando direcciones.

scripts/demo.seed.ts — estado inicial creíble:
  - 8 a 12 préstamos, distintas bandas de edad y sexo
  - historial de amortizaciones de varios meses
  - primas devengadas
  - UN SINIESTRO YA PAGADO con su histórico
  Lo del siniestro pagado es lo más importante: la siniestralidad no puede salir
  en 0% en el vídeo, y la única prueba que importa en un seguro es que paga.

scripts/demo.full.ts — recorrido end-to-end automatizado y cronometrado:
  originar → amortizar → atestar x2 → ventana → liquidar. Logs de tiempo por fase.

PARTE C — ENSAYO

Ejecuta el recorrido completo TRES veces desde cero. Anota tiempos por fase y
puntos de fallo posibles. Escribe docs/DEMO_RUNBOOK.md con el guion exacto y un
plan B para cada punto de fallo: RPC caído, prover lento, atestación que tarda,
transacción que no confirma.

Revisa que no queden claves privadas, .env ni endpoints con API key en el
historial de git. Esto es importante: revísalo de verdad, no por encima.
```

---

### D6 · Sábado 12 — Documentación, deck y vídeo

```
Continúa Quita. Lee CLAUDE.md. Código congelado salvo bugs críticos.
Hoy se producen los entregables de submission.

1. docs/ATTESTCOIN_INTEGRATION.md — REQUISITO EXPLÍCITO DE LAS BASES
   Las bases dicen: "Technical documentation detailing your setup and explaining
   how the project uses the Attestcoin Protocol" y "Depth of Attestcoin Protocol
   utilization will be evaluated as one of the core scoring criteria".
   Este documento es puntuación directa. Debe cubrir:
   - Diagrama de flujo de la integración cross-chain
   - Los cuatro tipos de evento verificados y por qué cada uno importa
   - Por qué comprobamos receiptStatus y el vector de ataque exacto que previene
   - Por qué validamos el emisor del log y el ataque del clon que previene
   - Esquema de protección de replay y por qué la clave es (chainKey, blockHeight, txIndex)
   - Análisis de coste de gas y por qué probamos pronto tras la finalidad
   - Tabla explícita: qué es criptográficamente verificable vs qué es confiado
   - Nota de que writability aún no está disponible (la doc oficial dice que está
     en auditoría), y cómo la usaríamos cuando lo esté

2. README.md
   Qué es, el problema con las cifras del mercado brasileño, arquitectura, cómo
   ejecutarlo, direcciones desplegadas, tabla verificable vs confiado, y las
   LIMITACIONES DECLARADAS:
   - la atestación de óbito es confiada
   - la stablecoin es un mock
   - la tabla de mortalidad es placeholder pendiente de BR-EMS 2021
   - no somos la aseguradora: somos infraestructura para prestamistas
   Cada limitación que declaras tú vale más que la misma descubierta por el jurado.

3. DECK en PDF, 10 slides:
   1  Portada: Quita — capa de desgravamen on-chain. Track RWA.
   2  Problema: R$30.000M/año en primas de seguro prestamista en Brasil,
      siniestralidad ~18%, hasta 87% de comisión al banco, venta atada declarada
      ilegal por el STJ. [Marca estas cifras como "fuente: análisis de litigio
      Tema 972, pendiente de contraste con estadísticas públicas de SUSEP"]
   3  El hueco: ~50% de la fuerza laboral LATAM es informal, el crédito no
      bancario no tiene cobertura. Brecha de protección regional de $267.000M
   4  Solución: mismo producto, siniestralidad auditable en cadena
   5  Cómo funciona: diagrama del flujo cross-chain
   6  Verificable vs confiado — la slide que gana credibilidad
   7  Profundidad de integración Attestcoin: 4 eventos, receiptStatus,
      validación de emisor, replay protection
   8  Encaje con Creditcoin: 9 años, $100M+ en préstamos registrados, 2M+ de
      nigerianos con Aella, y CERO capa de riesgo sobre todo eso.
      "Loan Flow on Creditcoin EVM" está en su roadmap: somos su primer
      consumidor no trivial.
   9  Roadmap y limitaciones declaradas
   10 Contacto

   Genera el PDF programáticamente (reveal.js a PDF, o similar). No pierdas
   tiempo en diseño: claridad y números legibles.

4. Guion del vídeo (3-4 min) en docs/VIDEO_SCRIPT.md:
   0:00-0:30  El problema con las cifras
   0:30-1:00  Qué es Quita en una frase
   1:00-2:30  Demo en vivo: originar en Sepolia → verificación en Creditcoin →
              atestar óbito → ventana → pago. Mostrar hashes reales en ambos
              exploradores. Esto es lo que separa un demo real de una animación.
   2:30-3:15  Tabla verificable vs confiado, dicha en voz alta
   3:15-4:00  Encaje con el ecosistema y roadmap
   Marca en el guion los momentos donde hay que esperar (finalidad, ventana) y
   cómo cubrirlos hablando.
```

---

## 4. Domingo 13 — Submission

No programes nada. Reserva el día para:

1. Grabar el vídeo si no quedó grabado el sábado (2-3 tomas, elige la mejor).
2. Subirlo a YouTube como *no listado* y copiar la URL.
3. Subir el deck a un enlace público estable (Drive con permiso de lectura, o el propio repo).
4. Rellenar el formulario (documento aparte).
5. **Enviar antes de las 18:00 ET.** No a las 23:00. Si el formulario falla, quieres margen para escribir a team@creditcoin.org o preguntar en `#buidl-ctc-qna` del Discord.

---

## 5. Si algo se cae

| Si falla | Haz esto |
|---|---|
| D2 no verifica al final del día | Reduce a un solo evento (`LoanDisbursed`). Un evento verificado de verdad vale más que cuatro a medias |
| El worker no funciona | Ejecuta las verificaciones a mano con scripts. Documenta el worker como "en progreso" |
| El Pool no cuadra | Elimínalo. `ClaimEngine` puede pagar desde un balance simple del contrato |
| El frontend no llega | Graba el vídeo con terminal + Blockscout. Menos vistoso, igual de válido |
| No llegas al vídeo | Es el único entregable que NO puedes saltarte: "Prototype Demo Video URL" es campo obligatorio. Sacrifica el deck antes que el vídeo — el deck acepta un PDF de 5 slides hechas en 40 minutos |
