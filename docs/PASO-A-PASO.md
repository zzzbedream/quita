# Paso a paso: local primero, testnet después

Guía operativa. La parte local no necesita fondos ni faucet y se ejecuta en segundos.
La parte testnet sí necesita faucet, y ese es el único camino crítico que queda.

---

# PARTE A — Local (ahora mismo, sin faucet)

## A1. Preparar

```bash
cd C:\Users\lcifuentes\Downloads\Quita
npm install
npm run build
```

## A2. Tests

```bash
npm test
```

Esperado: **79 passing** en ~1 segundo.

Para ver solo los rechazos de seguridad, que es lo que interesa enseñar:

```bash
npx hardhat test --grep "rejects"
```

Cobertura:

```bash
npm run coverage
```

Esperado: ~88% statements, ~91% líneas.

## A3. Comprobar que la integración con Creditcoin está viva

**Esto sí toca la red real y no necesita fondos** (es solo lectura):

```bash
npm run probe
```

Debe imprimir:

```
chainId  : 102031
{"chainKey":3,"chainId":1,"chainName":"Ethereum","chainEncoding":1}
{"chainKey":1,"chainId":11155111,"chainName":"Sepolia ethereum","chainEncoding":1}
OK   200  https://proof-gen-api.cc3-testnet.creditcoin.network
OK   200  https://prover.cc3-testnet.creditcoin.network
```

Eso es el precompile de Creditcoin diciéndote que `chainKey 1` es Sepolia. Es la prueba más
barata de que la integración es real.

## A4. Ciclo completo en local

**Terminal 1** — nodo local, déjala abierta:

```bash
npx hardhat node
```

**Terminal 2** — el ciclo entero:

```bash
npx hardhat run scripts/demo.local.ts --network localhost
```

Recorre: originar → verificar → **5 ataques rechazados** → suscribir → amortizar → verificar →
prima probada → libro de 8 pólizas con 144 primas probadas → 2 atestaciones → ventana de
impugnación → liquidar → el prestamista cobra → y que bajo MCR se **bloquea suscribir pero se
paga igual**.

Tarda ~2 segundos. Escribe `deployments/localhost.json`.

### Qué es real y qué no, en local

| | |
|---|---|
| **Real** | Los 6 contratos, `ASCBase`, replay guard, `receiptStatus`, validación de emisor, chainKey, el decoder `EvmV1Decoder`, la tarificación, la liquidación |
| **Simulado** | Solo el precompile `0xFD2`, que es código Rust nativo y no puede existir en Hardhat. Se instala bytecode mock en esa dirección |

En testnet lo único que cambia es que `0xFD2` es el precompile real y la prueba viene del Proof
Builder en vez de un fixture. **Los contratos son idénticos.**

## A5. Ver el dashboard

**Terminal 3** — servidor estático desde la raíz del repo (no desde `frontend/`, porque la página
lee `deployments/`):

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Abre: **http://localhost:8080/frontend/index.html?net=local**

El nodo de la Terminal 1 tiene que seguir vivo o la página no tiene qué leer.

---

# PARTE B — Faucets (el camino crítico)

Necesitas **tres cosas**. La de Creditcoin es manual y puede tardar, así que empieza por ella.

## B1. Wallet

Si no tienes una dedicada al hackatón, créala (mejor no usar una personal):

```bash
node -e "const {Wallet}=require('ethers');const w=Wallet.createRandom();console.log('address:',w.address);console.log('key    :',w.privateKey)"
```

Guarda la clave. Va en `.env`, que está en `.gitignore` desde el primer commit.

Para el ciclo de siniestro completo necesitas **dos atestadores más** (umbral 2-de-3). Repite el
comando dos veces más y guarda esas claves también.

## B2. CTC de Creditcoin CC3 Testnet ← empieza por aquí

El faucet de Creditcoin es **por Discord y manual**. Es lo más lento de todo el proceso.

1. Entra al Discord de Creditcoin: **https://discord.gg/Gu43zTfmtc**
2. Busca el canal de faucet (suele ser `#faucet` o similar; si no lo ves, pregunta en
   `#buidl-ctc-qna`, que es el canal oficial del hackatón).
3. Pide fondos **para tu dirección EVM** (la de `0x...`, no una dirección Substrate).
4. **Pide de sobra.** Vas a desplegar 5 contratos y a enviar decenas de transacciones de
   verificación. Quedarte sin CTC a mitad de la grabación es el peor escenario.

Configuración de red si la necesitas en la wallet:

```
Nombre    : Creditcoin CC3 Testnet
RPC       : https://rpc.cc3-testnet.creditcoin.network
Chain ID  : 102031
Símbolo   : CTC
Explorer  : https://creditcoin-testnet.blockscout.com/
```

Comprobar saldo:

```bash
node -e "const {JsonRpcProvider,formatEther}=require('ethers');new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network').getBalance('TU_DIRECCION').then(b=>console.log(formatEther(b),'CTC'))"
```

## B3. ETH de Sepolia

Cualquiera de estos (los que no piden saldo en mainnet primero suelen ser los de Google y Alchemy):

- Google Cloud: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Alchemy: https://www.alchemy.com/faucets/ethereum-sepolia
- Infura: https://www.infura.io/faucet/sepolia

**Necesitas ETH en las tres direcciones** (deployer + 2 atestadores). Los atestadores solo firman
atestaciones, con muy poco les basta.

## B4. RPC de Sepolia

Un endpoint público no aguanta el escaneo del worker. Crea una app gratis:

- Alchemy: https://dashboard.alchemy.com → Create App → Ethereum → Sepolia → copia la HTTPS URL
- o Infura: https://app.infura.io

## B5. Rellenar `.env`

```bash
cp .env.example .env
```

Edita:

```ini
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/TU_KEY
PRIVATE_KEY=0x...              # deployer, con ETH de Sepolia
CREDITCOIN_PRIVATE_KEY=0x...   # puede ser la misma, pero necesita CTC
ATTESTOR_1_PRIVATE_KEY=0x...   # con ETH de Sepolia
ATTESTOR_2_PRIVATE_KEY=0x...   # con ETH de Sepolia
SOURCE_CHAIN_KEY=1
PROOF_BUILDER_URL=https://proof-gen-api.cc3-testnet.creditcoin.network
DEMO_CHALLENGE_WINDOW_SECONDS=120
DEMO_WAITING_PERIOD_SECONDS=0
```

`.env` está ignorado por git. Verifícalo: `git check-ignore -v .env`

---

# PARTE C — Testnet

## C1. Desplegar en Sepolia

```bash
npm run deploy:origin
```

Despliega `QuitaOrigin`, registra al deployer como lender y a los dos atestadores.
Escribe `deployments/sepolia.json`.

## C2. Desplegar en Creditcoin

```bash
npm run deploy:creditcoin
```

Lee `deployments/sepolia.json` para fijar el emisor. **No lo pases a mano**: un emisor
equivocado es la causa más probable de que una prueba válida sea rechazada con
`UnauthorizedEmitter`.

## C3. Emitir un evento real

```bash
npm run emit:demo
```

Te devuelve un `txHash` de Sepolia. Cópialo.

## C4. La verificación real

```bash
# PowerShell
$env:DEMO_TX_HASH="0x..."; npm run verify:e2e

# bash
DEMO_TX_HASH=0x... npm run verify:e2e
```

**Aquí hay una espera real de ~13-15 minutos**: finalidad de Ethereum más atestación. No es
latencia del proyecto, es el coste de no confiar en nadie. El script cronometra cada fase.

Al terminar imprime los enlaces a **ambos exploradores**. Esa es la prueba visual que separa un
demo real de una animación.

## C5. Ciclo completo en testnet

```bash
npx hardhat run scripts/demo.full.ts --network creditcoin
```

Necesita los dos atestadores con ETH. Recorre todo el ciclo con pruebas reales.
**Dura bastante** porque cada evento espera finalidad.

## C6. Worker continuo (opcional para el vídeo)

```bash
npm run worker
```

Observa Sepolia y prueba automáticamente. Mátalo con Ctrl+C y arráncalo de nuevo: retoma desde
SQLite.

## C7. Dashboard contra testnet

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Abre **http://localhost:8080/frontend/index.html** (sin `?net=local`).

---

# Orden recomendado para hoy

1. **Pide el faucet de Creditcoin YA** (B2). Es lo único que no depende de ti.
2. Mientras esperas: A2, A3, A4, A5. Eso te deja ver el producto entero funcionando.
3. Cuando lleguen los fondos: C1 → C2 → C3 → C4.
4. Graba **una pasada limpia completa** antes de la toma real. Es el seguro de toda la entrega.
5. Rellena la tabla de direcciones del README con lo que salga de `deployments/`.

## Si algo falla

Cada modo de fallo con su plan B está en [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

Los dos más probables:

| Síntoma | Causa | Solución |
|---|---|---|
| `UnauthorizedEmitter` | el emisor fijado no es el `QuitaOrigin` desplegado | vuelve a desplegar el lado Creditcoin tras corregir `deployments/sepolia.json` |
| `Query already processed` | esa transacción ya se verificó | está funcionando bien. Emite una nueva, no pelees con el guard |
